/** Horario de un día: 1 = lunes … 7 = domingo. Sin horas = no se atiende. */
export interface DayHours {
  day: number;
  open: string | null;
  close: string | null;
}

export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * El horario en una línea para el ticket: "Lun a Vie 08:30–20:00 · Sáb 09:00–13:00 · Dom cerrado".
 * Agrupa los días seguidos con el mismo horario.
 */
export function scheduleSummary(hours: DayHours[]): string {
  const days = [...hours].sort((a, b) => a.day - b.day);
  if (!days.some((d) => d.open)) return '';
  const groups: { from: number; to: number; label: string }[] = [];
  for (const d of days) {
    const label = d.open && d.close ? `${d.open}–${d.close}` : 'cerrado';
    const last = groups.at(-1);
    if (last && last.label === label && last.to === d.day - 1) last.to = d.day;
    else groups.push({ from: d.day, to: d.day, label });
  }
  return groups
    .map((g) => {
      const from = DAY_SHORT[g.from - 1];
      const to = DAY_SHORT[g.to - 1];
      const range =
        g.from === g.to ? from : g.to === g.from + 1 ? `${from} y ${to}` : `${from} a ${to}`;
      return `${range} ${g.label}`;
    })
    .join(' · ');
}
