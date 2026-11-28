import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';
import { saleNoteCode } from '../cash/cash-math.js';
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

type UserRef = { id: number; fullName: string; role: Role };

export interface ControlKpis {
  /** Descuentos de cargos no anulados (con IGV) */
  discounts: number;
  discountCount: number;
  /** Descuentos sobre lo que se habría cobrado sin ellos */
  discountPercent: number | null;
  /** Cargos quitados y cobros anulados */
  voided: number;
  voidCount: number;
  /** Suma de las diferencias de los cierres (negativo = faltó) */
  cashNet: number;
  cashSessions: number;
  cashWithDifference: number;
  /** Mermas y ajustes de conteo que restaron, a costo del lote */
  waste: number;
}

export interface ControlReport {
  from: string;
  to: string;
  previous: { from: string; to: string };
  kpis: ControlKpis;
  previousKpis: ControlKpis;
  grain: Grain;
  series: {
    key: string;
    from: string;
    to: string;
    discounts: number;
    voided: number;
  }[];
  /** Tope de descuento de la clínica (%) y el más alto que se dio en el período */
  maxDiscountPercent: number;
  maxApplied: number | null;
  discountsByUser: {
    user: UserRef | null;
    amount: number;
    count: number;
    percent: number | null;
  }[];
  discountsByReason: { reason: string; amount: number; count: number }[];
  discountClients: {
    client: { id: number; name: string };
    amount: number;
    count: number;
  }[];
  voids: {
    count: number;
    items: {
      kind: 'charge' | 'receipt';
      title: string;
      amount: number;
      reason: string | null;
      user: string | null;
      at: Date;
    }[];
  };
  closings: {
    /** Un punto por cierre (si el período es de hasta 62 días) */
    points: { id: number; at: Date; difference: number }[];
    /** Sobrantes y faltantes sumados por grupo (si el período es más largo) */
    buckets: { key: string; surplus: number; shortage: number }[];
    /** Solo los cierres con diferencia, del más reciente al más antiguo */
    items: {
      id: number;
      at: Date;
      difference: number;
      note: string | null;
      user: string | null;
    }[];
  };
  waste: {
    byType: { type: 'WASTE' | 'COUNT_ADJUST'; amount: number; count: number }[];
    items: {
      product: string;
      lot: string | null;
      quantity: number;
      unit: string;
      value: number | null;
      reason: string | null;
      type: 'WASTE' | 'COUNT_ADJUST';
      at: Date;
      user: string | null;
    }[];
  };
  people: {
    user: UserRef;
    receipts: number;
    collected: number;
    discounts: number;
    discountPercent: number | null;
    voids: number;
    cashDifference: number | null;
  }[];
  priceChanges: {
    count: number;
    items: {
      action: string;
      name: string;
      before: number | null;
      after: number | null;
      user: string | null;
      at: Date;
    }[];
  };
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/**
 * Control del dueño: descuentos, anulaciones, cierres de caja con diferencia, mermas y cambios
 * de precio del período. Todo sale de lo que el sistema ya guarda (cargos, cobros, caja,
 * movimientos de stock y la bitácora).
 */
@Injectable()
export class ControlReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    clinicId: number,
    from: string,
    to: string,
  ): Promise<ControlReport> {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true, maxDiscountPercent: true },
    });
    const { timezone } = clinic;
    const p = periodOf(timezone, from, to);
    const previous = previousOf(timezone, p, clinicDay(timezone));
    const grain = grainOf(p);
    const key = (col: Prisma.Sql) => bucketSql(timezone, col, grain);
    const inP = (col: Prisma.Sql) =>
      Prisma.sql`${col} >= ${p.start} AND ${col} < ${p.end}`;

    const [
      kpis,
      previousKpis,
      discBuckets,
      voidBuckets,
      byUser,
      byReason,
      clients,
      maxApplied,
      voidItems,
      closings,
      wasteTypes,
      wasteItems,
      receiptsByUser,
      voidsByUser,
      cashByUser,
      priceRows,
    ] = await Promise.all([
      this.kpis(clinicId, p),
      this.kpis(clinicId, previous),
      this.prisma.$queryRaw<{ key: string; amount: unknown }[]>(Prisma.sql`
        SELECT ${key(Prisma.sql`c.created_at`)} AS key, SUM(c.discount) AS amount
        FROM charges c
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND c.discount > 0 AND ${inP(Prisma.sql`c.created_at`)}
        GROUP BY 1`),
      this.prisma.$queryRaw<{ key: string; amount: unknown }[]>(Prisma.sql`
        SELECT key, SUM(amount) AS amount FROM (
          SELECT ${key(Prisma.sql`c.voided_at`)} AS key, c.total AS amount FROM charges c
          WHERE c.clinic_id = ${clinicId} AND c.status = 'VOID' AND ${inP(Prisma.sql`c.voided_at`)}
          UNION ALL
          SELECT ${key(Prisma.sql`r.voided_at`)}, r.total FROM receipts r
          WHERE r.clinic_id = ${clinicId} AND r.status = 'VOID' AND ${inP(Prisma.sql`r.voided_at`)}
        ) t GROUP BY key`),
      this.prisma.$queryRaw<
        { user_id: number; amount: unknown; count: bigint; gross: unknown }[]
      >(Prisma.sql`
        SELECT COALESCE(c.discount_by_id, c.created_by_id) AS user_id, SUM(c.discount) AS amount,
               COUNT(*) FILTER (WHERE c.discount > 0) AS count, SUM(c.total + c.discount) AS gross
        FROM charges c
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND ${inP(Prisma.sql`c.created_at`)}
        GROUP BY 1`),
      this.prisma.$queryRaw<
        { reason: string; amount: unknown; count: bigint }[]
      >(Prisma.sql`
        SELECT COALESCE(NULLIF(lower(trim(c.discount_reason)), ''), '') AS reason,
               SUM(c.discount) AS amount, COUNT(*) AS count
        FROM charges c
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND c.discount > 0 AND ${inP(Prisma.sql`c.created_at`)}
        GROUP BY 1 ORDER BY amount DESC`),
      this.prisma.$queryRaw<
        { id: number; name: string; amount: unknown; count: bigint }[]
      >(Prisma.sql`
        SELECT cl.id, cl.name, SUM(c.discount) AS amount, COUNT(*) AS count
        FROM charges c JOIN clients cl ON cl.id = c.client_id
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND c.discount > 0 AND ${inP(Prisma.sql`c.created_at`)}
        GROUP BY cl.id, cl.name ORDER BY amount DESC, cl.name LIMIT 5`),
      this.prisma.$queryRaw<{ max: unknown }[]>(Prisma.sql`
        SELECT MAX(c.discount / NULLIF(c.total + c.discount, 0)) AS max
        FROM charges c
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND c.discount > 0 AND ${inP(Prisma.sql`c.created_at`)}`),
      this.prisma.$queryRaw<
        {
          kind: 'charge' | 'receipt';
          title: string;
          number: number | null;
          amount: unknown;
          reason: string | null;
          user: string | null;
          at: Date;
        }[]
      >(Prisma.sql`
        SELECT * FROM (
          SELECT 'charge' AS kind, c.description AS title, NULL::int AS number, c.total AS amount,
                 c.void_reason AS reason, u.full_name AS user, c.voided_at AS at
          FROM charges c LEFT JOIN users u ON u.id = c.voided_by_id
          WHERE c.clinic_id = ${clinicId} AND c.status = 'VOID' AND ${inP(Prisma.sql`c.voided_at`)}
          UNION ALL
          SELECT 'receipt', '', r.number, r.total, r.void_reason, u.full_name, r.voided_at
          FROM receipts r LEFT JOIN users u ON u.id = r.voided_by_id
          WHERE r.clinic_id = ${clinicId} AND r.status = 'VOID' AND ${inP(Prisma.sql`r.voided_at`)}
        ) t ORDER BY at DESC LIMIT 10`),
      this.prisma.$queryRaw<
        {
          id: number;
          at: Date;
          difference: unknown;
          note: string | null;
          user: string | null;
          key: string;
        }[]
      >(Prisma.sql`
        SELECT s.id, s.closed_at AS at, s.difference, s.closing_note AS note, u.full_name AS user,
               ${key(Prisma.sql`s.closed_at`)} AS key
        FROM cash_sessions s LEFT JOIN users u ON u.id = s.closed_by_id
        WHERE s.clinic_id = ${clinicId} AND s.status = 'CLOSED' AND ${inP(Prisma.sql`s.closed_at`)}
        ORDER BY s.closed_at`),
      this.prisma.$queryRaw<
        { type: 'WASTE' | 'COUNT_ADJUST'; amount: unknown; count: bigint }[]
      >(
        Prisma.sql`
        SELECT m.type::text AS type, -SUM(m.quantity * b.unit_cost) AS amount, COUNT(*) AS count
        FROM stock_movements m LEFT JOIN product_batches b ON b.id = m.batch_id
        WHERE m.clinic_id = ${clinicId} AND m.quantity < 0 AND m.type IN ('WASTE', 'COUNT_ADJUST')
          AND ${inP(Prisma.sql`m.created_at`)}
        GROUP BY 1`,
      ),
      this.prisma.$queryRaw<
        {
          product: string;
          lot: string | null;
          quantity: unknown;
          unit: string;
          value: unknown;
          has_cost: boolean;
          reason: string | null;
          type: 'WASTE' | 'COUNT_ADJUST';
          at: Date;
          user: string | null;
        }[]
      >(Prisma.sql`
        SELECT p.name AS product, b.lot_number AS lot, -m.quantity AS quantity, p.base_unit::text AS unit,
               -m.quantity * b.unit_cost AS value, b.unit_cost IS NOT NULL AS has_cost, m.reason,
               m.type::text AS type, m.created_at AS at, u.full_name AS user
        FROM stock_movements m
        JOIN products p ON p.id = m.product_id
        LEFT JOIN product_batches b ON b.id = m.batch_id
        LEFT JOIN users u ON u.id = m.user_id
        WHERE m.clinic_id = ${clinicId} AND m.quantity < 0 AND m.type IN ('WASTE', 'COUNT_ADJUST')
          AND ${inP(Prisma.sql`m.created_at`)}
        ORDER BY m.created_at DESC LIMIT 10`),
      this.prisma.$queryRaw<
        { user_id: number; receipts: bigint; collected: unknown }[]
      >(Prisma.sql`
        SELECT r.created_by_id AS user_id, COUNT(*) AS receipts, SUM(r.total) AS collected
        FROM receipts r
        WHERE r.clinic_id = ${clinicId} AND r.status = 'ACTIVE' AND ${inP(Prisma.sql`r.created_at`)}
        GROUP BY 1`),
      this.prisma.$queryRaw<{ user_id: number; voids: bigint }[]>(Prisma.sql`
        SELECT user_id, COUNT(*) AS voids FROM (
          SELECT c.voided_by_id AS user_id FROM charges c
          WHERE c.clinic_id = ${clinicId} AND c.status = 'VOID' AND ${inP(Prisma.sql`c.voided_at`)}
          UNION ALL
          SELECT r.voided_by_id FROM receipts r
          WHERE r.clinic_id = ${clinicId} AND r.status = 'VOID' AND ${inP(Prisma.sql`r.voided_at`)}
        ) t WHERE user_id IS NOT NULL GROUP BY 1`),
      this.prisma.$queryRaw<
        { user_id: number; difference: unknown }[]
      >(Prisma.sql`
        SELECT s.closed_by_id AS user_id, SUM(s.difference) AS difference
        FROM cash_sessions s
        WHERE s.clinic_id = ${clinicId} AND s.status = 'CLOSED' AND s.closed_by_id IS NOT NULL
          AND ${inP(Prisma.sql`s.closed_at`)}
        GROUP BY 1`),
      this.prisma.$queryRaw<
        {
          action: string;
          data: Prisma.JsonValue;
          user: string | null;
          at: Date;
          service: string | null;
          product: string | null;
          client: string | null;
          total: bigint;
        }[]
      >(Prisma.sql`
        SELECT a.action, a.data, u.full_name AS user, a.created_at AS at,
               cs.name AS service, pr.name AS product, cl.name AS client,
               COUNT(*) OVER () AS total
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN care_services cs ON a.entity = 'care_service' AND cs.id::text = a.entity_id
        LEFT JOIN products pr ON a.entity = 'product' AND pr.id::text = a.entity_id
        LEFT JOIN charges ch ON a.entity = 'charge' AND ch.id::text = a.entity_id
        LEFT JOIN clients cl ON cl.id = ch.client_id
        WHERE a.clinic_id = ${clinicId}
          AND a.action IN ('service.price_change', 'product.price_change', 'charge.transport_price')
          AND (u.id IS NULL OR NOT u.is_support)
          AND ${inP(Prisma.sql`a.created_at`)}
        ORDER BY a.created_at DESC LIMIT 10`),
    ]);

    // Personas: todas las que cobraron, descontaron, anularon o cerraron caja
    const ids = new Set<number>([
      ...byUser.map((r) => r.user_id),
      ...receiptsByUser.map((r) => r.user_id),
      ...voidsByUser.map((r) => r.user_id),
      ...cashByUser.map((r) => r.user_id),
    ]);
    const users = await this.prisma.user.findMany({
      // La cuenta de soporte no aparece en los reportes de la clínica
      where: { clinicId, id: { in: [...ids] }, isSupport: false },
      select: { id: true, fullName: true, role: true },
    });
    const userOf = (id: number) => users.find((u) => u.id === id) ?? null;

    const discMap = new Map(
      discBuckets.map((r) => [r.key, round2(num(r.amount))]),
    );
    const voidMap = new Map(
      voidBuckets.map((r) => [r.key, round2(num(r.amount))]),
    );
    const buckets = bucketsOf(p, grain);

    const people = users
      .map((u) => {
        const d = byUser.find((r) => r.user_id === u.id);
        const rc = receiptsByUser.find((r) => r.user_id === u.id);
        const cash = cashByUser.find((r) => r.user_id === u.id);
        return {
          user: u,
          receipts: Number(rc?.receipts ?? 0),
          collected: round2(num(rc?.collected)),
          discounts: round2(num(d?.amount)),
          discountPercent: d ? pct(num(d.amount), num(d.gross)) : null,
          voids: Number(
            voidsByUser.find((r) => r.user_id === u.id)?.voids ?? 0,
          ),
          cashDifference: cash ? round2(num(cash.difference)) : null,
        };
      })
      .filter(
        (x) =>
          x.receipts || x.discounts || x.voids || x.cashDifference !== null,
      )
      .sort((a, b) => b.collected - a.collected || b.discounts - a.discounts);

    const closingBuckets = new Map<
      string,
      { surplus: number; shortage: number }
    >();
    for (const c of closings) {
      const d = num(c.difference);
      const row = closingBuckets.get(c.key) ?? { surplus: 0, shortage: 0 };
      if (d > 0) row.surplus = round2(row.surplus + d);
      if (d < 0) row.shortage = round2(row.shortage + d);
      closingBuckets.set(c.key, row);
    }

    return {
      from: p.from,
      to: p.to,
      previous: { from: previous.from, to: previous.to },
      kpis,
      previousKpis,
      grain,
      series: buckets.map((b) => ({
        ...b,
        discounts: discMap.get(b.key) ?? 0,
        voided: voidMap.get(b.key) ?? 0,
      })),
      maxDiscountPercent: num(clinic.maxDiscountPercent),
      maxApplied:
        maxApplied[0]?.max == null
          ? null
          : Math.round(num(maxApplied[0].max) * 1000) / 10,
      discountsByUser: byUser
        .filter((r) => num(r.amount) > 0)
        .map((r) => ({
          user: userOf(r.user_id),
          amount: round2(num(r.amount)),
          count: Number(r.count),
          percent: pct(num(r.amount), num(r.gross)),
        }))
        .sort((a, b) => b.amount - a.amount),
      discountsByReason: byReason.map((r) => ({
        reason: r.reason,
        amount: round2(num(r.amount)),
        count: Number(r.count),
      })),
      discountClients: clients.map((r) => ({
        client: { id: r.id, name: r.name },
        amount: round2(num(r.amount)),
        count: Number(r.count),
      })),
      voids: {
        count: kpis.voidCount,
        items: voidItems.map((r) => ({
          kind: r.kind,
          title:
            r.kind === 'receipt'
              ? `Cobro ${saleNoteCode(r.number ?? 0)}`
              : r.title,
          amount: round2(num(r.amount)),
          reason: r.reason,
          user: r.user,
          at: r.at,
        })),
      },
      closings: {
        points:
          p.days <= 62
            ? closings.map((c) => ({
                id: c.id,
                at: c.at,
                difference: round2(num(c.difference)),
              }))
            : [],
        buckets:
          p.days > 62
            ? buckets.map((b) => ({
                key: b.key,
                ...(closingBuckets.get(b.key) ?? { surplus: 0, shortage: 0 }),
              }))
            : [],
        items: closings
          .filter((c) => num(c.difference) !== 0)
          .reverse()
          .slice(0, 20)
          .map((c) => ({
            id: c.id,
            at: c.at,
            difference: round2(num(c.difference)),
            note: c.note,
            user: c.user,
          })),
      },
      waste: {
        byType: (['WASTE', 'COUNT_ADJUST'] as const).map((type) => {
          const r = wasteTypes.find((x) => x.type === type);
          return {
            type,
            amount: round2(num(r?.amount)),
            count: Number(r?.count ?? 0),
          };
        }),
        items: wasteItems.map((r) => ({
          product: r.product,
          lot: r.lot,
          quantity: num(r.quantity),
          unit: r.unit,
          value: r.has_cost ? round2(num(r.value)) : null,
          reason: r.reason,
          type: r.type,
          at: r.at,
          user: r.user,
        })),
      },
      people,
      priceChanges: {
        count: Number(priceRows[0]?.total ?? 0),
        items: priceRows.map((r) => {
          const data = (r.data ?? {}) as Record<string, unknown>;
          const name =
            r.action === 'charge.transport_price'
              ? `Movilidad${r.client ? ` · ${r.client}` : ''}`
              : r.action === 'product.price_change'
                ? `${r.product ?? 'Producto'}${data.presentation ? ` · ${String(data.presentation)}` : ''}`
                : (r.service ??
                  (data.name as string | undefined) ??
                  'Servicio');
          return {
            action: r.action,
            name,
            before: data.before == null ? null : num(data.before),
            after: data.after == null ? null : num(data.after),
            user: r.user,
            at: r.at,
          };
        }),
      },
    };
  }

  private async kpis(clinicId: number, p: Period): Promise<ControlKpis> {
    const inP = (col: Prisma.Sql) =>
      Prisma.sql`${col} >= ${p.start} AND ${col} < ${p.end}`;
    const [disc, voids, cash, waste] = await Promise.all([
      this.prisma.$queryRaw<
        { amount: unknown; count: bigint; gross: unknown }[]
      >(Prisma.sql`
        SELECT SUM(c.discount) AS amount, COUNT(*) FILTER (WHERE c.discount > 0) AS count,
               SUM(c.total + c.discount) AS gross
        FROM charges c
        WHERE c.clinic_id = ${clinicId} AND c.status <> 'VOID' AND ${inP(Prisma.sql`c.created_at`)}`),
      this.prisma.$queryRaw<{ amount: unknown; count: bigint }[]>(Prisma.sql`
        SELECT SUM(amount) AS amount, COUNT(*) AS count FROM (
          SELECT c.total AS amount FROM charges c
          WHERE c.clinic_id = ${clinicId} AND c.status = 'VOID' AND ${inP(Prisma.sql`c.voided_at`)}
          UNION ALL
          SELECT r.total FROM receipts r
          WHERE r.clinic_id = ${clinicId} AND r.status = 'VOID' AND ${inP(Prisma.sql`r.voided_at`)}
        ) t`),
      this.prisma.$queryRaw<
        { net: unknown; sessions: bigint; with_diff: bigint }[]
      >(Prisma.sql`
        SELECT SUM(s.difference) AS net, COUNT(*) AS sessions,
               COUNT(*) FILTER (WHERE s.difference <> 0) AS with_diff
        FROM cash_sessions s
        WHERE s.clinic_id = ${clinicId} AND s.status = 'CLOSED' AND ${inP(Prisma.sql`s.closed_at`)}`),
      this.prisma.$queryRaw<{ amount: unknown }[]>(Prisma.sql`
        SELECT -SUM(m.quantity * b.unit_cost) AS amount
        FROM stock_movements m JOIN product_batches b ON b.id = m.batch_id
        WHERE m.clinic_id = ${clinicId} AND m.quantity < 0 AND m.type IN ('WASTE', 'COUNT_ADJUST')
          AND ${inP(Prisma.sql`m.created_at`)}`),
    ]);
    const d = disc[0];
    return {
      discounts: round2(num(d?.amount)),
      discountCount: Number(d?.count ?? 0),
      discountPercent: d ? pct(num(d.amount), num(d.gross)) : null,
      voided: round2(num(voids[0]?.amount)),
      voidCount: Number(voids[0]?.count ?? 0),
      cashNet: round2(num(cash[0]?.net)),
      cashSessions: Number(cash[0]?.sessions ?? 0),
      cashWithDifference: Number(cash[0]?.with_diff ?? 0),
      waste: round2(num(waste[0]?.amount)),
    };
  }
}
