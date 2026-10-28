import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { discountPercent, lineAmounts } from '../common/money/igv.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { Prisma } from '../generated/prisma/client.js';
import type { BaseUnit, DocumentType } from '../generated/prisma/enums.js';
import { StockService } from '../inventory/stock.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ChargeItemDto,
  CreateChargesDto,
  ListShortagesQuery,
  ResolveShortageDto,
  VoidChargeDto,
} from './dto/charge.dto.js';
import { CHARGE_SELECT, lockVisit, toChargeView } from './visit.views.js';
import type { ChargeView } from './visit.views.js';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;

/** Unidad SUNAT (catálogo 03) de los servicios */
const SERVICE_UNIT = 'ZZ';

export interface CreatedCharges {
  charges: ChargeView[];
  /** Insumos que se usaron sin stock registrado: el administrador los cuadra */
  shortages: { product: string; baseUnit: BaseUnit; quantity: number }[];
}

export interface ClientAccount {
  client: {
    id: number;
    number: number;
    name: string;
    phone: string;
    docType: DocumentType | null;
    docNumber: string | null;
  };
  /** Cargos por cobrar, del más antiguo al más nuevo */
  pending: ChargeView[];
  pendingTotal: number;
}

export interface ShortageView {
  id: number;
  product: { id: number; name: string; baseUnit: BaseUnit };
  quantity: number;
  createdAt: Date;
  charge: {
    id: number;
    description: string;
    visitId: number | null;
    pet: { id: number; name: string } | null;
  };
  resolvedAt: Date | null;
  resolution: string | null;
}

/**
 * Cargos en la cuenta del cliente. Congelan precio e IGV y descuentan stock en la misma
 * transacción: si algo falla, no queda ni el cargo ni el descuento.
 */
@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthUser,
    dto: CreateChargesDto,
    ip?: string,
  ): Promise<CreatedCharges> {
    const today = await clinicToday(this.prisma, actor.clinicId);
    const { maxDiscountPercent } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: actor.clinicId },
      select: { maxDiscountPercent: true },
    });
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { licenseNumber: true },
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const ctx = await this.context(tx, actor.clinicId, dto);
        const lines = await this.resolveItems(tx, actor.clinicId, dto.items);

        // Todos los productos se bloquean al inicio y en orden: dos cargos simultáneos
        // que comparten insumos nunca se bloquean entre sí
        const productIds = [
          ...new Set(
            lines.flatMap((l) =>
              l.kind === 'PRODUCT'
                ? [l.product.id]
                : l.service.supplies.map((s) => s.product.id),
            ),
          ),
        ].sort((x, y) => x - y);
        for (const productId of productIds)
          await this.stock.lockProduct(tx, actor.clinicId, productId);

        const createdIds: number[] = [];
        const shortages: CreatedCharges['shortages'] = [];
        for (const [index, line] of lines.entries()) {
          const item = dto.items[index];
          const amounts = lineAmounts({
            quantity: item.quantity,
            unitPrice: line.unitPrice,
            discount: item.discount ?? 0,
            affectation: line.igv,
          });
          if (amounts.discount.gt(0)) {
            if (!item.discountReason)
              throw new BadRequestException(
                `Indica el motivo del descuento en ${line.description}`,
              );
            if (
              actor.role !== 'ADMIN' &&
              discountPercent(amounts.gross, amounts.discount).gt(
                maxDiscountPercent,
              )
            )
              throw new ForbiddenException(
                `El descuento en ${line.description} supera el ${Number(maxDiscountPercent)} % permitido: lo autoriza el administrador`,
              );
          }

          // Controlados: paciente, receta y veterinario con colegiatura
          const controlled =
            line.kind === 'PRODUCT'
              ? line.product.controlled
                ? [line.product.name]
                : []
              : line.service.supplies
                  .filter((s) => s.product.controlled)
                  .map((s) => s.product.name);
          if (controlled.length) {
            const what = `${line.description} lleva ${controlled.join(', ')} (controlado)`;
            if (!ctx.petId)
              throw new BadRequestException(`${what}: indica la mascota`);
            if (!item.prescriptionRef)
              throw new BadRequestException(`${what}: indica el N.º de receta`);
            if (!me.licenseNumber)
              throw new ForbiddenException(
                `${what}: lo registra un veterinario con colegiatura`,
              );
          }
          const vetId = controlled.length || me.licenseNumber ? actor.id : null;

          const charge = await tx.charge.create({
            data: {
              clinicId: actor.clinicId,
              clientId: ctx.clientId,
              visitId: ctx.visitId,
              petId: ctx.petId,
              kind: line.kind,
              careServiceId: line.kind === 'SERVICE' ? line.service.id : null,
              productId: line.kind === 'PRODUCT' ? line.product.id : null,
              presentationId:
                line.kind === 'PRODUCT' ? line.presentation.id : null,
              description: line.description,
              quantity: item.quantity,
              unitPrice: line.unitPrice,
              discount: amounts.discount,
              discountReason: amounts.discount.gt(0)
                ? item.discountReason
                : null,
              igvAffectation: line.igv,
              igvRate: amounts.rate,
              sunatUnit: line.sunatUnit,
              taxableAmount: amounts.taxable,
              igvAmount: amounts.igv,
              total: amounts.total,
              prescriptionRef: item.prescriptionRef ?? null,
              vetId,
              createdById: actor.id,
            },
            select: { id: true },
          });
          createdIds.push(charge.id);

          const movement = {
            clinicId: actor.clinicId,
            userId: actor.id,
            today,
            petId: ctx.petId,
            vetId,
            prescriptionRef: item.prescriptionRef ?? null,
            refType: 'charge',
            refId: charge.id,
          };
          if (line.kind === 'PRODUCT') {
            // Venta directa: si no hay stock, no se vende (409 con lo disponible)
            await this.stock.deduct(tx, {
              ...movement,
              productId: line.product.id,
              quantity: new D(item.quantity).times(line.presentation.factor),
              type: 'SALE',
              reason: `Venta: ${line.description}`,
            });
          } else {
            for (const supply of line.service.supplies) {
              const { missing } = await this.stock.deductAvailable(tx, {
                ...movement,
                productId: supply.product.id,
                quantity: supply.quantity.times(item.quantity),
                type: 'TREATMENT',
                reason: `Insumo de ${line.service.name}`,
              });
              if (missing.gt(0)) {
                await tx.stockShortage.create({
                  data: {
                    clinicId: actor.clinicId,
                    chargeId: charge.id,
                    productId: supply.product.id,
                    quantity: missing,
                  },
                });
                shortages.push({
                  product: supply.product.name,
                  baseUnit: supply.product.baseUnit,
                  quantity: missing.toNumber(),
                });
              }
            }
          }
        }

        const rows = await tx.charge.findMany({
          where: { id: { in: createdIds } },
          select: CHARGE_SELECT,
          orderBy: { id: 'asc' },
        });
        return { charges: rows.map(toChargeView), shortages };
      },
      { timeout: 20_000 },
    );

    const discounted = result.charges.filter((c) => c.discount > 0);
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'charge.create',
      entity: 'charge',
      entityId: result.charges[0]?.id,
      ip,
      data: {
        visitId: dto.visitId ?? null,
        charges: result.charges.map((c) => ({
          id: c.id,
          description: c.description,
          total: c.total,
        })),
        discounts: discounted.map((c) => ({
          id: c.id,
          discount: c.discount,
          reason: c.discountReason,
        })),
        shortages: result.shortages,
      },
    });
    return result;
  }

  /**
   * Quitar un cargo pendiente: el stock vuelve a sus lotes. Mientras la atención está abierta
   * puede hacerlo quien lo registró; después, solo el administrador.
   */
  async void(
    actor: AuthUser,
    id: number,
    dto: VoidChargeDto,
    ip?: string,
  ): Promise<ChargeView> {
    const charge = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        {
          status: string;
          created_by_id: number;
          visit_id: number | null;
        }[]
      >`SELECT status::text AS status, created_by_id, visit_id FROM charges
        WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!row) throw new NotFoundException('El cargo no existe');
      if (row.status === 'VOID')
        throw new ConflictException('El cargo ya fue quitado');
      if (row.status === 'PAID')
        throw new ConflictException(
          'El cargo ya está cobrado: se anula desde caja',
        );

      if (actor.role !== 'ADMIN') {
        const visit = row.visit_id
          ? await lockVisit(tx, actor.clinicId, row.visit_id)
          : null;
        if (row.created_by_id !== actor.id || visit?.status !== 'OPEN')
          throw new ForbiddenException(
            row.created_by_id !== actor.id
              ? 'Solo quien registró el cargo o el administrador pueden quitarlo'
              : 'La atención ya se cerró: solo el administrador puede quitar el cargo',
          );
      }

      await this.stock.restore(tx, {
        clinicId: actor.clinicId,
        refType: 'charge',
        refId: id,
        userId: actor.id,
        reason: `Cargo quitado: ${dto.reason}`,
      });
      const now = new Date();
      await tx.stockShortage.updateMany({
        where: { chargeId: id, resolvedAt: null },
        data: {
          resolvedAt: now,
          resolvedById: actor.id,
          resolution: 'Cargo quitado',
        },
      });
      return tx.charge.update({
        where: { id },
        data: {
          status: 'VOID',
          voidedAt: now,
          voidedById: actor.id,
          voidReason: dto.reason,
        },
        select: CHARGE_SELECT,
      });
    });

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'charge.void',
      entity: 'charge',
      entityId: id,
      ip,
      data: {
        description: charge.description,
        total: Number(charge.total),
        reason: dto.reason,
      },
    });
    return toChargeView(charge);
  }

  /** Cuenta del cliente: lo que tiene por pagar. Los pagos llegan con la caja. */
  async account(clinicId: number, clientId: number): Promise<ClientAccount> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, clinicId },
      select: {
        id: true,
        number: true,
        name: true,
        phone: true,
        docType: true,
        docNumber: true,
      },
    });
    if (!client) throw new NotFoundException('El cliente no existe');
    const rows = await this.prisma.charge.findMany({
      where: { clinicId, clientId, status: 'PENDING' },
      select: CHARGE_SELECT,
      orderBy: { id: 'asc' },
    });
    const pending = rows.map(toChargeView);
    const pendingTotal = rows
      .reduce((sum, r) => sum.plus(r.total), new D(0))
      .toNumber();
    return { client, pending, pendingTotal };
  }

  async shortages(
    clinicId: number,
    query: ListShortagesQuery,
  ): Promise<ShortageView[]> {
    const rows = await this.prisma.stockShortage.findMany({
      where: {
        clinicId,
        resolvedAt: query.resolved ? { not: null } : null,
      },
      select: {
        id: true,
        quantity: true,
        createdAt: true,
        resolvedAt: true,
        resolution: true,
        product: { select: { id: true, name: true, baseUnit: true } },
        charge: {
          select: {
            id: true,
            description: true,
            visitId: true,
            pet: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  }

  /** El administrador cuadra el faltante (por ejemplo, registrando la compra que faltaba). */
  async resolveShortage(
    actor: AuthUser,
    id: number,
    dto: ResolveShortageDto,
    ip?: string,
  ): Promise<{ id: number }> {
    const updated = await this.prisma.stockShortage.updateMany({
      where: { id, clinicId: actor.clinicId, resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolvedById: actor.id,
        resolution: dto.resolution,
      },
    });
    if (!updated.count) {
      const exists = await this.prisma.stockShortage.count({
        where: { id, clinicId: actor.clinicId },
      });
      if (!exists) throw new NotFoundException('La alerta no existe');
      throw new ConflictException('La alerta ya estaba resuelta');
    }
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'stock.shortage_resolve',
      entity: 'stock_shortage',
      entityId: id,
      ip,
      data: { resolution: dto.resolution },
    });
    return { id };
  }

  // ── Ayudas ──

  /** A quién se carga: la atención abierta, o el cliente (y su mascota) para una venta aparte. */
  private async context(
    tx: Tx,
    clinicId: number,
    dto: CreateChargesDto,
  ): Promise<{
    clientId: number;
    petId: number | null;
    visitId: number | null;
  }> {
    if (dto.visitId) {
      const visit = await lockVisit(tx, clinicId, dto.visitId);
      if (!visit) throw new NotFoundException('La atención no existe');
      if (visit.status !== 'OPEN')
        throw new ConflictException(
          'La atención ya se cerró: registra el cargo como venta aparte en la cuenta del cliente',
        );
      return {
        clientId: visit.client_id,
        petId: visit.pet_id,
        visitId: visit.id,
      };
    }
    const client = await tx.client.findFirst({
      where: { id: dto.clientId, clinicId },
      select: { id: true, active: true },
    });
    if (!client) throw new NotFoundException('El cliente no existe');
    if (!client.active)
      throw new BadRequestException('El cliente está inactivo');
    if (dto.petId) {
      const pet = await tx.pet.findFirst({
        where: { id: dto.petId, clinicId, clientId: client.id },
        select: { id: true },
      });
      if (!pet)
        throw new BadRequestException('La mascota no es de este cliente');
    }
    return { clientId: client.id, petId: dto.petId ?? null, visitId: null };
  }

  /** Busca cada servicio o producto en el catálogo de la clínica y toma su precio vigente. */
  private async resolveItems(tx: Tx, clinicId: number, items: ChargeItemDto[]) {
    const serviceIds = items.flatMap((i) =>
      i.careServiceId ? [i.careServiceId] : [],
    );
    const presentationIds = items.flatMap((i) =>
      i.productId && i.presentationId ? [i.presentationId] : [],
    );
    const services = serviceIds.length
      ? await tx.careService.findMany({
          where: { id: { in: serviceIds }, clinicId, active: true },
          select: {
            id: true,
            name: true,
            price: true,
            igv: true,
            supplies: {
              select: {
                quantity: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    controlled: true,
                    baseUnit: true,
                  },
                },
              },
              orderBy: { productId: 'asc' },
            },
          },
        })
      : [];
    const presentations = presentationIds.length
      ? await tx.productPresentation.findMany({
          where: { id: { in: presentationIds }, clinicId, active: true },
          select: {
            id: true,
            name: true,
            factor: true,
            price: true,
            product: {
              select: {
                id: true,
                name: true,
                active: true,
                controlled: true,
                igv: true,
                sunatUnit: true,
              },
            },
          },
        })
      : [];

    return items.map((item) => {
      if (item.careServiceId && item.productId)
        throw new BadRequestException(
          'Cada línea es un servicio o un producto, no ambos',
        );
      if (item.careServiceId) {
        const service = services.find((s) => s.id === item.careServiceId);
        if (!service)
          throw new NotFoundException('El servicio no existe o está inactivo');
        return {
          kind: 'SERVICE' as const,
          service: {
            ...service,
            supplies: service.supplies.map((s) => ({
              product: s.product,
              quantity: new D(s.quantity),
            })),
          },
          description: service.name,
          unitPrice: service.price,
          igv: service.igv,
          sunatUnit: SERVICE_UNIT,
        };
      }
      const presentation = presentations.find(
        (p) => p.id === item.presentationId && p.product.id === item.productId,
      );
      if (!presentation || !presentation.product.active)
        throw new NotFoundException(
          'El producto o su presentación no existen o están inactivos',
        );
      if (presentation.price === null)
        throw new BadRequestException(
          `${presentation.product.name} (${presentation.name}) no tiene precio: pónselo en inventario`,
        );
      return {
        kind: 'PRODUCT' as const,
        product: presentation.product,
        presentation: { id: presentation.id, factor: presentation.factor },
        description:
          `${presentation.product.name} · ${presentation.name}`.slice(0, 200),
        unitPrice: presentation.price,
        igv: presentation.product.igv,
        sunatUnit: presentation.product.sunatUnit,
      };
    });
  }
}
