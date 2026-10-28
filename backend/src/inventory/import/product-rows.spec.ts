import { productFieldFor, validateProductRows } from './product-rows.js';
import type { ProductField } from './product-rows.js';
import type { SheetRow } from '../../common/excel/sheet.js';

const today = '2026-10-27';
const row = (n: number, values: SheetRow<ProductField>['values']) => ({
  row: n,
  values,
});
const base = {
  name: 'Meloxicam 1 mg',
  category: 'Medicamento',
  baseUnit: 'Tableta',
};

describe('importación de productos', () => {
  it('reconoce los encabezados de la plantilla y variantes cortas', () => {
    expect(productFieldFor('Equivalencia (unidades mínimas)')).toBe('factor');
    expect(productFieldFor('Equivalencia')).toBe('factor');
    expect(productFieldFor('Cantidad inicial (en esta presentación)')).toBe(
      'quantity',
    );
    expect(productFieldFor('Stock')).toBe('quantity');
    expect(productFieldFor('Vencimiento')).toBe('expiresAt');
  });

  it('agrupa las presentaciones de un producto y lee precios y fechas', () => {
    const rows = validateProductRows(
      [
        row(2, {
          ...base,
          presentation: 'Caja x 100',
          factor: '100',
          price: 'S/ 150',
          quantity: '2',
          lotNumber: 'L1',
          expiresAt: '31/03/2027',
          cost: '90,5',
        }),
        row(3, { ...base, presentation: 'Tableta', factor: '1', price: '2' }),
      ],
      today,
    );
    expect(rows.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(rows[0].key).toBe(rows[1].key);
    expect(rows[0].presentation).toEqual({
      name: 'Caja x 100',
      factor: 100,
      price: 150,
    });
    expect(rows[0].stock).toMatchObject({
      quantity: 2,
      expiresAt: '2027-03-31',
      cost: 90.5,
    });
  });

  it('un producto con una fila mala no se importa a medias', () => {
    const rows = validateProductRows(
      [
        row(2, { ...base, presentation: 'Caja x 100', factor: '100' }),
        row(3, { ...base, presentation: 'Tableta', factor: '0' }),
      ],
      today,
    );
    expect(rows[1].errors).toContain(
      'La equivalencia debe ser un número mayor a 0',
    );
    expect(rows[0].status).toBe('error');
    expect(rows[0].errors[0]).toContain('fila 3');
  });

  it('el stock inicial de un medicamento exige lote y vencimiento vigente; el accesorio no', () => {
    const [med, acc, old] = validateProductRows(
      [
        row(2, {
          ...base,
          presentation: 'Tableta',
          factor: '1',
          quantity: '10',
        }),
        row(3, {
          name: 'Collar M',
          category: 'Accesorio',
          baseUnit: 'Unidad',
          presentation: 'Unidad',
          factor: '1',
          quantity: '5',
        }),
        row(4, {
          name: 'Vacuna X',
          category: 'Vacuna',
          baseUnit: 'Unidad',
          presentation: 'Dosis',
          factor: '1',
          quantity: '5',
          lotNumber: 'V1',
          expiresAt: '2026-01-01',
        }),
      ],
      today,
    );
    expect(med.errors).toContain(
      'Con cantidad inicial, indica el lote y el vencimiento',
    );
    expect(acc.status).toBe('ok');
    expect(old.errors).toContain(
      'Ese lote ya está vencido: no se puede ingresar',
    );
  });
});
