/** Fecha (AAAA-MM-DD) en la zona horaria de la clínica: la "cola de hoy" cambia a medianoche de Lima, no de UTC. */
export function clinicDay(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Convierte AAAA-MM-DD al valor que Prisma guarda en una columna DATE. */
export function toDbDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Convierte una columna DATE a AAAA-MM-DD. */
export function fromDbDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Instante en que empieza un día (AAAA-MM-DD) en la zona horaria de la clínica. */
export function startOfDayIn(timeZone: string, day: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00.000Z`);
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(utcMidnight)
    .find((part) => part.type === 'timeZoneName')?.value; // "GMT-05:00"
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset ?? '');
  if (!match) return utcMidnight;
  const minutes =
    (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
  return new Date(utcMidnight.getTime() - minutes * 60_000);
}
