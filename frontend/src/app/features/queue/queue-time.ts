const TIME_ZONE = 'America/Lima';

/** "19:10" en hora de Lima */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

export function minutesBetween(fromIso: string, to: Date | string): number {
  const end = typeof to === 'string' ? new Date(to) : to;
  return Math.max(0, Math.round((end.getTime() - new Date(fromIso).getTime()) / 60_000));
}

/** 5 → "5 min", 75 → "1 h 15 min" */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}
