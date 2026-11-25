import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { startOfDayIn } from '../common/time/clinic-day.js';

/**
 * Hasta 2 años por reporte (731 días con el bisiesto): alcanza para comparar este año con el
 * anterior y los gráficos van por mes (24 barras como máximo).
 */
export const MAX_REPORT_DAYS = 731;

/** Cómo se agrupan los gráficos: por hora (un día), por día (hasta 31), por semana (hasta 92) o por mes */
export type Grain = 'hour' | 'day' | 'week' | 'month';

export interface Bucket {
  /** Clave que devuelve la consulta: hora "08", día "2026-11-24", lunes de la semana o "2026-11" */
  key: string;
  /** Primer día del grupo dentro del período (en la hora, el día del período) */
  from: string;
  /** Último día del grupo dentro del período */
  to: string;
}

export interface Period {
  from: string;
  to: string;
  /** Instante en que empieza `from` y en que termina `to` en la zona de la clínica */
  start: Date;
  end: Date;
  days: number;
}

const DAY_MS = 86_400_000;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Valida el rango y lo convierte a instantes en la zona horaria de la clínica. */
export function periodOf(timezone: string, from: string, to: string): Period {
  if (
    Number.isNaN(Date.parse(`${from}T00:00:00Z`)) ||
    Number.isNaN(Date.parse(`${to}T00:00:00Z`))
  )
    throw new BadRequestException('Fecha no válida');
  if (from > to)
    throw new BadRequestException('La fecha inicial es posterior a la final');
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS +
    1;
  if (days > MAX_REPORT_DAYS)
    throw new BadRequestException('El período puede ser de hasta 2 años');
  return {
    from,
    to,
    start: startOfDayIn(timezone, from),
    end: startOfDayIn(timezone, addDays(to, 1)),
    days,
  };
}

const lastDayOfMonth = (ym: string): string =>
  addDays(addMonths(`${ym}-01`, 1), -1);

/** Suma meses a AAAA-MM-DD sin pasarse del último día del mes de llegada */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ym = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  const last = Number(
    new Date(Date.UTC(Math.floor(total / 12), (total % 12) + 1, 0))
      .toISOString()
      .slice(8, 10),
  );
  return `${ym}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Contra qué se compara:
 * - Si empieza el 1 de enero y termina el 31 de diciembre o hoy (Este año, Año pasado): las
 *   mismas fechas del año anterior.
 * - Si empieza el 1 del mes y termina el último día del mes o hoy (Este mes, Mes pasado): los
 *   mismos días de los meses anteriores.
 * - Si no, el período de la misma duración justo antes.
 * Si el período incluye este momento, el anterior se corta en la misma hora: “Hoy” a las 10 se
 * compara con el día anterior hasta las 10 (si no, temprano todo sale “Baja 100 %”).
 */
export function previousOf(
  timezone: string,
  period: Period,
  today?: string,
  now: Date = new Date(),
): Period {
  const endsWell = (lastOfUnit: boolean) => lastOfUnit || period.to === today;
  const isMonthEnd = period.to === lastDayOfMonth(period.to.slice(0, 7));
  let from: string;
  let to: string;
  if (
    period.from.slice(5) === '01-01' &&
    endsWell(period.to.slice(5) === '12-31')
  ) {
    const years =
      Number(period.to.slice(0, 4)) - Number(period.from.slice(0, 4)) + 1;
    from = addMonths(period.from, -12 * years);
    to = isMonthEnd
      ? lastDayOfMonth(addMonths(period.to, -12 * years).slice(0, 7))
      : addMonths(period.to, -12 * years);
  } else if (period.from.slice(8) === '01' && endsWell(isMonthEnd)) {
    const months =
      (Number(period.to.slice(0, 4)) - Number(period.from.slice(0, 4))) * 12 +
      Number(period.to.slice(5, 7)) -
      Number(period.from.slice(5, 7)) +
      1;
    from = addMonths(period.from, -months);
    to = isMonthEnd
      ? lastDayOfMonth(addMonths(period.to, -months).slice(0, 7))
      : addMonths(period.to, -months);
  } else {
    to = addDays(period.from, -1);
    from = addDays(period.from, -period.days);
  }
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS +
    1;
  let end = startOfDayIn(timezone, addDays(to, 1));
  if (period.start <= now && now < period.end)
    end = new Date(end.getTime() - (period.end.getTime() - now.getTime()));
  return { from, to, start: startOfDayIn(timezone, from), end, days };
}

/** Por hora si es un día; por día hasta 31; por semana hasta 92; si no, por mes */
export function grainOf(period: Period): Grain {
  if (period.days === 1) return 'hour';
  if (period.days <= 31) return 'day';
  if (period.days <= 92) return 'week';
  return 'month';
}

/** Lunes de la semana del día */
function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

/** Los grupos del período en orden, aunque no tengan ventas */
export function bucketsOf(period: Period, grain: Grain): Bucket[] {
  if (grain === 'hour')
    return Array.from({ length: 24 }, (_, h) => ({
      key: String(h).padStart(2, '0'),
      from: period.from,
      to: period.to,
    }));
  if (grain === 'day')
    return daysOf(period).map((d) => ({ key: d, from: d, to: d }));
  const out: Bucket[] = [];
  if (grain === 'week') {
    for (let m = mondayOf(period.from); m <= period.to; m = addDays(m, 7)) {
      const end = addDays(m, 6);
      out.push({
        key: m,
        from: m < period.from ? period.from : m,
        to: end > period.to ? period.to : end,
      });
    }
    return out;
  }
  for (
    let ym = period.from.slice(0, 7);
    ym <= period.to.slice(0, 7);
    ym = addMonths(`${ym}-01`, 1).slice(0, 7)
  ) {
    const first = `${ym}-01`;
    const last = lastDayOfMonth(ym);
    out.push({
      key: ym,
      from: first < period.from ? period.from : first,
      to: last > period.to ? period.to : last,
    });
  }
  return out;
}

/** Expresión SQL que da la clave del grupo de una columna de fecha y hora (en la zona de la clínica) */
export function bucketSql(
  timezone: string,
  column: Prisma.Sql,
  grain: Grain,
): Prisma.Sql {
  const local = Prisma.sql`(${column} AT TIME ZONE ${timezone})`;
  switch (grain) {
    case 'hour':
      return Prisma.sql`to_char(${local}, 'HH24')`;
    case 'day':
      return Prisma.sql`to_char(${local}::date, 'YYYY-MM-DD')`;
    case 'week':
      return Prisma.sql`to_char(date_trunc('week', ${local})::date, 'YYYY-MM-DD')`;
    default:
      return Prisma.sql`to_char(${local}, 'YYYY-MM')`;
  }
}

/** Todos los días del período, en orden */
export function daysOf(period: Period): string[] {
  return Array.from({ length: period.days }, (_, i) => addDays(period.from, i));
}

/**
 * Mes anterior del 1 al mismo día que hoy (o hasta su último día si es más corto), y su último
 * día: el 31 de marzo se compara con el 1 al 28 de febrero.
 */
export function previousMonthRange(today: string): {
  from: string;
  to: string;
  last: string;
} {
  const last = addDays(`${today.slice(0, 7)}-01`, -1);
  const from = `${last.slice(0, 7)}-01`;
  const sameDay = `${last.slice(0, 7)}-${today.slice(8, 10)}`;
  return { from, to: sameDay < last ? sameDay : last, last };
}

/** AAAA-MM-DD → DD/MM/AAAA */
export function dmy(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
