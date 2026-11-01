/**
 * Un solo formato de fecha y hora en todo el sistema, siempre en hora de Lima:
 *   date      28/10/2026
 *   datetime  28/10/2026 · 13:39
 *   time      13:39
 *   month     octubre 2026
 *   calendar  28/10/2026 para fechas sin hora (vencimientos, nacimientos): no se corren de día
 */
export type DateStyle = 'date' | 'datetime' | 'time' | 'month' | 'calendar';

const LIMA = 'America/Lima';
const parts = new Intl.DateTimeFormat('es-PE', {
  timeZone: LIMA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const monthYear = new Intl.DateTimeFormat('es-PE', {
  timeZone: LIMA,
  month: 'long',
  year: 'numeric',
});

export function formatDate(
  value: string | Date | null | undefined,
  style: DateStyle = 'date',
): string {
  if (value === null || value === undefined || value === '') return '';
  if (style === 'calendar') {
    const iso = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (style === 'month') return monthYear.format(date).replace(' de ', ' ');
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  const day = `${p['day']}/${p['month']}/${p['year']}`;
  const time = `${p['hour']}:${p['minute']}`;
  if (style === 'time') return time;
  if (style === 'datetime') return `${day} · ${time}`;
  return day;
}

const isoDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: LIMA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Hoy en Lima como AAAA-MM-DD (para fechas sin hora: vacunas, vencimientos) */
export function limaToday(at: Date = new Date()): string {
  return isoDay.format(at);
}
