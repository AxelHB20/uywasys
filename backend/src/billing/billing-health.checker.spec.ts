import { msUntilNextCheck } from './billing-health.checker.js';

const at = (iso: string) => new Date(iso);
const hours = (ms: number) => ms / 3_600_000;

describe('revisión automática de la facturación', () => {
  it('se programa a las 00, 06, 12 y 18 h de Lima', () => {
    // 05:30 en Lima (10:30 UTC) → 06:00, en media hora
    expect(hours(msUntilNextCheck(at('2026-11-18T10:30:00Z')))).toBe(0.5);
    // 12:00 en punto → la siguiente es a las 18:00
    expect(hours(msUntilNextCheck(at('2026-11-18T17:00:00Z')))).toBe(6);
    // 23:15 en Lima → medianoche
    expect(hours(msUntilNextCheck(at('2026-11-19T04:15:00Z')))).toBe(0.75);
  });
});
