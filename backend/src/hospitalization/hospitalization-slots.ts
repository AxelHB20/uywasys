/** Hoja de tratamiento: las horas en que toca cada indicación y en qué quedó cada una. */

/** Media hora de tolerancia: antes de eso la dosis "toca ahora", después está atrasada */
export const GRACE_MS = 30 * 60_000;
const HOUR = 3_600_000;
/** Tope de horas generadas por indicación (una cada hora por 3 días) */
const MAX_SLOTS = 72;

export type SlotState = 'GIVEN' | 'SKIPPED' | 'OVERDUE' | 'DUE' | 'PENDING';

export interface OrderTiming {
  everyHours: number | null;
  startsAt: Date;
  endsAt: Date | null;
  stoppedAt: Date | null;
}

export interface DoseMark {
  scheduledAt: Date | null;
  skipped: boolean;
  at: Date;
}

export interface Slot {
  at: Date;
  state: SlotState;
  /** Cuándo se registró (dadas u omitidas) */
  doneAt: Date | null;
}

/** Hasta cuándo rige la indicación */
export function orderEnd(order: OrderTiming): Date | null {
  const ends = [order.endsAt, order.stoppedAt].filter(
    (d): d is Date => d !== null,
  );
  return ends.length
    ? new Date(Math.min(...ends.map((d) => d.getTime())))
    : null;
}

/**
 * Horas programadas dentro de [from, to]. Una indicación sin frecuencia es de una sola vez:
 * su única hora es el inicio.
 */
export function scheduleOf(order: OrderTiming, from: Date, to: Date): Date[] {
  const end = orderEnd(order);
  const limit = Math.min(to.getTime(), end ? end.getTime() - 1 : Infinity);
  const start = order.startsAt.getTime();
  if (!order.everyHours) {
    return start >= from.getTime() && start <= limit ? [order.startsAt] : [];
  }
  const step = order.everyHours * HOUR;
  // Primer múltiplo desde el inicio que cae dentro de la ventana
  const skip = Math.max(0, Math.ceil((from.getTime() - start) / step));
  const out: Date[] = [];
  for (
    let t = start + skip * step;
    t <= limit && out.length < MAX_SLOTS;
    t += step
  )
    out.push(new Date(t));
  return out;
}

const same = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) < 60_000;

export function slotsOf(
  order: OrderTiming,
  marks: DoseMark[],
  from: Date,
  to: Date,
  now: Date,
): Slot[] {
  return scheduleOf(order, from, to).map((at) => {
    const mark = marks.find((m) => m.scheduledAt && same(m.scheduledAt, at));
    if (mark)
      return { at, state: mark.skipped ? 'SKIPPED' : 'GIVEN', doneAt: mark.at };
    const diff = now.getTime() - at.getTime();
    const state: SlotState =
      diff > GRACE_MS ? 'OVERDUE' : diff >= -GRACE_MS ? 'DUE' : 'PENDING';
    return { at, state, doneAt: null };
  });
}

/** Días de internamiento a cobrar: cada 24 h o fracción, mínimo uno */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * HOUR)));
}
