import { clockTime, durationLabel, minutesBetween } from './queue-time';

describe('tiempos de la cola', () => {
  it('hora en Lima con formato de 24 h', () => {
    expect(clockTime('2026-10-28T00:10:00Z')).toBe('19:10');
  });

  it('minutos y duraciones legibles', () => {
    expect(minutesBetween('2026-10-27T14:00:00Z', '2026-10-27T15:15:00Z')).toBe(75);
    expect(durationLabel(5)).toBe('5 min');
    expect(durationLabel(75)).toBe('1 h 15 min');
    expect(durationLabel(120)).toBe('2 h');
  });
});
