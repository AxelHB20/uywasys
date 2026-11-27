import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { fromDbDate, toDbDate } from '../common/time/clinic-day.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { Prisma } from '../generated/prisma/client.js';
import type { BaseUnit, ProductCategory } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StockLoadDto } from './dto/stock-load.dto.js';
import { lotMissingMessage, lotRequired } from './lot-rule.js';
import { StockService } from './stock.service.js';

const D = Prisma.Decimal;
/** Tope de productos que se muestran para cargar de una vez */
const MAX_PENDING = 300;

export interface PendingProduct {
  id: number;
  name: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  controlled: boolean;
  tracksExpiry: boolean;
  presentations: { id: number; name: string; factor: number }[];
}

export interface RowError {
  productId: number;
  message: string;
}

/**
 * "Cargar stock": la clínica creó sus productos sin stock y ahora pone lo que tiene, todos en una
 * tabla. Se revisan todas las filas antes de guardar; si alguna está mal no entra nada.
 */
@Injectable()
export class StockLoadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async pending(
    clinicId: number,
  ): Promise<{ items: PendingProduct[]; total: number }> {
    const where: Prisma.ProductWhereInput = {
      clinicId,
      active: true,
      totalStock: { lte: 0 },
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        take: MAX_PENDING,
        select: {
          id: true,
          name: true,
          category: true,
          baseUnit: true,
          controlled: true,
          tracksExpiry: true,
          presentations: {
            where: { active: true },
            orderBy: { factor: 'desc' },
            select: { id: true, name: true, factor: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        ...r,
        presentations: r.presentations.map((p) => ({
          ...p,
          factor: Number(p.factor),
        })),
      })),
    };
  }

  async load(
    actor: AuthUser,
    dto: StockLoadDto,
    ip?: string,
  ): Promise<{ loaded: number }> {
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Hay un producto repetido en la tabla');
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, clinicId: actor.clinicId },
      select: {
        id: true,
        name: true,
        active: true,
        category: true,
        controlled: true,
        tracksExpiry: true,
        presentations: {
          where: { active: true },
          select: { id: true, name: true, factor: true },
        },
      },
    });
    const today = await clinicToday(this.prisma, actor.clinicId);

    // 1) Revisar todas las filas y decir cuál está mal (antes de tocar nada)
    const errors: RowError[] = [];
    const plan = dto.items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      const fail = (message: string) => {
        errors.push({ productId: item.productId, message });
        return null;
      };
      if (!product) return fail('El producto no existe');
      if (!product.active) return fail('El producto está inactivo');
      const presentation = product.presentations.find(
        (p) => p.id === item.presentationId,
      );
      if (!presentation) return fail('Elige una presentación del producto');
      const controlled = item.controlled ?? product.controlled;
      if (lotRequired(product.category, controlled) && !item.lotNumber)
        return fail(lotMissingMessage(product.category, controlled));
      let expiresAt: string | null = null;
      if (product.tracksExpiry) {
        if (!item.expiresAt) return fail('Escribe el vencimiento');
        if (fromDbDate(toDbDate(item.expiresAt)) !== item.expiresAt)
          return fail('La fecha de vencimiento no es válida');
        if (item.expiresAt < today) return fail('Ese lote ya está vencido');
        expiresAt = item.expiresAt;
      }
      return { item, product, presentation, controlled, expiresAt };
    });
    if (errors.length)
      throw new BadRequestException({
        message:
          errors.length === 1
            ? 'Revisa la fila marcada: no se guardó nada'
            : `Revisa las ${errors.length} filas marcadas: no se guardó nada`,
        rows: errors,
      });

    // 2) Todo bien: entra todo junto
    const rows = plan.filter((p) => p !== null);
    await this.prisma.$transaction(
      async (tx) => {
        for (const r of rows) {
          if (r.controlled !== r.product.controlled)
            await tx.product.update({
              where: { id: r.product.id },
              // Un controlado siempre pide receta
              data: r.controlled
                ? { controlled: true, requiresPrescription: true }
                : { controlled: false, requiresPrescription: false },
            });
          const factor = new D(r.presentation.factor);
          await this.stock.receive(tx, {
            clinicId: actor.clinicId,
            productId: r.product.id,
            userId: actor.id,
            quantity: new D(r.item.quantity).times(factor),
            lotNumber: r.item.lotNumber ?? null,
            expiresAt: r.expiresAt,
            unitCost:
              r.item.costPerPresentation == null
                ? null
                : new D(r.item.costPerPresentation)
                    .div(factor)
                    .toDecimalPlaces(4),
            supplier: null,
            documentNumber: null,
            reason: `Stock inicial · ${r.presentation.name}`,
          });
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'stock.load',
      entity: 'product',
      entityId: rows[0].product.id,
      ip,
      data: {
        products: rows.map((r) => ({
          id: r.product.id,
          name: r.product.name,
          presentation: r.presentation.name,
          quantity: r.item.quantity,
          ...(r.controlled !== r.product.controlled
            ? { controlled: r.controlled }
            : {}),
        })),
      },
    });
    return { loaded: rows.length };
  }
}
