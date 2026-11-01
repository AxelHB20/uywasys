import { ageParts, birthDateFromAge, petAge } from './pet-age';

const today = new Date(2026, 9, 27); // 27 oct 2026

describe('edad de la mascota', () => {
  it('muestra años y meses de forma legible', () => {
    expect(petAge('2023-10-27', today)).toBe('3 años');
    expect(petAge('2025-08-10', today)).toBe('1 año y 2 meses');
    expect(petAge('2026-05-01', today)).toBe('5 meses');
    expect(petAge('2026-10-06', today)).toBe('3 semanas');
    expect(petAge(null, today)).toBeNull();
    // Fecha ISO completa: el día cuenta igual (un día antes del cumpleaños sigue en 2 años)
    expect(petAge('2023-10-28T00:00:00.000Z', today)).toBe('2 años y 11 meses');
  });

  it('calcula una fecha estimada desde la edad y la recupera para editar', () => {
    const date = birthDateFromAge(2, 3, today);
    expect(date).toBe('2024-07-01');
    expect(ageParts(date, today)).toEqual({ years: 2, months: 3 });
  });
});
