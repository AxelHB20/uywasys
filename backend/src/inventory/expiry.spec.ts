import { addDays, expiryStatus } from './expiry.js';

describe('semáforo de vencimientos', () => {
  const today = '2026-10-27';

  it('respeta los límites de 30, 31, 60 y 61 días', () => {
    expect(expiryStatus(addDays(today, 30), today)).toEqual({
      days: 30,
      level: 'RED',
    });
    expect(expiryStatus(addDays(today, 31), today)).toEqual({
      days: 31,
      level: 'YELLOW',
    });
    expect(expiryStatus(addDays(today, 60), today)).toEqual({
      days: 60,
      level: 'YELLOW',
    });
    expect(expiryStatus(addDays(today, 61), today)).toEqual({
      days: 61,
      level: 'GREEN',
    });
  });

  it('hoy todavía no está vencido; ayer sí', () => {
    expect(expiryStatus(today, today)?.level).toBe('RED');
    expect(expiryStatus(addDays(today, -1), today)).toEqual({
      days: -1,
      level: 'EXPIRED',
    });
  });

  it('sin fecha de vencimiento no hay semáforo', () => {
    expect(expiryStatus(null, today)).toBeNull();
  });

  it('suma días cruzando meses y años', () => {
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });
});
