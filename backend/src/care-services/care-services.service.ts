import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  BaseUnit,
  CareServiceCategory,
  IgvAffectation,
  PetSize,
} from '../generated/prisma/enums.js';
import { lastUnitCosts } from '../inventory/last-cost.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateCareServiceDto,
  SupplyDto,
  UpdateCareServiceDto,
} from './care-service.dto.js';

export interface CareServiceView {
  id: number;
  name: string;
  category: CareServiceCategory;
  price: number;
  igv: IgvAffectation;
  durationMin: number | null;
  active: boolean;
  /** Precio según el tamaño de la mascota (grooming); si falta un tamaño, rige `price` */
  sizePrices: { size: PetSize; price: number }[];
  supplies: {
    productId: number;
    name: string;
    baseUnit: BaseUnit;
    quantity: number;
    /** Si es controlado, el cargo exige receta y veterinario con colegiatura */
    controlled: boolean;
    /** Último costo sin IGV por unidad mínima (null si nunca se compró por el sistema) */
    unitCost: number | null;
  }[];
  /** Presupuestos emitidos o aceptados que lo incluyen (se cobran aunque se desactive) */
  pendingEstimates: number;
}

const SELECT = {
  id: true,
  name: true,
  category: true,
  price: true,
  igv: true,
  durationMin: true,
  active: true,
  sizePrices: { select: { size: true, price: true }, orderBy: { size: 'asc' } },
  supplies: {
    select: {
      quantity: true,
      product: {
        select: { id: true, name: true, baseUnit: true, controlled: true },
      },
    },
  },
} satisfies Prisma.CareServiceSelect;

type Row = Prisma.CareServiceGetPayload<{ select: typeof SELECT }>;

/** Catálogo de servicios. Sus insumos se descuentan del inventario al registrar el cargo. */
@Injectable()
export class CareServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    clinicId: number,
    status: 'active' | 'inactive' | 'all' = 'active',
  ) {
    const rows = await this.prisma.careService.findMany({
      where: {
        clinicId,
        // La movilidad es interna: su precio lo pone recepción en cada caso
        systemKey: null,
        ...(status === 'all' ? {} : { active: status === 'active' }),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: SELECT,
    });
    return this.withCosts(clinicId, rows);
  }

  /** Vista con el último costo de cada insumo, para ver cuánto gasta el servicio */
  private async withCosts(
    clinicId: number,
    rows: Row[],
  ): Promise<CareServiceView[]> {
    const ids = [
      ...new Set(rows.flatMap((r) => r.supplies.map((s) => s.product.id))),
    ];
    const [costs, quoted] = await Promise.all([
      lastUnitCosts(this.prisma, clinicId, ids),
      this.prisma.estimateItem.groupBy({
        by: ['careServiceId'],
        where: {
          careServiceId: { in: rows.map((r) => r.id) },
          estimate: { clinicId, status: { in: ['PENDING', 'ACCEPTED'] } },
        },
        _count: { _all: true },
      }),
    ]);
    const pending = new Map(
      quoted.map((q) => [q.careServiceId, q._count._all] as const),
    );
    return rows.map((r) => toView(r, costs, pending.get(r.id) ?? 0));
  }

  async create(
    actor: AuthUser,
    dto: CreateCareServiceDto,
    ip?: string,
  ): Promise<CareServiceView> {
    await this.checkSupplies(actor.clinicId, dto.supplies);
    checkSizes(dto.sizePrices);
    let row: Row;
    try {
      row = await this.prisma.careService.create({
        data: {
          clinicId: actor.clinicId,
          name: dto.name,
          category: dto.category,
          price: dto.price,
          igv: dto.igv ?? 'TAXED',
          durationMin: dto.durationMin ?? null,
          supplies: dto.supplies?.length
            ? {
                create: dto.supplies.map((s) => ({
                  productId: s.productId,
                  quantity: s.quantity,
                })),
              }
            : undefined,
          sizePrices: dto.sizePrices?.length
            ? {
                create: dto.sizePrices.map((p) => ({
                  size: p.size,
                  price: p.price,
                })),
              }
            : undefined,
        },
        select: SELECT,
      });
    } catch (error) {
      throw duplicate(error);
    }
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'service.create',
      entity: 'care_service',
      entityId: row.id,
      ip,
      data: { name: row.name, price: dto.price },
    });
    return (await this.withCosts(actor.clinicId, [row]))[0];
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateCareServiceDto,
    ip?: string,
  ): Promise<CareServiceView> {
    const current = await this.prisma.careService.findFirst({
      where: { id, clinicId: actor.clinicId, systemKey: null },
      select: { price: true, name: true },
    });
    if (!current) throw new NotFoundException('El servicio no existe');
    await this.checkSupplies(actor.clinicId, dto.supplies);
    checkSizes(dto.sizePrices);

    let row: Row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        if (dto.supplies) {
          // Los insumos se reemplazan completos
          await tx.careServiceSupply.deleteMany({ where: { serviceId: id } });
          if (dto.supplies.length)
            await tx.careServiceSupply.createMany({
              data: dto.supplies.map((s) => ({
                serviceId: id,
                productId: s.productId,
                quantity: s.quantity,
              })),
            });
        }
        if (dto.sizePrices) {
          await tx.careServiceSizePrice.deleteMany({
            where: { serviceId: id },
          });
          if (dto.sizePrices.length)
            await tx.careServiceSizePrice.createMany({
              data: dto.sizePrices.map((p) => ({
                serviceId: id,
                size: p.size,
                price: p.price,
              })),
            });
        }
        return tx.careService.update({
          where: { id },
          data: {
            name: dto.name,
            category: dto.category,
            price: dto.price,
            igv: dto.igv,
            durationMin: dto.durationMin,
            active: dto.active,
          },
          select: SELECT,
        });
      });
    } catch (error) {
      throw duplicate(error);
    }
    const before = Number(current.price);
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action:
        dto.price !== undefined && dto.price !== before
          ? 'service.price_change'
          : 'service.update',
      entity: 'care_service',
      entityId: id,
      ip,
      data: {
        name: current.name,
        before,
        after: dto.price ?? before,
        fields: Object.keys(dto),
      },
    });
    return (await this.withCosts(actor.clinicId, [row]))[0];
  }

  private async checkSupplies(
    clinicId: number,
    supplies?: SupplyDto[],
  ): Promise<void> {
    if (!supplies?.length) return;
    const ids = supplies.map((s) => s.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'Un producto aparece dos veces en los insumos',
      );
    const found = await this.prisma.product.count({
      where: { clinicId, id: { in: ids }, active: true },
    });
    if (found !== ids.length)
      throw new BadRequestException('Algún insumo no existe o está inactivo');
  }
}

function toView(
  row: Row,
  costs: Map<number, number>,
  pendingEstimates = 0,
): CareServiceView {
  return {
    pendingEstimates,
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    igv: row.igv,
    durationMin: row.durationMin,
    active: row.active,
    sizePrices: row.sizePrices.map((p) => ({
      size: p.size,
      price: Number(p.price),
    })),
    supplies: row.supplies.map((s) => ({
      productId: s.product.id,
      name: s.product.name,
      baseUnit: s.product.baseUnit,
      quantity: Number(s.quantity),
      controlled: s.product.controlled,
      unitCost: costs.get(s.product.id) ?? null,
    })),
  };
}

function checkSizes(sizes?: { size: PetSize }[]): void {
  if (!sizes?.length) return;
  if (new Set(sizes.map((s) => s.size)).size !== sizes.length)
    throw new BadRequestException('Un tamaño aparece dos veces en los precios');
}

function duplicate(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    return new ConflictException('Ya existe un servicio con ese nombre');
  return error;
}
