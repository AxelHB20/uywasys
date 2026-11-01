/**
 * Horario de atención: un registro por día (1 = lunes … 7 = domingo).
 * `open` y `close` en HH:MM; ambos null = ese día no se atiende.
 * Sale en el ticket y lo usará la agenda de citas (Fase 5).
 */
export interface DayHours {
  day: number;
  open: string | null;
  close: string | null;
}

export type OpeningHours = DayHours[];

/** Lunes a sábado de 9:00 a 19:00; domingo cerrado. */
export const DEFAULT_OPENING_HOURS: OpeningHours = [1, 2, 3, 4, 5, 6, 7].map(
  (day) =>
    day === 7
      ? { day, open: null, close: null }
      : { day, open: '09:00', close: '19:00' },
);

/** Lo guardado en la base, o el horario por defecto si nunca se configuró. */
export function readOpeningHours(value: unknown): OpeningHours {
  if (!Array.isArray(value) || value.length !== 7) return DEFAULT_OPENING_HOURS;
  return value as OpeningHours;
}
