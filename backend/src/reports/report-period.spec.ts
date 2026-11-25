import { BadRequestException } from '@nestjs/common';
import {
  addMonths,
  bucketsOf,
  daysOf,
  grainOf,
  periodOf,
  previousMonthRange,
  previousOf,
} from './report-period.js';

const TZ = 'America/Lima';
const range = (from: string, to: string, today?: string, now?: Date) => {
  const prev = previousOf(TZ, periodOf(TZ, from, to), today, now);
  return [prev.from, prev.to];
};

describe('report-period', () => {
  it('convierte el período a instantes de Lima e incluye ambos días', () => {
    const p = periodOf('America/Lima', '2026-10-30', '2026-11-01');
    expect(p.days).toBe(3);
    expect(p.start.toISOString()).toBe('2026-10-30T05:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(daysOf(p)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('el período anterior tiene la misma duración y termina justo antes', () => {
    const p = periodOf('America/Lima', '2026-11-01', '2026-11-07');
    const prev = previousOf('America/Lima', p);
    expect([prev.from, prev.to]).toEqual(['2026-10-25', '2026-10-31']);
    expect(prev.end).toEqual(p.start);
  });

  it('acepta hasta 2 años y rechaza rangos al revés o más largos', () => {
    expect(() => periodOf('America/Lima', '2026-11-02', '2026-11-01')).toThrow(
      BadRequestException,
    );
    expect(periodOf(TZ, '2024-11-24', '2026-11-24').days).toBe(731);
    expect(() => periodOf(TZ, '2024-11-23', '2026-11-24')).toThrow(
      'hasta 2 años',
    );
  });

  it('meses y años completos (o hasta hoy) se comparan con los mismos de antes', () => {
    // Mes pasado completo: el mes anterior completo, aunque tenga otro largo
    expect(range('2026-10-01', '2026-10-31')).toEqual([
      '2026-09-01',
      '2026-09-30',
    ]);
    expect(range('2026-03-01', '2026-03-31')).toEqual([
      '2026-02-01',
      '2026-02-28',
    ]);
    // Este mes hasta hoy: los mismos días del mes anterior
    expect(range('2026-11-01', '2026-11-24', '2026-11-24')).toEqual([
      '2026-10-01',
      '2026-10-24',
    ]);
    // Del 1 al 7 si hoy no es el 7: los 7 días de antes
    expect(range('2026-11-01', '2026-11-07', '2026-11-24')).toEqual([
      '2026-10-25',
      '2026-10-31',
    ]);
    // Año pasado y Este año: las mismas fechas del año anterior
    expect(range('2025-01-01', '2025-12-31')).toEqual([
      '2024-01-01',
      '2024-12-31',
    ]);
    expect(range('2026-01-01', '2026-11-24', '2026-11-24')).toEqual([
      '2025-01-01',
      '2025-11-24',
    ]);
    // Dos años completos: los 2 anteriores
    expect(range('2025-01-01', '2026-12-31')).toEqual([
      '2023-01-01',
      '2024-12-31',
    ]);
    // 12 meses hasta hoy: los 365 días de antes
    expect(range('2025-11-25', '2026-11-24', '2026-11-24')).toEqual([
      '2024-11-25',
      '2025-11-24',
    ]);
  });

  it('si el período incluye este momento, el anterior se corta a la misma hora', () => {
    const now = new Date('2026-11-24T15:00:00Z'); // 10:00 en Lima
    const p = periodOf(TZ, '2026-11-24', '2026-11-24');
    const prev = previousOf(TZ, p, '2026-11-24', now);
    expect(prev.start.toISOString()).toBe('2026-11-23T05:00:00.000Z');
    expect(prev.end.toISOString()).toBe('2026-11-23T15:00:00.000Z');
    // Un período que ya pasó no se corta
    const past = previousOf(
      TZ,
      periodOf(TZ, '2026-11-20', '2026-11-20'),
      '2026-11-24',
      now,
    );
    expect(past.end.toISOString()).toBe('2026-11-20T05:00:00.000Z');
  });

  it('agrupa por hora, día, semana o mes según el largo, sin pasar de 31 grupos', () => {
    expect(grainOf(periodOf(TZ, '2026-11-24', '2026-11-24'))).toBe('hour');
    expect(grainOf(periodOf(TZ, '2026-10-25', '2026-11-24'))).toBe('day');
    expect(grainOf(periodOf(TZ, '2026-09-01', '2026-11-24'))).toBe('week');
    expect(grainOf(periodOf(TZ, '2026-01-01', '2026-11-24'))).toBe('month');
    const weeks = bucketsOf(periodOf(TZ, '2026-11-04', '2026-11-24'), 'week');
    // Semanas desde su lunes; la primera y la última se recortan al período
    expect(weeks.map((w) => [w.key, w.from, w.to])).toEqual([
      ['2026-11-02', '2026-11-04', '2026-11-08'],
      ['2026-11-09', '2026-11-09', '2026-11-15'],
      ['2026-11-16', '2026-11-16', '2026-11-22'],
      ['2026-11-23', '2026-11-23', '2026-11-24'],
    ]);
    const months = bucketsOf(periodOf(TZ, '2024-11-24', '2026-11-24'), 'month');
    expect(months).toHaveLength(25);
    expect(months[0]).toEqual({
      key: '2024-11',
      from: '2024-11-24',
      to: '2024-11-30',
    });
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('el mes anterior hasta el mismo día, sin pasarse de su último día', () => {
    expect(previousMonthRange('2026-11-15')).toEqual({
      from: '2026-10-01',
      to: '2026-10-15',
      last: '2026-10-31',
    });
    expect(previousMonthRange('2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      last: '2026-02-28',
    });
    expect(previousMonthRange('2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-10',
      last: '2025-12-31',
    });
  });
});
