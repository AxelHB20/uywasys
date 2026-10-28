import { clinicDay, fromDbDate, startOfDayIn, toDbDate } from './clinic-day.js';

describe('clinicDay', () => {
  it('usa la hora de Lima: a las 11 p. m. del 27 sigue siendo 27 aunque en UTC ya sea 28', () => {
    const at = new Date('2026-10-28T04:00:00.000Z');
    expect(clinicDay('America/Lima', at)).toBe('2026-10-27');
  });

  it('ida y vuelta con columnas DATE', () => {
    expect(fromDbDate(toDbDate('2026-10-27'))).toBe('2026-10-27');
    expect(fromDbDate(null)).toBeNull();
  });
});

describe('startOfDayIn', () => {
  it('el día en Lima empieza a las 05:00 UTC', () => {
    expect(startOfDayIn('America/Lima', '2026-10-01').toISOString()).toBe(
      '2026-10-01T05:00:00.000Z',
    );
  });
});
