import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { clinicDay } from '../common/time/clinic-day.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  bucketSql,
  bucketsOf,
  grainOf,
  periodOf,
  previousOf,
  round2,
} from './report-period.js';
import type { Grain, Period } from './report-period.js';
import type { SaleKind } from './sales-report.service.js';

/** Margen de un grupo del gráfico (hora, día, semana o mes) */
export interface MarginBucket {
  key: string;
  from: string;
  to: string;
  revenue: number;
  /** Solo de lo vendido con costo */
  margin: number;
  marginPercent: number | null;
}

export interface MarginRow {
  kind: SaleKind;
  id: number | null;
  name: string;
  category: string | null;
  /** Unidades mínimas (productos) o veces (servicios) */
  quantity: number;
  unit: string | null;
  /** Venta sin IGV */
  revenue: number;
  /** Costo de lo que salió del inventario (el del lote); null si falta el costo de algún lote */
  cost: number | null;
  margin: number | null;
  /** Margen sobre la venta sin IGV, en % con un decimal */
  marginPercent: number | null;
}

export interface MarginTotals {
  revenue: number;
  /** Venta de las filas con costo completo: sobre ella se calcula el margen */
  revenueWithCost: number;
  cost: number;
  margin: number;
  marginPercent: number | null;
  /** Venta de las filas sin costo: no entra al margen para no inflarlo */
  revenueWithoutCost: number;
  rowsWithoutCost: number;
}

export interface MarginReport {
  from: string;
  to: string;
  products: MarginRow[];
  services: MarginRow[];
  totals: { products: MarginTotals; services: MarginTotals; all: MarginTotals };
  previous: { from: string; to: string };
  /** Venta sin IGV y margen del período anterior (para comparar) */
  previousTotals: {
    revenue: number;
    margin: number;
    marginPercent: number | null;
  };
  grain: Grain;
  series: MarginBucket[];
  /** Descuentos del período (con IGV): lo que se dejó de cobrar */
  discounts: number;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const pct = (margin: number, revenue: number) =>
  revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;

/**
 * Margen bruto: venta sin IGV menos el costo de lo que salió del inventario por FEFO (el costo
 * de cada lote). En servicios, el costo son sus insumos: no incluye la mano de obra.
 */
@Injectable()
export class MarginReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    clinicId: number,
    from: string,
    to: string,
  ): Promise<MarginReport> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const p = periodOf(timezone, from, to);
    const previous = previousOf(timezone, p, clinicDay(timezone));
    const grain = grainOf(p);

    // Por cada cargo: su venta sin IGV y el costo neto de sus salidas de stock (las devoluciones
    // restan). Falta costo si algún lote no lo tiene o si se usó un insumo sin stock registrado.
    const rows = await this.prisma.$queryRaw<
      {
        kind: SaleKind;
        id: number | null;
        name: string;
        category: string | null;
        unit: string | null;
        quantity: unknown;
        revenue: unknown;
        cost: unknown;
        missing: boolean;
      }[]
    >(Prisma.sql`
      WITH ch AS (
        SELECT c.id, c.kind, c.care_service_id, c.product_id, c.description, c.taxable_amount,
               c.quantity * COALESCE(pp.factor, 1) AS base_qty
        FROM charges c
        LEFT JOIN product_presentations pp ON pp.id = c.presentation_id
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID'
          AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
      ),
      mv AS (
        SELECT m.ref_id AS charge_id,
               SUM(-m.quantity * b.unit_cost) AS cost,
               BOOL_OR(m.batch_id IS NOT NULL AND b.unit_cost IS NULL) AS missing
        FROM stock_movements m
        LEFT JOIN product_batches b ON b.id = m.batch_id
        WHERE m.clinic_id = ${clinicId} AND m.ref_type = 'charge'
          AND m.ref_id IN (SELECT id FROM ch)
        GROUP BY m.ref_id
      ),
      sh AS (
        SELECT DISTINCT s.charge_id FROM stock_shortages s
        WHERE s.clinic_id = ${clinicId} AND s.charge_id IN (SELECT id FROM ch)
      )
      SELECT ch.kind::text AS kind,
             COALESCE(ch.care_service_id, ch.product_id) AS id,
             COALESCE(cs.name, pr.name, MIN(ch.description)) AS name,
             COALESCE(cs.category::text, pr.category::text) AS category,
             pr.base_unit::text AS unit,
             SUM(ch.base_qty) AS quantity,
             SUM(ch.taxable_amount) AS revenue,
             SUM(COALESCE(mv.cost, 0)) AS cost,
             BOOL_OR(COALESCE(mv.missing, false) OR sh.charge_id IS NOT NULL
                     OR (ch.kind = 'PRODUCT' AND mv.charge_id IS NULL)) AS missing
      FROM ch
      LEFT JOIN mv ON mv.charge_id = ch.id
      LEFT JOIN sh ON sh.charge_id = ch.id
      LEFT JOIN care_services cs ON cs.id = ch.care_service_id
      LEFT JOIN products pr ON pr.id = ch.product_id
      GROUP BY ch.kind, ch.care_service_id, ch.product_id, cs.name, pr.name, cs.category, pr.category, pr.base_unit
      ORDER BY revenue DESC`);

    const all: MarginRow[] = rows.map((r) => {
      const revenue = round2(num(r.revenue));
      const cost = r.missing ? null : round2(num(r.cost));
      const margin = cost === null ? null : round2(revenue - cost);
      return {
        kind: r.kind,
        id: r.id,
        name: r.name,
        category: r.category,
        quantity: Math.round(num(r.quantity) * 1000) / 1000,
        unit: r.kind === 'PRODUCT' ? r.unit : null,
        revenue,
        cost,
        margin,
        marginPercent: margin === null ? null : pct(margin, revenue),
      };
    });
    const products = all.filter((r) => r.kind === 'PRODUCT');
    const services = all.filter((r) => r.kind === 'SERVICE');
    const [byBucket, prev, discounts] = await Promise.all([
      this.costBy(
        clinicId,
        p,
        bucketSql(timezone, Prisma.sql`c.created_at`, grain),
      ),
      this.costBy(clinicId, previous, Prisma.sql`'all'`),
      this.prisma.charge.aggregate({
        where: {
          clinicId,
          status: { not: 'VOID' },
          createdAt: { gte: p.start, lt: p.end },
        },
        _sum: { discount: true },
      }),
    ]);
    const map = new Map(byBucket.map((r) => [r.key, r]));
    const prevRow = prev[0];
    return {
      from: p.from,
      to: p.to,
      products,
      services,
      totals: {
        products: totals(products),
        services: totals(services),
        all: totals(all),
      },
      previous: { from: previous.from, to: previous.to },
      previousTotals: {
        revenue: prevRow?.revenue ?? 0,
        margin: prevRow?.margin ?? 0,
        marginPercent: prevRow
          ? pct(prevRow.margin, prevRow.revenueWithCost)
          : null,
      },
      grain,
      series: bucketsOf(p, grain).map((b) => {
        const r = map.get(b.key);
        return {
          ...b,
          revenue: r?.revenue ?? 0,
          margin: r?.margin ?? 0,
          marginPercent: r ? pct(r.margin, r.revenueWithCost) : null,
        };
      }),
      discounts: round2(num(discounts._sum.discount)),
    };
  }

  /**
   * Venta sin IGV y margen agrupados por la expresión dada. Un cargo sin costo completo (lote
   * sin costo, insumo sin stock o producto sin salida) entra a la venta pero no al margen.
   */
  private async costBy(
    clinicId: number,
    p: Period,
    key: Prisma.Sql,
  ): Promise<
    { key: string; revenue: number; revenueWithCost: number; margin: number }[]
  > {
    const rows = await this.prisma.$queryRaw<
      {
        key: string;
        revenue: unknown;
        revenue_with_cost: unknown;
        cost: unknown;
      }[]
    >(Prisma.sql`
      WITH ch AS (
        SELECT c.id, c.kind, c.taxable_amount, ${key} AS key
        FROM charges c
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID'
          AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
      ),
      mv AS (
        SELECT m.ref_id AS charge_id,
               SUM(-m.quantity * b.unit_cost) AS cost,
               BOOL_OR(m.batch_id IS NOT NULL AND b.unit_cost IS NULL) AS missing
        FROM stock_movements m
        LEFT JOIN product_batches b ON b.id = m.batch_id
        WHERE m.clinic_id = ${clinicId} AND m.ref_type = 'charge'
          AND m.ref_id IN (SELECT id FROM ch)
        GROUP BY m.ref_id
      ),
      sh AS (
        SELECT DISTINCT s.charge_id FROM stock_shortages s
        WHERE s.clinic_id = ${clinicId} AND s.charge_id IN (SELECT id FROM ch)
      ),
      x AS (
        SELECT ch.key, ch.taxable_amount, COALESCE(mv.cost, 0) AS cost,
               (COALESCE(mv.missing, false) OR sh.charge_id IS NOT NULL
                OR (ch.kind = 'PRODUCT' AND mv.charge_id IS NULL)) AS missing
        FROM ch
        LEFT JOIN mv ON mv.charge_id = ch.id
        LEFT JOIN sh ON sh.charge_id = ch.id
      )
      SELECT key, SUM(taxable_amount) AS revenue,
             SUM(taxable_amount) FILTER (WHERE NOT missing) AS revenue_with_cost,
             SUM(cost) FILTER (WHERE NOT missing) AS cost
      FROM x GROUP BY key`);
    return rows.map((r) => {
      const revenueWithCost = round2(num(r.revenue_with_cost));
      return {
        key: r.key,
        revenue: round2(num(r.revenue)),
        revenueWithCost,
        margin: round2(revenueWithCost - num(r.cost)),
      };
    });
  }
}

function totals(rows: MarginRow[]): MarginTotals {
  const withCost = rows.filter((r) => r.cost !== null);
  const revenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
  const revenueWithCost = round2(withCost.reduce((s, r) => s + r.revenue, 0));
  const cost = round2(withCost.reduce((s, r) => s + (r.cost ?? 0), 0));
  const margin = round2(revenueWithCost - cost);
  return {
    revenue,
    revenueWithCost,
    cost,
    margin,
    marginPercent: pct(margin, revenueWithCost),
    revenueWithoutCost: round2(revenue - revenueWithCost),
    rowsWithoutCost: rows.length - withCost.length,
  };
}
