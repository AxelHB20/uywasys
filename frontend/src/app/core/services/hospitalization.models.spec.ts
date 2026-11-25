import {
  dayOf,
  frequencyLabel,
  relativeTime,
  temperatureFlag,
  whenOf,
} from './hospitalization.models';

describe('hospitalization.models', () => {
  const now = new Date('2026-11-02T17:00:00Z'); // 12:00 en Lima

  it('marca fiebre e hipotermia según la especie', () => {
    expect(temperatureFlag('DOG', 39.8)).toBe('high');
    expect(temperatureFlag('CAT', 37.5)).toBe('low');
    expect(temperatureFlag('DOG', 38.5)).toBeNull();
    expect(temperatureFlag('DOG', null)).toBeNull();
  });

  it('dice el día y la hora en Lima', () => {
    expect(dayOf('2026-11-02T20:00:00Z', now)).toBe('hoy');
    expect(dayOf('2026-11-03T13:00:00Z', now)).toBe('mañana');
    expect(dayOf('2026-11-01T13:00:00Z', now)).toBe('ayer');
    expect(whenOf('2026-11-02T20:00:00Z', now)).toBe('15:00');
    expect(whenOf('2026-11-03T13:00:00Z', now)).toBe('mañana 08:00');
  });

  it('tiempo relativo y frecuencia', () => {
    expect(relativeTime('2026-11-02T17:25:00Z', now)).toBe('en 25 min');
    expect(relativeTime('2026-11-02T15:00:00Z', now)).toBe('hace 2 h');
    expect(frequencyLabel(null)).toBe('Una sola vez');
    expect(frequencyLabel(8)).toBe('Cada 8 h');
  });
});
