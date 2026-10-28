import { clientCode, initials, petCode, relativeDay } from './records';

describe('códigos y fechas del expediente', () => {
  it('arma los códigos con ceros a la izquierda', () => {
    expect(clientCode(12)).toBe('C-00012');
    expect(petCode(345)).toBe('HC-00345');
  });

  it('iniciales de las dos primeras palabras', () => {
    expect(initials('rosa peña quispe')).toBe('RP');
  });

  it('fechas relativas', () => {
    const today = new Date(2026, 9, 27);
    expect(relativeDay('2026-10-27', today)).toBe('Hoy');
    expect(relativeDay('2026-10-26', today)).toBe('Ayer');
    expect(relativeDay(null, today)).toBe('—');
    // 27 oct. 23:00 en Lima ya es 28 oct. en UTC: debe decir "Hoy"
    expect(relativeDay('2026-10-28T04:00:00.000Z', today)).toBe('Hoy');
    expect(relativeDay('2025-03-02', today)).toContain('2025');
  });
});
