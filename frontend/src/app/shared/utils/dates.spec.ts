import { formatDate } from './dates';

describe('formatDate', () => {
  // 18:39 UTC = 13:39 en Lima
  const instant = '2026-10-28T18:39:00Z';

  it('usa el formato peruano y la hora de Lima', () => {
    expect(formatDate(instant)).toBe('28/10/2026');
    expect(formatDate(instant, 'datetime')).toBe('28/10/2026 · 13:39');
    expect(formatDate(instant, 'time')).toBe('13:39');
    expect(formatDate(instant, 'month')).toBe('octubre 2026');
  });

  it('pasada la medianoche UTC sigue siendo el día anterior en Lima', () => {
    expect(formatDate('2026-10-29T03:00:00Z', 'datetime')).toBe('28/10/2026 · 22:00');
  });

  it('las fechas sin hora no se corren de día', () => {
    expect(formatDate('2026-11-14', 'calendar')).toBe('14/11/2026');
    expect(formatDate('2026-11-14T00:00:00.000Z', 'calendar')).toBe('14/11/2026');
  });

  it('vacío o inválido no rompe la pantalla', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('no-es-fecha', 'datetime')).toBe('');
  });
});
