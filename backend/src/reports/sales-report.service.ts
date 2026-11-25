import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  ElectronicDocumentType,
  GroomingTransport,
  PaymentMethod,
  Role,
  Species,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { clinicDay, toDbDate } from '../common/time/clinic-day.js';
import {
  addDays,
  addMonths,
  bucketSql,
  bucketsOf,
  daysOf,
  grainOf,
  periodOf,
  previousMonthRange,
  previousOf,
  round2,
} from './report-period.js';
import type { Bucket, Grain, Period } from './report-period.js';

export type SaleKind = 'SERVICE' | 'PRODUCT';

export interface SalesKpis {
  /** Cargos registrados que no se anularon (con IGV), cobrados o no */
  sold: number;
  /** De lo vendido en el período, lo que aún se debe */
  pending: number;
  /** Pagos recibidos menos devoluciones: lo mismo que suma la caja */
  collected: number;
  /** Cobros vigentes (tickets) */
  receipts: number;
  /** Promedio de los cobros vigentes */
  averageTicket: number;
  /** Atenciones abiertas en el período que no se cancelaron */
  visits: number;
  /** Clientes registrados en el período (vengan o no) */
  newClients: number;
  /** Clientes atendidos por primera vez en el período (su primer cargo cae aquí) */
  firstTime: number;
}

/** Un grupo del gráfico: una hora, un día, una semana (desde su lunes) o un mes */
export interface SalesBucket {
  key: string;
  from: string;
  to: string;
  services: number;
  products: number;
  /** Atenciones abiertas en el grupo (no canceladas) */
  visits: number;
  /** Cobros vigentes del grupo y su promedio */
  receipts: number;
  averageTicket: number;
  collected: number;
}

export interface SalesHeatCell {
  /** 1 = lunes … 7 = domingo */
  dow: number;
  hour: number;
  amount: number;
}

export interface SalesSpecies {
  /** null = venta de mostrador sin mascota */
  species: Species | null;
  amount: number;
  pets: number;
}

export interface SalesDocument {
  type: ElectronicDocumentType;
  count: number;
  amount: number;
}

export interface SalesTopClient {
  client: { id: number; name: string };
  amount: number;
  visits: number;
  pets: number;
}

export interface SalesClients {
  /** Clientes que compraron en el período (sin “Clientes varios”) */
  total: number;
  /** De ellos, los atendidos por primera vez en el período */
  newOnes: number;
  /** De ellos, los que vinieron 2 días o más (contando antes del período) */
  repeat: number;
  series: { key: string; returning: number; newOnes: number }[];
}

/** Lo que se debe hoy (de cualquier fecha), por antigüedad */
export interface SalesReceivables {
  total: number;
  clients: number;
  aging: { upTo7: number; upTo30: number; older: number };
  top: {
    client: { id: number; name: string };
    amount: number;
    charges: number;
    oldestAt: Date;
  }[];
}

export interface SalesTransport {
  amount: number;
  count: number;
  byType: { transport: GroomingTransport; count: number }[];
  /** Mascotas de hoy que esperan ser llevadas a casa */
  pendingHome: number;
}

export interface SalesItem {
  kind: SaleKind;
  /** Servicio o producto del catálogo */
  id: number | null;
  name: string;
  category: string | null;
  /** Veces que se hizo (servicios) o unidades mínimas vendidas (productos) */
  quantity: number;
  /** Unidad mínima del producto (UNIT, ML, G…) */
  unit: string | null;
  amount: number;
}

export interface SalesCategory {
  kind: SaleKind;
  category: string | null;
  amount: number;
  lines: number;
}

export interface SalesProfessional {
  /** null = ventas de mostrador (sin atención) */
  user: { id: number; fullName: string; role: Role } | null;
  visits: number;
  services: number;
  products: number;
  amount: number;
}

export interface SalesMethod {
  method: PaymentMethod;
  amount: number;
  payments: number;
}

/** Inicio: el mes en curso contra el mes anterior hasta el mismo día */
export interface MonthSummary {
  from: string;
  to: string;
  previous: { from: string; to: string };
  kpis: SalesKpis;
  previousKpis: SalesKpis;
  /** Cobrado por día: este mes hasta hoy y el mes anterior completo (para la tendencia) */
  days: { day: string; collected: number }[];
  previousDays: { day: string; collected: number }[];
  /** Cobrado por día de las últimas 3 semanas hasta hoy (barras del inicio y "vs. la semana pasada") */
  recent: { day: string; collected: number }[];
}

export interface SalesReport {
  from: string;
  to: string;
  previous: { from: string; to: string };
  kpis: SalesKpis;
  previousKpis: SalesKpis;
  grain: Grain;
  series: SalesBucket[];
  /** Vendido del período anterior en los mismos grupos (por posición) */
  previousSeries: { key: string; sold: number }[];
  categories: SalesCategory[];
  items: SalesItem[];
  professionals: SalesProfessional[];
  methods: SalesMethod[];
  heatmap: SalesHeatCell[];
  species: SalesSpecies[];
  documents: SalesDocument[];
  topClients: SalesTopClient[];
  clients: SalesClients;
  receivables: SalesReceivables;
  transport: SalesTransport;
  /** Vendido de los últimos 12 meses (hasta el mes de hoy) y del mismo mes del año anterior */
  months: { month: string; sold: number; previous: number }[];
  /** Mascotas con un refuerzo vencido en los últimos 180 días */
  overdueBoosters: number;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

const SERVICE_CATEGORY: Record<string, string> = {
  CONSULTATION: 'Consultas',
  VACCINATION: 'Vacunación',
  DEWORMING: 'Desparasitación',
  SURGERY: 'Cirugías',
  LAB: 'Laboratorio',
  GROOMING: 'Baño y grooming',
  HOSPITALIZATION: 'Hospitalización',
  OTHER: 'Otros servicios',
};
const PRODUCT_CATEGORY: Record<string, string> = {
  MEDICINE: 'Medicamentos',
  VACCINE: 'Vacunas (producto)',
  ANTIPARASITIC: 'Antiparasitarios',
  FOOD: 'Alimentos',
  ACCESSORY: 'Accesorios',
  HYGIENE: 'Higiene',
  SUPPLY: 'Insumos',
};
export function categoryLabel(kind: SaleKind, category: string | null) {
  if (!category)
    return kind === 'SERVICE' ? 'Otros servicios' : 'Otros productos';
  return (
    (kind === 'SERVICE' ? SERVICE_CATEGORY : PRODUCT_CATEGORY)[category] ??
    category
  );
}

/**
 * Reporte de ventas del período con la comparación contra el período anterior.
 * Vendido = cargos no anulados; cobrado = pagos menos devoluciones (como la caja).
 */
@Injectable()
export class SalesReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    clinicId: number,
    from: string,
    to: string,
  ): Promise<SalesReport> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const today = clinicDay(timezone);
    const period = periodOf(timezone, from, to);
    const previous = previousOf(timezone, period, today);
    const grain = grainOf(period);
    const range = (p: Period, column: Prisma.Sql) =>
      Prisma.sql`${column} >= ${p.start} AND ${column} < ${p.end}`;
    const key = (column: Prisma.Sql) => bucketSql(timezone, column, grain);
    const notVoid = Prisma.sql`c.clinic_id = ${clinicId} AND c.status <> 'VOID'`;

    const [
      kpis,
      previousKpis,
      soldByBucket,
      collectedByBucket,
      refundedByBucket,
      previousSold,
      items,
      proSales,
      proVisits,
      methods,
      refundsByMethod,
    ] = await Promise.all([
      this.kpis(clinicId, period),
      this.kpis(clinicId, previous),
      this.prisma.$queryRaw<
        { key: string; kind: SaleKind; amount: unknown }[]
      >(Prisma.sql`
          SELECT ${key(Prisma.sql`c.created_at`)} AS key, c.kind::text AS kind, SUM(c.total) AS amount
          FROM charges c
          WHERE ${notVoid} AND ${range(period, Prisma.sql`c.created_at`)}
          GROUP BY 1, 2`),
      this.prisma.$queryRaw<{ key: string; amount: unknown }[]>(Prisma.sql`
          SELECT ${key(Prisma.sql`r.created_at`)} AS key, SUM(p.amount) AS amount
          FROM payments p JOIN receipts r ON r.id = p.receipt_id
          WHERE p.clinic_id = ${clinicId} AND r.clinic_id = ${clinicId} AND ${range(period, Prisma.sql`r.created_at`)}
          GROUP BY 1`),
      this.prisma.$queryRaw<{ key: string; amount: unknown }[]>(Prisma.sql`
          SELECT ${key(Prisma.sql`m.created_at`)} AS key, SUM(m.amount) AS amount
          FROM cash_movements m
          WHERE m.clinic_id = ${clinicId} AND m.kind = 'REFUND' AND m.voided_at IS NULL
            AND ${range(period, Prisma.sql`m.created_at`)}
          GROUP BY 1`),
      this.prisma.$queryRaw<{ key: string; amount: unknown }[]>(Prisma.sql`
          SELECT ${key(Prisma.sql`c.created_at`)} AS key, SUM(c.total) AS amount
          FROM charges c
          WHERE ${notVoid} AND ${range(previous, Prisma.sql`c.created_at`)}
          GROUP BY 1`),
      this.prisma.$queryRaw<
        {
          kind: SaleKind;
          id: number | null;
          name: string;
          category: string | null;
          unit: string | null;
          quantity: unknown;
          amount: unknown;
          lines: bigint;
        }[]
      >(Prisma.sql`
          SELECT c.kind::text AS kind,
                 COALESCE(c.care_service_id, c.product_id) AS id,
                 COALESCE(cs.name, p.name, MIN(c.description)) AS name,
                 COALESCE(cs.category::text, p.category::text) AS category,
                 p.base_unit::text AS unit,
                 SUM(c.quantity * COALESCE(pp.factor, 1)) AS quantity,
                 SUM(c.total) AS amount,
                 COUNT(*) AS lines
          FROM charges c
          LEFT JOIN care_services cs ON cs.id = c.care_service_id
          LEFT JOIN products p ON p.id = c.product_id
          LEFT JOIN product_presentations pp ON pp.id = c.presentation_id
          WHERE ${notVoid} AND ${range(period, Prisma.sql`c.created_at`)}
          GROUP BY c.kind, c.care_service_id, c.product_id, cs.name, p.name, cs.category, p.category, p.base_unit
          ORDER BY amount DESC`),
      // Quién atendió: el groomer en grooming, si no el veterinario de la atención; sin atención = mostrador
      this.prisma.$queryRaw<
        { user_id: number | null; kind: SaleKind; amount: unknown }[]
      >(Prisma.sql`
          SELECT CASE WHEN c.visit_id IS NULL THEN NULL ELSE COALESCE(g.groomer_id, v.attended_by_id) END AS user_id,
                 c.kind::text AS kind, SUM(c.total) AS amount
          FROM charges c
          LEFT JOIN visits v ON v.id = c.visit_id
          LEFT JOIN grooming_sessions g ON g.visit_id = c.visit_id
          WHERE ${notVoid} AND ${range(period, Prisma.sql`c.created_at`)}
          GROUP BY 1, 2`),
      this.prisma.$queryRaw<{ user_id: number; visits: bigint }[]>(Prisma.sql`
          SELECT COALESCE(g.groomer_id, v.attended_by_id) AS user_id, COUNT(*) AS visits
          FROM visits v
          LEFT JOIN grooming_sessions g ON g.visit_id = v.id
          WHERE v.clinic_id = ${clinicId} AND v.status <> 'CANCELLED' AND ${range(period, Prisma.sql`v.opened_at`)}
          GROUP BY 1`),
      this.prisma.$queryRaw<
        { method: PaymentMethod; amount: unknown; payments: bigint }[]
      >(Prisma.sql`
          SELECT p.method::text AS method, SUM(p.amount) AS amount, COUNT(*) AS payments
          FROM payments p JOIN receipts r ON r.id = p.receipt_id
          WHERE p.clinic_id = ${clinicId} AND r.clinic_id = ${clinicId} AND ${range(period, Prisma.sql`r.created_at`)}
          GROUP BY 1`),
      this.prisma.$queryRaw<
        { method: PaymentMethod; amount: unknown }[]
      >(Prisma.sql`
          SELECT m.method::text AS method, SUM(m.amount) AS amount
          FROM cash_movements m
          WHERE m.clinic_id = ${clinicId} AND m.kind = 'REFUND' AND m.voided_at IS NULL
            AND ${range(period, Prisma.sql`m.created_at`)}
          GROUP BY 1`),
    ]);

    // ── En el tiempo: todos los grupos del período, aunque no haya ventas ──
    const buckets = bucketsOf(period, grain);
    const byKey = new Map<string, SalesBucket>(
      buckets.map((b) => [
        b.key,
        {
          ...b,
          services: 0,
          products: 0,
          collected: 0,
          visits: 0,
          receipts: 0,
          averageTicket: 0,
        },
      ]),
    );
    for (const r of soldByBucket) {
      const d = byKey.get(r.key);
      if (d)
        d[r.kind === 'SERVICE' ? 'services' : 'products'] = round2(
          num(r.amount),
        );
    }
    for (const r of collectedByBucket) {
      const d = byKey.get(r.key);
      if (d) d.collected = round2(d.collected + num(r.amount));
    }
    for (const r of refundedByBucket) {
      const d = byKey.get(r.key);
      if (d) d.collected = round2(d.collected - num(r.amount));
    }
    const [visitsByBucket, receiptsByBucket] = await Promise.all([
      this.prisma.$queryRaw<{ key: string; n: bigint }[]>(Prisma.sql`
          SELECT ${key(Prisma.sql`v.opened_at`)} AS key, COUNT(*) AS n
          FROM visits v
          WHERE v.clinic_id = ${clinicId} AND v.status <> 'CANCELLED'
            AND ${range(period, Prisma.sql`v.opened_at`)}
          GROUP BY 1`),
      this.prisma.$queryRaw<{ key: string; n: bigint; total: unknown }[]>(
        Prisma.sql`
          SELECT ${key(Prisma.sql`r.created_at`)} AS key, COUNT(*) AS n, SUM(r.total) AS total
          FROM receipts r
          WHERE r.clinic_id = ${clinicId} AND r.status = 'ACTIVE'
            AND ${range(period, Prisma.sql`r.created_at`)}
          GROUP BY 1`,
      ),
    ]);
    for (const r of visitsByBucket) {
      const d = byKey.get(r.key);
      if (d) d.visits = Number(r.n);
    }
    for (const r of receiptsByBucket) {
      const d = byKey.get(r.key);
      if (!d) continue;
      d.receipts = Number(r.n);
      d.averageTicket = d.receipts ? round2(num(r.total) / d.receipts) : 0;
    }
    const prevAmounts = new Map(
      previousSold.map((r) => [r.key, round2(num(r.amount))]),
    );
    const previousSeries = bucketsOf(previous, grain).map((b) => ({
      key: b.key,
      sold: prevAmounts.get(b.key) ?? 0,
    }));

    // ── Servicios y productos, y por categoría ──
    const itemRows: SalesItem[] = items.map((r) => ({
      kind: r.kind,
      id: r.id,
      name: r.name,
      category: r.category,
      quantity: Math.round(num(r.quantity) * 1000) / 1000,
      unit: r.kind === 'PRODUCT' ? r.unit : null,
      amount: round2(num(r.amount)),
    }));
    const byCategory = new Map<string, SalesCategory>();
    for (const [i, r] of itemRows.entries()) {
      const k = `${r.kind}:${r.category ?? ''}`;
      const row = byCategory.get(k) ?? {
        kind: r.kind,
        category: r.category,
        amount: 0,
        lines: 0,
      };
      row.amount = round2(row.amount + r.amount);
      row.lines += Number(items[i].lines);
      byCategory.set(k, row);
    }

    // ── Por profesional ──
    const ids = [
      ...new Set(
        [
          ...proSales.map((r) => r.user_id),
          ...proVisits.map((r) => r.user_id),
        ].filter((id): id is number => id != null),
      ),
    ];
    const users = await this.prisma.user.findMany({
      where: { clinicId, id: { in: ids } },
      select: { id: true, fullName: true, role: true },
    });
    const pros = new Map<number | null, SalesProfessional>();
    const pro = (id: number | null) => {
      let row = pros.get(id);
      if (!row) {
        row = {
          user: id == null ? null : (users.find((u) => u.id === id) ?? null),
          visits: 0,
          services: 0,
          products: 0,
          amount: 0,
        };
        pros.set(id, row);
      }
      return row;
    };
    for (const r of proSales) {
      const row = pro(r.user_id);
      const amount = round2(num(r.amount));
      if (r.kind === 'SERVICE') row.services = round2(row.services + amount);
      else row.products = round2(row.products + amount);
      row.amount = round2(row.amount + amount);
    }
    for (const r of proVisits) pro(r.user_id).visits += Number(r.visits);
    // Profesionales de mayor a menor venta; el mostrador al final
    const professionals = [...pros.values()].sort((a, b) =>
      !a.user ? 1 : !b.user ? -1 : b.amount - a.amount,
    );

    // ── Medios de pago: pagos menos devoluciones por el mismo medio ──
    const methodRows = new Map<PaymentMethod, SalesMethod>();
    for (const r of methods)
      methodRows.set(r.method, {
        method: r.method,
        amount: round2(num(r.amount)),
        payments: Number(r.payments),
      });
    for (const r of refundsByMethod) {
      const row = methodRows.get(r.method) ?? {
        method: r.method,
        amount: 0,
        payments: 0,
      };
      row.amount = round2(row.amount - num(r.amount));
      methodRows.set(r.method, row);
    }

    const [
      heatmap,
      species,
      documents,
      topClients,
      clients,
      receivables,
      transport,
      months,
      overdueBoosters,
    ] = await Promise.all([
      this.heatmap(clinicId, timezone, period),
      this.species(clinicId, period),
      this.documents(clinicId, period),
      this.topClients(clinicId, period),
      this.clients(clinicId, timezone, period, grain, buckets),
      this.receivables(clinicId),
      this.transport(clinicId, period, today),
      this.months(clinicId, timezone, today),
      this.overdueBoosters(clinicId, today),
    ]);

    return {
      from: period.from,
      to: period.to,
      previous: { from: previous.from, to: previous.to },
      kpis,
      previousKpis,
      grain,
      series: [...byKey.values()],
      previousSeries,
      categories: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
      items: itemRows,
      professionals,
      methods: [...methodRows.values()].sort((a, b) => b.amount - a.amount),
      heatmap,
      species,
      documents,
      topClients,
      clients,
      receivables,
      transport,
      months,
      overdueBoosters,
    };
  }

  /** Vendido por día de la semana y hora (en la zona de la clínica) */
  private async heatmap(
    clinicId: number,
    timezone: string,
    p: Period,
  ): Promise<SalesHeatCell[]> {
    const rows = await this.prisma.$queryRaw<
      { dow: number; hour: number; amount: unknown }[]
    >(Prisma.sql`
      SELECT EXTRACT(ISODOW FROM c.created_at AT TIME ZONE ${timezone})::int AS dow,
             EXTRACT(HOUR FROM c.created_at AT TIME ZONE ${timezone})::int AS hour,
             SUM(c.total) AS amount
      FROM charges c
      WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID'
        AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
      GROUP BY 1, 2`);
    return rows
      .map((r) => ({ dow: r.dow, hour: r.hour, amount: round2(num(r.amount)) }))
      .sort((a, b) => a.dow - b.dow || a.hour - b.hour);
  }

  /** Por especie de la mascota del cargo (o de su atención); sin mascota = mostrador */
  private async species(clinicId: number, p: Period): Promise<SalesSpecies[]> {
    const rows = await this.prisma.$queryRaw<
      { species: Species | null; amount: unknown; pets: bigint }[]
    >(Prisma.sql`
      SELECT pe.species::text AS species, SUM(c.total) AS amount, COUNT(DISTINCT pe.id) AS pets
      FROM charges c
      LEFT JOIN visits v ON v.id = c.visit_id
      LEFT JOIN pets pe ON pe.id = COALESCE(c.pet_id, v.pet_id)
      WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID'
        AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
      GROUP BY 1
      ORDER BY amount DESC`);
    return rows.map((r) => ({
      species: r.species,
      amount: round2(num(r.amount)),
      pets: Number(r.pets),
    }));
  }

  /** Boletas, facturas y notas de crédito emitidas en el período (sin las rechazadas) */
  private async documents(
    clinicId: number,
    p: Period,
  ): Promise<SalesDocument[]> {
    const rows = await this.prisma.electronicDocument.groupBy({
      by: ['type'],
      where: {
        clinicId,
        status: { not: 'REJECTED' },
        issueDate: { gte: toDbDate(p.from), lte: toDbDate(p.to) },
      },
      _count: { _all: true },
      _sum: { total: true },
    });
    const order: ElectronicDocumentType[] = [
      'BOLETA',
      'FACTURA',
      'CREDIT_NOTE',
    ];
    return order.map((type) => {
      const r = rows.find((x) => x.type === type);
      return {
        type,
        count: r?._count._all ?? 0,
        amount: round2(num(r?._sum.total)),
      };
    });
  }

  /** Los 10 clientes que más compraron (sin “Clientes varios”) */
  private async topClients(
    clinicId: number,
    p: Period,
  ): Promise<SalesTopClient[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        name: string;
        amount: unknown;
        visits: bigint;
        pets: bigint;
      }[]
    >(Prisma.sql`
      SELECT cl.id, cl.name, SUM(c.total) AS amount,
             COUNT(DISTINCT c.visit_id) AS visits, COUNT(DISTINCT c.pet_id) AS pets
      FROM charges c JOIN clients cl ON cl.id = c.client_id
      WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND NOT cl.walk_in
        AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
      GROUP BY cl.id, cl.name
      ORDER BY amount DESC, cl.name
      LIMIT 50`);
    return rows.map((r) => ({
      client: { id: r.id, name: r.name },
      amount: round2(num(r.amount)),
      visits: Number(r.visits),
      pets: Number(r.pets),
    }));
  }

  /**
   * Clientes atendidos: en cada grupo, los que vienen por primera vez (su primer cargo cae en ese
   * grupo) y los que vuelven. En el total, cuántos vinieron más de una vez (2 días o más, contando
   * antes del período).
   */
  private async clients(
    clinicId: number,
    timezone: string,
    p: Period,
    grain: Grain,
    buckets: Bucket[],
  ): Promise<SalesClients> {
    const key = (column: Prisma.Sql) => bucketSql(timezone, column, grain);
    const [series, totals] = await Promise.all([
      this.prisma.$queryRaw<{ key: string; total: bigint; new_ones: bigint }[]>(
        Prisma.sql`
        WITH firsts AS (
          SELECT c.client_id, MIN(c.created_at) AS first_at
          FROM charges c JOIN clients cl ON cl.id = c.client_id
          WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND NOT cl.walk_in
            AND c.created_at < ${p.end}
          GROUP BY c.client_id
        )
        SELECT t.key, COUNT(*) AS total, COUNT(*) FILTER (WHERE t.first_key = t.key) AS new_ones
        FROM (
          SELECT DISTINCT ${key(Prisma.sql`c.created_at`)} AS key, c.client_id,
                 ${key(Prisma.sql`f.first_at`)} AS first_key
          FROM charges c JOIN firsts f ON f.client_id = c.client_id
          WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID'
            AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
        ) t GROUP BY t.key`,
      ),
      this.prisma.$queryRaw<
        { total: bigint; new_ones: bigint; repeat: bigint }[]
      >(Prisma.sql`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE t.first_at >= ${p.start}) AS new_ones,
               COUNT(*) FILTER (WHERE t.days >= 2) AS repeat
        FROM (
          SELECT c.client_id, MIN(c.created_at) AS first_at,
                 COUNT(DISTINCT (c.created_at AT TIME ZONE ${timezone})::date) AS days
          FROM charges c JOIN clients cl ON cl.id = c.client_id
          WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND NOT cl.walk_in
            AND c.created_at < ${p.end}
          GROUP BY c.client_id
          HAVING MAX(c.created_at) >= ${p.start}
        ) t`),
    ]);
    const map = new Map(series.map((r) => [r.key, r]));
    return {
      total: Number(totals[0]?.total ?? 0),
      newOnes: Number(totals[0]?.new_ones ?? 0),
      repeat: Number(totals[0]?.repeat ?? 0),
      series: buckets.map((b) => {
        const r = map.get(b.key);
        const total = Number(r?.total ?? 0);
        const newOnes = Number(r?.new_ones ?? 0);
        return { key: b.key, returning: total - newOnes, newOnes };
      }),
    };
  }

  /** Lo que se debe hoy, de cualquier fecha, por antigüedad, y quién debe más */
  private async receivables(clinicId: number): Promise<SalesReceivables> {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86_400_000);
    const d30 = new Date(now.getTime() - 30 * 86_400_000);
    const [aging, top] = await Promise.all([
      this.prisma.$queryRaw<
        { up7: unknown; up30: unknown; older: unknown; clients: bigint }[]
      >(Prisma.sql`
        SELECT SUM(total - paid_amount) FILTER (WHERE created_at >= ${d7}) AS up7,
               SUM(total - paid_amount) FILTER (WHERE created_at < ${d7} AND created_at >= ${d30}) AS up30,
               SUM(total - paid_amount) FILTER (WHERE created_at < ${d30}) AS older,
               COUNT(DISTINCT client_id) AS clients
        FROM charges
        WHERE clinic_id = ${clinicId} AND status = 'PENDING' AND total > paid_amount`),
      this.prisma.$queryRaw<
        {
          id: number;
          name: string;
          amount: unknown;
          charges: bigint;
          oldest: Date;
        }[]
      >(Prisma.sql`
        SELECT cl.id, cl.name, SUM(c.total - c.paid_amount) AS amount, COUNT(*) AS charges,
               MIN(c.created_at) AS oldest
        FROM charges c JOIN clients cl ON cl.id = c.client_id
        WHERE c.clinic_id = ${clinicId} AND c.status = 'PENDING' AND c.total > c.paid_amount
        GROUP BY cl.id, cl.name
        ORDER BY amount DESC, cl.name
        LIMIT 100`),
    ]);
    const a = aging[0];
    const upTo7 = round2(num(a?.up7));
    const upTo30 = round2(num(a?.up30));
    const older = round2(num(a?.older));
    return {
      total: round2(upTo7 + upTo30 + older),
      clients: Number(a?.clients ?? 0),
      aging: { upTo7, upTo30, older },
      top: top.map((r) => ({
        client: { id: r.id, name: r.name },
        amount: round2(num(r.amount)),
        charges: Number(r.charges),
        oldestAt: r.oldest,
      })),
    };
  }

  /** Movilidad cobrada en el período, por tipo, y las mascotas de hoy por llevar a casa */
  private async transport(
    clinicId: number,
    p: Period,
    today: string,
  ): Promise<SalesTransport> {
    const [rows, pending] = await Promise.all([
      this.prisma.$queryRaw<
        {
          transport: GroomingTransport | null;
          amount: unknown;
          count: bigint;
        }[]
      >(Prisma.sql`
        SELECT COALESCE(q.transport, g.transport)::text AS transport,
               SUM(c.total) AS amount, COUNT(*) AS count
        FROM charges c
        JOIN care_services cs ON cs.id = c.care_service_id AND cs.system_key = 'TRANSPORT'
        LEFT JOIN queue_entries q ON q.transport_charge_id = c.id
        LEFT JOIN grooming_sessions g ON g.transport_charge_id = c.id
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID'
          AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
        GROUP BY 1`),
      this.prisma.queueEntry.count({
        where: {
          clinicId,
          day: toDbDate(today),
          status: 'DONE',
          transport: { in: ['DROPOFF', 'ROUND_TRIP'] },
          deliveredHomeAt: null,
        },
      }),
    ]);
    const byType = new Map<GroomingTransport, number>();
    let amount = 0;
    let count = 0;
    for (const r of rows) {
      amount += num(r.amount);
      count += Number(r.count);
      // Sin tipo: movilidad que quedó suelta (la atención se canceló y se cobró igual)
      const t = r.transport ?? 'ROUND_TRIP';
      byType.set(t, (byType.get(t) ?? 0) + Number(r.count));
    }
    return {
      amount: round2(amount),
      count,
      byType: [...byType.entries()]
        .map(([transport, n]) => ({ transport, count: n }))
        .sort((a, b) => b.count - a.count),
      pendingHome: pending,
    };
  }

  /** Vendido por mes: los últimos 12 hasta el de hoy y los 12 del año anterior */
  private async months(
    clinicId: number,
    timezone: string,
    today: string,
  ): Promise<{ month: string; sold: number; previous: number }[]> {
    const first = addMonths(`${today.slice(0, 7)}-01`, -11);
    const p = periodOf(timezone, addMonths(first, -12), today);
    const rows = await this.prisma.$queryRaw<
      { key: string; amount: unknown }[]
    >(
      Prisma.sql`
      SELECT ${bucketSql(timezone, Prisma.sql`c.created_at`, 'month')} AS key, SUM(c.total) AS amount
      FROM charges c
      WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID'
        AND c.created_at >= ${p.start} AND c.created_at < ${p.end}
      GROUP BY 1`,
    );
    const by = new Map(rows.map((r) => [r.key, round2(num(r.amount))]));
    return Array.from({ length: 12 }, (_, i) => {
      const month = addMonths(first, i).slice(0, 7);
      const prev = addMonths(first, i - 12).slice(0, 7);
      return { month, sold: by.get(month) ?? 0, previous: by.get(prev) ?? 0 };
    });
  }

  /** Mascotas con la última dosis de una vacuna o antiparasitario vencida (como Refuerzos) */
  private async overdueBoosters(
    clinicId: number,
    today: string,
  ): Promise<number> {
    const end = toDbDate(addDays(today, -1));
    const start = toDbDate(addDays(today, -180));
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT i.pet_id) AS n
      FROM immunizations i
      JOIN pets p ON p.id = i.pet_id
      JOIN clients c ON c.id = p.client_id
      WHERE i.clinic_id = ${clinicId} AND i.voided_at IS NULL
        AND i.next_due_at BETWEEN ${start} AND ${end}
        AND i.id = (
          SELECT n.id FROM immunizations n
          WHERE n.pet_id = i.pet_id AND n.kind = i.kind AND lower(n.name) = lower(i.name)
            AND n.voided_at IS NULL
          ORDER BY n.applied_at DESC, n.id DESC
          LIMIT 1)
        AND p.active AND p.deceased_at IS NULL
        AND c.active AND c.anonymized_at IS NULL`);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * El mes en curso hasta hoy contra el mes anterior del 1 al mismo día (o a su último día si
   * es más corto: el 31 de marzo se compara con el 1 al 28 de febrero).
   */
  async monthToDate(clinicId: number): Promise<MonthSummary> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const today = clinicDay(timezone);
    const from = `${today.slice(0, 7)}-01`;
    const prev = previousMonthRange(today);
    const period = periodOf(timezone, from, today);
    const previous = periodOf(timezone, prev.from, prev.to);
    const previousMonth = periodOf(timezone, prev.from, prev.last);
    const recentPeriod = periodOf(timezone, addDays(today, -20), today);
    const [kpis, previousKpis, days, previousDays, recent] = await Promise.all([
      this.kpis(clinicId, period),
      this.kpis(clinicId, previous),
      this.collectedByDay(clinicId, timezone, period),
      this.collectedByDay(clinicId, timezone, previousMonth),
      this.collectedByDay(clinicId, timezone, recentPeriod),
    ]);
    return {
      from,
      to: today,
      previous: { from: prev.from, to: prev.to },
      kpis,
      previousKpis,
      days,
      previousDays,
      recent,
    };
  }

  /** Pagos menos devoluciones por día (todos los días del período) */
  private async collectedByDay(
    clinicId: number,
    timezone: string,
    p: Period,
  ): Promise<{ day: string; collected: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { day: string; amount: unknown }[]
    >(Prisma.sql`
      SELECT day, SUM(amount) AS amount FROM (
        SELECT to_char((r.created_at AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS day, p.amount
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        WHERE p.clinic_id = ${clinicId} AND r.clinic_id = ${clinicId}
          AND r.created_at >= ${p.start} AND r.created_at < ${p.end}
        UNION ALL
        SELECT to_char((m.created_at AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD'), -m.amount
        FROM cash_movements m
        WHERE m.clinic_id = ${clinicId} AND m.kind = 'REFUND' AND m.voided_at IS NULL
          AND m.created_at >= ${p.start} AND m.created_at < ${p.end}
      ) t GROUP BY day`);
    const byDay = new Map(rows.map((r) => [r.day, round2(num(r.amount))]));
    return daysOf(p).map((day) => ({ day, collected: byDay.get(day) ?? 0 }));
  }

  private async kpis(clinicId: number, p: Period): Promise<SalesKpis> {
    const [sold, payments, refunds, receipts, visits, newClients, firstTime] =
      await Promise.all([
        this.prisma.$queryRaw<{ sold: unknown; pending: unknown }[]>(Prisma.sql`
        SELECT SUM(total) AS sold, SUM(total - paid_amount) AS pending FROM charges
        WHERE clinic_id = ${clinicId} AND status <> 'VOID' AND created_at >= ${p.start} AND created_at < ${p.end}`),
        this.prisma.payment.aggregate({
          where: {
            clinicId,
            // clinicId también en el cobro: usa el índice (clinic_id, created_at) de receipts
            receipt: { clinicId, createdAt: { gte: p.start, lt: p.end } },
          },
          _sum: { amount: true },
        }),
        this.prisma.cashMovement.aggregate({
          where: {
            clinicId,
            kind: 'REFUND',
            voidedAt: null,
            createdAt: { gte: p.start, lt: p.end },
          },
          _sum: { amount: true },
        }),
        this.prisma.receipt.aggregate({
          where: {
            clinicId,
            status: 'ACTIVE',
            createdAt: { gte: p.start, lt: p.end },
          },
          _sum: { total: true },
          _count: { _all: true },
        }),
        this.prisma.visit.count({
          where: {
            clinicId,
            status: { not: 'CANCELLED' },
            openedAt: { gte: p.start, lt: p.end },
          },
        }),
        this.prisma.client.count({
          where: {
            clinicId,
            walkIn: false,
            createdAt: { gte: p.start, lt: p.end },
          },
        }),
        this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS n FROM (
          SELECT c.client_id FROM charges c JOIN clients cl ON cl.id = c.client_id
          WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND NOT cl.walk_in
            AND c.created_at < ${p.end}
          GROUP BY c.client_id HAVING MIN(c.created_at) >= ${p.start}
        ) t`),
      ]);
    const count = receipts._count._all;
    return {
      sold: round2(num(sold[0]?.sold)),
      pending: round2(num(sold[0]?.pending)),
      collected: round2(num(payments._sum.amount) - num(refunds._sum.amount)),
      receipts: count,
      averageTicket: count ? round2(num(receipts._sum.total) / count) : 0,
      visits,
      newClients,
      firstTime: Number(firstTime[0]?.n ?? 0),
    };
  }
}
