import { DayHours, scheduleSummary } from './opening-hours';

const week = (pick: (day: number) => [string, string] | null): DayHours[] =>
  [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const h = pick(day);
    return { day, open: h?.[0] ?? null, close: h?.[1] ?? null };
  });

describe('scheduleSummary', () => {
  it('agrupa los días seguidos con el mismo horario', () => {
    expect(
      scheduleSummary(
        week((d) => (d <= 5 ? ['08:30', '20:00'] : d === 6 ? ['09:00', '13:00'] : null)),
      ),
    ).toBe('Lun a Vie 08:30–20:00 · Sáb 09:00–13:00 · Dom cerrado');
  });

  it('dos días seguidos se unen con "y", y todo cerrado no muestra nada', () => {
    expect(scheduleSummary(week((d) => (d <= 5 ? ['09:00', '18:00'] : null)))).toBe(
      'Lun a Vie 09:00–18:00 · Sáb y Dom cerrado',
    );
    expect(scheduleSummary(week(() => null))).toBe('');
  });
});
