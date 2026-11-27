import { describe, expect, it } from 'vitest';
import { readablePath } from './all-exceptions.filter.js';

describe('readablePath', () => {
  it('cambia la ruta del campo anidado por un nombre que entiende el usuario', () => {
    expect(
      readablePath('presentations.0.El precio debe tener hasta 2 decimales'),
    ).toBe('Presentación 1: el precio debe tener hasta 2 decimales');
    expect(readablePath('lines.2.La cantidad debe ser mayor a 0')).toBe(
      'Línea 3: la cantidad debe ser mayor a 0',
    );
    expect(readablePath('items.0.Ingresa el medicamento')).toBe(
      'Fila 1: ingresa el medicamento',
    );
  });

  it('deja igual los mensajes sin ruta', () => {
    expect(readablePath('El nombre debe tener entre 2 y 120 caracteres')).toBe(
      'El nombre debe tener entre 2 y 120 caracteres',
    );
    expect(readablePath('Ingresa 2.5 kg')).toBe('Ingresa 2.5 kg');
  });
});
