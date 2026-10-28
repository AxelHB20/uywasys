import { fieldForHeader, validateRows } from './import-rows.js';
import type { RawRow } from './import-rows.js';

const today = '2026-10-27';
const row = (n: number, values: RawRow['values']): RawRow => ({
  row: n,
  values,
});

describe('importación: encabezados', () => {
  it('reconoce los encabezados sin importar tildes, mayúsculas ni detalles', () => {
    expect(fieldForHeader('N.º de documento')).toBe('docNumber');
    expect(fieldForHeader('NOMBRES Y APELLIDOS')).toBe('name');
    expect(fieldForHeader('Peso')).toBe('weightKg');
    expect(fieldForHeader('Fecha de nacimiento')).toBe('birthDate');
    expect(fieldForHeader('Teléfono')).toBe('phone');
    expect(fieldForHeader('Observaciones')).toBeNull();
  });
});

describe('importación: validación de filas', () => {
  it('acepta una fila completa y normaliza celular, especie y fecha', () => {
    const [r] = validateRows(
      [
        row(2, {
          docType: 'dni',
          docNumber: '4567891',
          name: '  Rosa   Quispe ',
          phone: '+51 987 654 321',
          petName: 'Toby',
          species: 'PERRO',
          sex: 'macho',
          birthDate: '01/05/2022',
          weightKg: '12,5',
          neutered: 'Sí',
        }),
      ],
      today,
    );
    expect(r.status).toBe('ok');
    // El DNI perdió el cero de la izquierda en Excel
    expect(r.client).toMatchObject({
      docNumber: '04567891',
      name: 'Rosa Quispe',
      phone: '987654321',
    });
    expect(r.pet).toMatchObject({
      species: 'DOG',
      sex: 'MALE',
      birthDate: '2022-05-01',
      weightKg: 12.5,
      neutered: true,
    });
  });

  it('explica cada error de la fila', () => {
    const [r] = validateRows(
      [
        row(3, {
          docType: 'RUC',
          docNumber: '20131312956',
          name: 'Al',
          phone: '812345678',
          petName: 'Coco',
          species: 'dragón',
          birthDate: '2999-01-01',
        }),
      ],
      today,
    );
    expect(r.status).toBe('error');
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'El RUC no es válido: revisa los 11 dígitos',
        'Falta el nombre del cliente',
        'El celular debe tener 9 dígitos y empezar con 9',
        expect.stringContaining('Especie «dragón» no reconocida'),
        'Revisa la fecha de nacimiento',
      ]),
    );
  });

  it('agrupa las mascotas del mismo cliente y detecta datos contradictorios', () => {
    const rows = validateRows(
      [
        row(2, {
          docType: 'DNI',
          docNumber: '45678912',
          name: 'Rosa Quispe',
          phone: '987654321',
          petName: 'Toby',
          species: 'Perro',
        }),
        row(3, {
          docType: 'DNI',
          docNumber: '45678912',
          name: 'Rosa Quispe',
          phone: '987654321',
          petName: 'Mishi',
          species: 'Gato',
        }),
        row(4, {
          docType: 'DNI',
          docNumber: '45678912',
          name: 'Otra Persona',
          phone: '987654321',
        }),
        row(5, { name: 'Juan Pérez', phone: '912345678' }),
      ],
      today,
    );
    expect(rows[0].key).toBe(rows[1].key);
    expect(rows[1].status).toBe('ok');
    expect(rows[2].errors[0]).toContain('fila 2');
    expect(rows[3]).toMatchObject({
      status: 'ok',
      client: { docType: null },
      pet: null,
    });
  });
});
