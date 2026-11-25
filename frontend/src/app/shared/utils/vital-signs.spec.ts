import { vitalHint, vitalRange } from './vital-signs';

describe('vitalHint', () => {
  it('no avisa dentro del rango ni sin valor', () => {
    expect(vitalHint('DOG', 'temperatureC', 38.5)).toBeNull();
    expect(vitalHint('CAT', 'heartRate', 180)).toBeNull();
    expect(vitalHint('DOG', 'heartRate', null)).toBeNull();
  });

  it('usa el rango de cada especie', () => {
    // 150 lpm: alto para un perro, normal para un gato
    expect(vitalHint('DOG', 'heartRate', 150)?.level).toBe('warn');
    expect(vitalHint('CAT', 'heartRate', 150)).toBeNull();
    expect(vitalHint('CAT', 'heartRate', 120)?.text).toBe('Baja para un gato (140–220 lpm)');
  });

  it('pasa a rojo cuando está muy lejos', () => {
    expect(vitalHint('DOG', 'temperatureC', 39.6)).toEqual({
      level: 'warn',
      text: 'Alta para un perro (37.5–39.2 °C)',
    });
    expect(vitalHint('DOG', 'temperatureC', 40.5)?.level).toBe('danger');
    expect(vitalHint('CAT', 'temperatureC', 36.5)?.level).toBe('danger');
  });

  it('el llenado capilar vale para todas las especies', () => {
    expect(vitalHint('RABBIT', 'capillaryRefillS', 2)).toBeNull();
    expect(vitalHint('RABBIT', 'capillaryRefillS', 2.5)?.level).toBe('warn');
    expect(vitalHint('DOG', 'capillaryRefillS', 4)?.level).toBe('danger');
  });

  it('conejo y cuy tienen su propio rango', () => {
    expect(vitalHint('RABBIT', 'temperatureC', 39.5)).toBeNull();
    expect(vitalHint('RABBIT', 'heartRate', 100)?.text).toBe('Baja para un conejo (130–325 lpm)');
    expect(vitalHint('GUINEA_PIG', 'heartRate', 300)).toBeNull();
    expect(vitalHint('GUINEA_PIG', 'temperatureC', 41)?.level).toBe('danger');
  });

  it('aves y reptiles: no inventa avisos', () => {
    expect(vitalHint('BIRD', 'heartRate', 400)).toBeNull();
    expect(vitalHint('REPTILE', 'temperatureC', 30)).toBeNull();
  });

  it('el rango es el mismo para la consulta y la hospitalización', () => {
    expect(vitalRange('DOG', 'temperatureC')).toEqual([37.5, 39.2]);
    expect(vitalRange('CAT', 'heartRate')).toEqual([140, 220]);
    expect(vitalRange('BIRD', 'heartRate')).toBeNull();
  });
});
