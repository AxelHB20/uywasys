import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  clinicDay,
  fromDbDate,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import { addDays, expiryStatus } from '../inventory/expiry.js';
import type { ExpiryLevel } from '../inventory/expiry.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addMonths, round2 } from './report-period.js';

/** Un producto sin salidas en estos días, con stock, es capital parado */
export const IDLE_DAYS = 60;
/** Lotes que se listan como riesgo: vencidos y hasta el amarillo del semáforo */
const RISK_DAYS = 60;

export interface InventoryProductValue {
  id: number;
  name: string;
  category: string;
  unit: string;
  stock: number;
  /** Stock a costo del lote (solo lotes con costo) */
  value: number;
  /** Unidades en lotes sin costo: no se valorizan */
  stockWithoutCost: number;
  lowStock: boolean;
  /** Producto desactivado que aún tiene stock: se cuenta igual (la plata sigue en el almacén) */
  active: boolean;
}

/** Compras y salidas de un mes, a costo, y el valor del almacén al cerrar ese mes */
export interface InventoryFlow {
  month: string;
  purchases: number;
  outflows: number;
  value: number;
}

export interface InventoryCoverage {
  category: string;
  value: number;
  /** Días que alcanza al ritmo de salidas de los últimos 90 días; null si no salió nada */
  days: number | null;
}

export interface LowStockProduct {
  id: number;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  /** Salidas promedio por semana (últimas 4 semanas), en la unidad mínima */
  weeklyOut: number;
}

export interface RiskBatch {
  batchId: number;
  product: { id: number; name: string; unit: string };
  lotNumber: string | null;
  expiresAt: string;
  days: number;
  level: ExpiryLevel;
  quantity: number;
  /** null si el lote no tiene costo */
  value: number | null;
}

export interface IdleProduct {
  id: number;
  name: string;
  unit: string;
  stock: number;
  value: number;
  /** Última salida (venta, tratamiento o merma); null si nunca salió */
  lastOutAt: Date | null;
}

export interface InventoryReport {
  day: string;
  idleDays: number;
  totals: {
    value: number;
    products: number;
    batchesWithoutCost: number;
    lowStock: number;
    /** Valor en riesgo: vencido, vence en 30 días, vence de 31 a 60 */
    expired: number;
    expiring30: number;
    expiring60: number;
    idle: number;
  };
  categories: { category: string; value: number; products: number }[];
  products: InventoryProductValue[];
  risk: RiskBatch[];
  idle: IdleProduct[];
  flows: InventoryFlow[];
  coverage: InventoryCoverage[];
  lowStockProducts: LowStockProduct[];
  /** Productos desactivados que aún tienen stock */
  inactiveWithStock: number;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

/**
 * Inventario valorizado hoy: el stock a costo de compra, lo que está en riesgo de vencerse y lo
 * que no se mueve. Los lotes sin costo se cuentan aparte para no inventar un valor.
 */
@Injectable()
export class InventoryReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(clinicId: number): Promise<InventoryReport> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const day = clinicDay(timezone);
    const riskLimit = toDbDate(addDays(day, RISK_DAYS));
    const idleSince = new Date(
      toDbDate(day).getTime() - IDLE_DAYS * 86_400_000,
    );

    const [products, batches, idle] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: number;
          name: string;
          category: string;
          unit: string;
          stock: unknown;
          min_stock: unknown;
          active: boolean;
          value: unknown;
          no_cost: unknown;
          batches_no_cost: bigint;
        }[]
      >(Prisma.sql`
        SELECT p.id, p.name, p.category::text AS category, p.base_unit::text AS unit,
               p.total_stock AS stock, p.min_stock, p.active,
               COALESCE(SUM(b.quantity * b.unit_cost) FILTER (WHERE b.unit_cost IS NOT NULL), 0) AS value,
               COALESCE(SUM(b.quantity) FILTER (WHERE b.unit_cost IS NULL), 0) AS no_cost,
               COUNT(b.id) FILTER (WHERE b.unit_cost IS NULL) AS batches_no_cost
        FROM products p
        JOIN product_batches b ON b.product_id = p.id AND b.quantity > 0
        WHERE p.clinic_id = ${clinicId}
        GROUP BY p.id
        ORDER BY value DESC, p.name`),
      this.prisma.productBatch.findMany({
        where: {
          clinicId,
          quantity: { gt: 0 },
          expiresAt: { lte: riskLimit },
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          lotNumber: true,
          expiresAt: true,
          quantity: true,
          unitCost: true,
          product: { select: { id: true, name: true, baseUnit: true } },
        },
      }),
      // Con stock, sin salidas desde hace IDLE_DAYS y con el primer ingreso anterior a eso
      this.prisma.$queryRaw<
        {
          id: number;
          name: string;
          unit: string;
          stock: unknown;
          value: unknown;
          last_out: Date | null;
        }[]
      >(Prisma.sql`
        SELECT p.id, p.name, p.base_unit::text AS unit, p.total_stock AS stock,
               COALESCE((SELECT SUM(b.quantity * b.unit_cost) FROM product_batches b
                         WHERE b.product_id = p.id AND b.quantity > 0 AND b.unit_cost IS NOT NULL), 0) AS value,
               (SELECT MAX(m.created_at) FROM stock_movements m
                 WHERE m.product_id = p.id AND m.quantity < 0
                   AND m.type IN ('SALE', 'TREATMENT', 'WASTE')) AS last_out
        FROM products p
        WHERE p.clinic_id = ${clinicId} AND p.total_stock > 0
          AND (SELECT MIN(b.received_at) FROM product_batches b WHERE b.product_id = p.id) < ${idleSince}
          AND NOT EXISTS (SELECT 1 FROM stock_movements m
                          WHERE m.product_id = p.id AND m.quantity < 0
                            AND m.type IN ('SALE', 'TREATMENT', 'WASTE')
                            AND m.created_at >= ${idleSince})
        ORDER BY value DESC, p.name`),
    ]);

    const productRows: InventoryProductValue[] = products.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      unit: r.unit,
      stock: num(r.stock),
      value: round2(num(r.value)),
      stockWithoutCost: num(r.no_cost),
      lowStock:
        r.active && num(r.min_stock) > 0 && num(r.stock) <= num(r.min_stock),
      active: r.active,
    }));
    const lowStock = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n FROM products
      WHERE clinic_id = ${clinicId} AND active AND min_stock > 0 AND total_stock <= min_stock`);

    const risk: RiskBatch[] = batches.map((b) => {
      const expiresAt = fromDbDate(b.expiresAt)!;
      const status = expiryStatus(expiresAt, day)!;
      const quantity = num(b.quantity);
      return {
        batchId: b.id,
        product: {
          id: b.product.id,
          name: b.product.name,
          unit: b.product.baseUnit,
        },
        lotNumber: b.lotNumber,
        expiresAt,
        days: status.days,
        level: status.level,
        quantity,
        value: b.unitCost === null ? null : round2(quantity * num(b.unitCost)),
      };
    });
    const riskValue = (level: ExpiryLevel) =>
      round2(
        risk
          .filter((b) => b.level === level)
          .reduce((s, b) => s + (b.value ?? 0), 0),
      );

    const byCategory = new Map<
      string,
      { category: string; value: number; products: number }
    >();
    for (const p of productRows) {
      const row = byCategory.get(p.category) ?? {
        category: p.category,
        value: 0,
        products: 0,
      };
      row.value = round2(row.value + p.value);
      row.products++;
      byCategory.set(p.category, row);
    }

    const idleRows: IdleProduct[] = idle.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      stock: num(r.stock),
      value: round2(num(r.value)),
      lastOutAt: r.last_out,
    }));

    return {
      day,
      idleDays: IDLE_DAYS,
      totals: {
        value: round2(productRows.reduce((s, p) => s + p.value, 0)),
        products: productRows.length,
        batchesWithoutCost: products.reduce(
          (s, r) => s + Number(r.batches_no_cost),
          0,
        ),
        lowStock: Number(lowStock[0]?.n ?? 0),
        expired: riskValue('EXPIRED'),
        expiring30: riskValue('RED'),
        expiring60: riskValue('YELLOW'),
        idle: round2(idleRows.reduce((s, p) => s + p.value, 0)),
      },
      categories: [...byCategory.values()].sort((a, b) => b.value - a.value),
      products: productRows,
      risk,
      idle: idleRows,
      ...(await this.extras(clinicId, timezone, day, productRows)),
    };
  }

  /** Entradas y salidas por mes, para cuántos días alcanza y lo que está por reponer */
  private async extras(
    clinicId: number,
    timezone: string,
    day: string,
    productRows: InventoryProductValue[],
  ): Promise<
    Pick<
      InventoryReport,
      'flows' | 'coverage' | 'lowStockProducts' | 'inactiveWithStock'
    >
  > {
    const first = addMonths(`${day.slice(0, 7)}-01`, -5);
    const since = startOfDayIn(timezone, first);
    const d90 = new Date(toDbDate(day).getTime() - 90 * 86_400_000);
    const d28 = new Date(toDbDate(day).getTime() - 28 * 86_400_000);
    const [moves, outByCategory, low] = await Promise.all([
      // A costo del lote: compras (y sus anulaciones) contra todo lo demás
      this.prisma.$queryRaw<
        { month: string; purchases: unknown; net_out: unknown }[]
      >(
        Prisma.sql`
        SELECT to_char(m.created_at AT TIME ZONE ${timezone}, 'YYYY-MM') AS month,
               SUM(m.quantity * b.unit_cost) FILTER (WHERE m.type IN ('PURCHASE', 'PURCHASE_VOID')) AS purchases,
               -SUM(m.quantity * b.unit_cost) FILTER (WHERE m.type NOT IN ('PURCHASE', 'PURCHASE_VOID')) AS net_out
        FROM stock_movements m JOIN product_batches b ON b.id = m.batch_id
        WHERE m.clinic_id = ${clinicId} AND b.unit_cost IS NOT NULL AND m.created_at >= ${since}
        GROUP BY 1`,
      ),
      this.prisma.$queryRaw<{ category: string; out: unknown }[]>(Prisma.sql`
        SELECT p.category::text AS category, -SUM(m.quantity * b.unit_cost) AS out
        FROM stock_movements m
        JOIN product_batches b ON b.id = m.batch_id
        JOIN products p ON p.id = m.product_id
        WHERE m.clinic_id = ${clinicId} AND b.unit_cost IS NOT NULL AND m.quantity < 0
          AND m.type IN ('SALE', 'TREATMENT') AND m.created_at >= ${d90}
        GROUP BY 1`),
      this.prisma.$queryRaw<
        {
          id: number;
          name: string;
          unit: string;
          stock: unknown;
          min_stock: unknown;
          out: unknown;
        }[]
      >(Prisma.sql`
        SELECT p.id, p.name, p.base_unit::text AS unit, p.total_stock AS stock, p.min_stock,
               COALESCE((SELECT -SUM(m.quantity) FROM stock_movements m
                         WHERE m.product_id = p.id AND m.quantity < 0
                           AND m.type IN ('SALE', 'TREATMENT') AND m.created_at >= ${d28}), 0) AS out
        FROM products p
        WHERE p.clinic_id = ${clinicId} AND p.active AND p.min_stock > 0 AND p.total_stock <= p.min_stock
        ORDER BY (p.total_stock / p.min_stock), p.name
        LIMIT 10`),
    ]);

    // Valor al cierre de cada mes: el de hoy menos lo que entró (neto) después
    const valueNow = round2(productRows.reduce((s, p) => s + p.value, 0));
    const months = Array.from({ length: 6 }, (_, i) =>
      addMonths(first, i).slice(0, 7),
    );
    const byMonth = new Map(moves.map((r) => [r.month, r]));
    let after = 0;
    const flows: InventoryFlow[] = [];
    for (let i = months.length - 1; i >= 0; i--) {
      const r = byMonth.get(months[i]);
      const purchases = round2(num(r?.purchases));
      const outflows = round2(num(r?.net_out));
      flows.unshift({
        month: months[i],
        purchases,
        outflows,
        value: round2(Math.max(valueNow - after, 0)),
      });
      after += purchases - outflows;
    }

    const outMap = new Map(outByCategory.map((r) => [r.category, num(r.out)]));
    const valueByCategory = new Map<string, number>();
    for (const p of productRows)
      valueByCategory.set(
        p.category,
        (valueByCategory.get(p.category) ?? 0) + p.value,
      );
    const coverage: InventoryCoverage[] = [...valueByCategory.entries()]
      .map(([category, value]) => {
        const daily = (outMap.get(category) ?? 0) / 90;
        return {
          category,
          value: round2(value),
          days: daily > 0 ? Math.round(value / daily) : null,
        };
      })
      .sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));

    return {
      flows,
      coverage,
      lowStockProducts: low.map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        stock: num(r.stock),
        minStock: num(r.min_stock),
        weeklyOut: Math.round((num(r.out) / 4) * 10) / 10,
      })),
      inactiveWithStock: productRows.filter((p) => !p.active).length,
    };
  }
}
