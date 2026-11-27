import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import type { BaseUnit, ProductCategory } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProductFixDto } from './dto/product-fix.dto.js';
import type { RowError } from './stock-load.service.js';
import {
  COUNTING_UNITS,
  renameUnitPresentations,
  wrongBasePresentation,
} from './unit-names.js';

const MAX_ROWS = 300;

export interface ProductFixRow {
  id: number;
  name: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  totalStock: number;
  /** Sin compras, ventas ni stock inicial: se puede cambiar cómo se cuenta */
  canChangeUnit: boolean;
  /** Presentación con «Trae» mal puesto (se le pone 1) */
  presentation: { id: number; name: string; factor: number } | null;
  /** Insumo con precio de venta: no aparece al cobrar */
  supplyWithPrice: boolean;
}

const SELECT = {
  id: true,
  name: true,
  category: true,
  baseUnit: true,
  totalStock: true,
  chargeable: true,
  _count: { select: { movements: true } },
  presentations: {
    where: { active: true },
    select: { id: true, name: true, factor: true, price: true },
  },
} satisfies Prisma.ProductSelect;

type Loaded = Prisma.ProductGetPayload<{ select: typeof SELECT }>;

function toRow(p: Loaded): ProductFixRow | null {
  const presentations = p.presentations.map((x) => ({
    id: x.id,
    name: x.name,
    factor: Number(x.factor),
    price: x.price === null ? null : Number(x.price),
  }));
  const wrong = wrongBasePresentation(presentations, p.baseUnit);
  // Un insumo de la categoría Insumo con precio no molesta; un medicamento "insumo" con precio sí
  const supplyWithPrice =
    !p.chargeable &&
    p.category !== 'SUPPLY' &&
    presentations.some((x) => (x.price ?? 0) > 0);
  if (!wrong && !supplyWithPrice) return null;
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    baseUnit: p.baseUnit,
    totalStock: Number(p.totalStock),
    canChangeUnit: p._count.movements === 0,
    presentation: wrong
      ? { id: wrong.id, name: wrong.name, factor: wrong.factor }
      : null,
    supplyWithPrice,
  };
}

/**
 * "Corregir productos": los que se crearon con el stock puesto en «Trae» (ninguna presentación
 * trae 1) o marcados como insumo teniendo precio. Se corrigen todos de una vez.
 */
@Injectable()
export class ProductFixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private load(clinicId: number, ids?: number[]) {
    return this.prisma.product.findMany({
      where: {
        clinicId,
        active: true,
        ...(ids ? { id: { in: ids } } : {}),
        OR: [
          {
            presentations: {
              some: { active: true },
              none: { active: true, factor: 1 },
            },
          },
          {
            chargeable: false,
            category: { not: 'SUPPLY' },
            presentations: { some: { active: true, price: { gt: 0 } } },
          },
        ],
      },
      orderBy: { name: 'asc' },
      take: ids ? undefined : MAX_ROWS,
      select: SELECT,
    });
  }

  async pending(clinicId: number): Promise<{ items: ProductFixRow[] }> {
    const rows = await this.load(clinicId);
    return { items: rows.map(toRow).filter((r) => r !== null) };
  }

  async apply(
    actor: AuthUser,
    dto: ProductFixDto,
    ip?: string,
  ): Promise<{
    fixed: number;
    /** Lo que habían puesto en «Trae»: cantidad sugerida para "Cargar stock" */
    suggestions: {
      productId: number;
      presentationId: number;
      quantity: number;
    }[];
  }> {
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Un producto está repetido');
    const byId = new Map(
      (await this.load(actor.clinicId, ids)).map((p) => [p.id, p]),
    );
    const errors: RowError[] = [];
    const plan: {
      product: Loaded;
      row: ProductFixRow;
      presentationId: number | null;
      baseUnit: BaseUnit | null;
      sellable: boolean;
    }[] = [];
    for (const item of dto.items) {
      const product = byId.get(item.productId);
      const row = product ? toRow(product) : null;
      if (!product || !row) {
        errors.push({
          productId: item.productId,
          message: 'Ya no tiene nada que corregir',
        });
        continue;
      }
      if (
        item.presentationId !== undefined &&
        item.presentationId !== row.presentation?.id
      ) {
        errors.push({
          productId: item.productId,
          message: 'Esa presentación no es la que hay que corregir',
        });
        continue;
      }
      const baseUnit =
        item.baseUnit && item.baseUnit !== product.baseUnit
          ? item.baseUnit
          : null;
      if (
        baseUnit &&
        (!row.canChangeUnit || !COUNTING_UNITS.includes(baseUnit))
      ) {
        errors.push({
          productId: item.productId,
          message:
            'Ya tiene movimientos: no se puede cambiar cómo se cuenta (crea uno nuevo)',
        });
        continue;
      }
      if (item.sellable && !row.supplyWithPrice) {
        errors.push({ productId: item.productId, message: 'Ya se vende' });
        continue;
      }
      const presentationId = item.presentationId ?? null;
      const sellable = item.sellable === true;
      if (!presentationId && !baseUnit && !sellable) continue;
      plan.push({ product, row, presentationId, baseUnit, sellable });
    }
    if (errors.length)
      throw new BadRequestException({
        message: 'Revisa los productos marcados: no se guardó nada',
        rows: errors,
      });
    if (!plan.length)
      throw new BadRequestException('Marca al menos una corrección');

    await this.prisma.$transaction(
      async (tx) => {
        for (const p of plan) {
          if (p.presentationId)
            await tx.productPresentation.update({
              where: { id: p.presentationId },
              data: { factor: 1 },
            });
          if (p.baseUnit || p.sellable)
            await tx.product.update({
              where: { id: p.product.id },
              data: {
                ...(p.baseUnit ? { baseUnit: p.baseUnit } : {}),
                ...(p.sellable ? { chargeable: true } : {}),
              },
            });
          if (p.baseUnit)
            await renameUnitPresentations(
              tx,
              p.product.id,
              p.product.baseUnit,
              p.baseUnit,
            );
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'product.fix',
      entity: 'product',
      entityId: plan[0].product.id,
      ip,
      data: {
        products: plan.map((p) => ({
          id: p.product.id,
          name: p.product.name,
          ...(p.presentationId
            ? {
                presentation: p.row.presentation!.name,
                factorWas: p.row.presentation!.factor,
              }
            : {}),
          ...(p.baseUnit
            ? { baseUnit: p.baseUnit, baseUnitWas: p.product.baseUnit }
            : {}),
          ...(p.sellable ? { sellable: true } : {}),
        })),
      },
    });

    return {
      fixed: plan.length,
      suggestions: plan
        .filter(
          (p) =>
            p.presentationId &&
            p.row.totalStock <= 0 &&
            Number.isInteger(p.row.presentation!.factor) &&
            p.row.presentation!.factor > 1,
        )
        .map((p) => ({
          productId: p.product.id,
          presentationId: p.presentationId!,
          quantity: p.row.presentation!.factor,
        })),
    };
  }
}
