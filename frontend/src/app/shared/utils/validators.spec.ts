import { HttpErrorResponse } from '@angular/common/http';
import { FormControl } from '@angular/forms';
import { apiErrorMessage, maxDecimals, tooManyDecimals } from './validators';

const error = (status: number, body: unknown) =>
  new HttpErrorResponse({ status, error: body, url: '/api/x' });

describe('apiErrorMessage', () => {
  it('muestra el mensaje de la API, o el primero de validación', () => {
    expect(apiErrorMessage(error(409, { message: 'La caja ya está abierta' }))).toBe(
      'La caja ya está abierta',
    );
    expect(
      apiErrorMessage(
        error(400, { message: 'Datos inválidos', errors: ['El DNI tiene 8 dígitos'] }),
      ),
    ).toBe('El DNI tiene 8 dígitos');
  });

  it('sin conexión lo dice claro', () => {
    expect(apiErrorMessage(error(0, null))).toContain('No hay conexión con el servidor');
  });

  it('en un error inesperado da el código para soporte, sin detalles técnicos', () => {
    expect(
      apiErrorMessage(error(500, { message: 'Error interno del servidor', reference: '7F3A09C2' })),
    ).toBe('Ocurrió un error inesperado. Si se repite, avisa a soporte con el código 7F3A09C2.');
    expect(apiErrorMessage(error(502, null))).toBe(
      'Ocurrió un error inesperado. Inténtalo de nuevo en unos minutos.',
    );
  });
});

describe('maxDecimals', () => {
  it('acepta hasta los decimales permitidos y avisa si hay más', () => {
    expect(new FormControl(0.83, maxDecimals(2)).valid).toBe(true);
    expect(new FormControl(19.9, maxDecimals(2)).valid).toBe(true);
    expect(new FormControl(0.833, maxDecimals(2)).hasError('decimals')).toBe(true);
    expect(new FormControl(21.6667, maxDecimals(4)).valid).toBe(true);
    expect(new FormControl(21.66667, maxDecimals(4)).hasError('decimals')).toBe(true);
    expect(new FormControl(null, maxDecimals(2)).valid).toBe(true);
    expect(tooManyDecimals(2.5, 3)).toBe(false);
    expect(tooManyDecimals(2.5555, 3)).toBe(true);
  });
});
