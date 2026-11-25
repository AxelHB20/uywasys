import { describe, expect, it } from 'vitest';
import { daysBetween, scheduleOf, slotsOf } from './hospitalization-slots.js';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));

describe('hoja de tratamiento', () => {
  const every8 = {
    everyHours: 8,
    startsAt: at(2),
    endsAt: null,
    stoppedAt: null,
  };

  it('genera las horas dentro de la ventana, alineadas al inicio', () => {
    expect(
      scheduleOf(every8, at(5), at(23)).map((d) => d.getUTCHours()),
    ).toEqual([10, 18]);
  });

  it('una indicación suspendida no genera horas después', () => {
    const stopped = { ...every8, stoppedAt: at(18) };
    expect(
      scheduleOf(stopped, at(0), at(23)).map((d) => d.getUTCHours()),
    ).toEqual([2, 10]);
  });

  it('sin frecuencia es una sola vez', () => {
    const once = { ...every8, everyHours: null };
    expect(scheduleOf(once, at(0), at(23))).toHaveLength(1);
    expect(scheduleOf(once, at(3), at(23))).toHaveLength(0);
  });

  it('marca dadas, omitidas, atrasadas, por dar y pendientes', () => {
    const order = { ...every8, everyHours: 2, startsAt: at(8) };
    const marks = [
      { scheduledAt: at(8), skipped: false, at: at(8, 5) },
      { scheduledAt: at(10), skipped: true, at: at(10, 1) },
    ];
    const states = slotsOf(order, marks, at(8), at(16), at(14, 10)).map(
      (s) => s.state,
    );
    expect(states).toEqual(['GIVEN', 'SKIPPED', 'OVERDUE', 'DUE', 'PENDING']);
  });

  it('cobra cada 24 h o fracción, mínimo un día', () => {
    expect(daysBetween(at(2), at(3))).toBe(1);
    expect(daysBetween(at(2), new Date(at(2).getTime() + 25 * 3_600_000))).toBe(
      2,
    );
  });
});
