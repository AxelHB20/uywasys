/** Calendario iCalendar (RFC 5545) que el dueño agrega a su celular: Google, iPhone u Outlook. */

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** Día completo (YYYY-MM-DD) o un momento con duración */
  day?: string;
  start?: Date;
  durationMin?: number;
  /** Alarma: minutos antes del inicio (en un día completo, antes de las 00:00 de ese día) */
  alarmMinutes?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const utc = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = (day: string) => day.replaceAll('-', '');
const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Escapa texto según la norma: barra, punto y coma, coma y saltos de línea */
export const icsText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** Líneas de más de 75 octetos se parten con CRLF + espacio */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > 75) {
      out.push(current);
      current = ' ' + ch;
    } else current += ch;
  }
  out.push(current);
  return out.join('\r\n');
}

export function buildIcs(
  name: string,
  events: IcsEvent[],
  now = new Date(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Uywa//Recordatorios//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    'X-WR-TIMEZONE:America/Lima',
    // Cada cuánto vuelve a consultar el calendario (los que lo respetan)
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${utc(now)}`);
    if (e.day) {
      lines.push(
        `DTSTART;VALUE=DATE:${dateOnly(e.day)}`,
        `DTEND;VALUE=DATE:${dateOnly(nextDay(e.day))}`,
        'TRANSP:TRANSPARENT',
      );
    } else if (e.start) {
      const end = new Date(e.start.getTime() + (e.durationMin ?? 30) * 60_000);
      lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(end)}`);
    }
    lines.push(`SUMMARY:${icsText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    if (e.alarmMinutes !== undefined)
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsText(e.summary)}`,
        `TRIGGER:-PT${e.alarmMinutes}M`,
        'END:VALARM',
      );
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
