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
    // Plantilla nueva (v0.4.12) y la anterior
    expect(productFieldFor('Se cuenta por')).toBe('baseUnit');
    expect(productFieldFor('Unidad mínima')).toBe('baseUnit');
    expect(productFieldFor('Trae (1 si es una sola)')).toBe('factor');
    expect(productFieldFor('Trae')).toBe('factor');
    expect(productFieldFor('Psicotrópico DIGEMID (Sí/No)')).toBe('controlled');
    expect(productFieldFor('Controlado (Sí/No)')).toBe('controlled');
    expect(productFieldFor('Stock que tienes (en esta presentación)')).toBe(
      'quantity',
    );
    expect(productFieldFor('Vencimiento (AAAA-MM-DD)')).toBe('expiresAt');
    expect(productFieldFor('Stock mínimo')).toBe('minStock');
    expect(productFieldFor('Vencimiento')).toBe('expiresAt');
    expect(productFieldFor('Código')).toBe('code');
    expect(productFieldFor('Código de barras')).toBe('barcode');
    expect(productFieldFor('EAN')).toBe('barcode');
    expect(productFieldFor('Precio con IGV')).toBe('price');
    expect(productFieldFor('IGV (Gravado/Exonerado/Inafecto)')).toBe('igv');
    expect(productFieldFor('IGV')).toBe('igv');
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
      barcode: null,
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
      '«Trae» debe ser un número mayor a 0 (1 si es una sola)',
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
    expect(med.errors).toContain('Con stock, indica el vencimiento (MM/AAAA)');
    expect(acc.status).toBe('ok');
    expect(old.errors).toContain(
      'Ese lote ya está vencido: no se puede ingresar',
    );
  });

  it('acepta plurales y abreviaturas en categoría y unidad', () => {
    const [a, b] = validateProductRows(
      [
        row(2, {
          name: 'Bravecto 10-20 kg',
          category: 'Antiparasitarios',
          baseUnit: 'Tabs',
          presentation: 'Tableta',
          factor: '1',
          price: '120',
        }),
        row(3, {
          name: 'Jeringa 3 ml',
          category: 'INSUMOS',
          baseUnit: 'Unid.',
          presentation: 'Unidad',
          factor: '1',
          price: '1',
        }),
      ],
      today,
    );
    expect(a.product).toMatchObject({
      category: 'ANTIPARASITIC',
      baseUnit: 'TABLET',
    });
    expect(b.product).toMatchObject({ category: 'SUPPLY', baseUnit: 'UNIT' });
  });

  it('dos lotes de la misma presentación: la segunda fila solo suma el lote', () => {
    const other = { ...base, name: 'Otro producto' };
    const third = { ...base, name: 'Tercer producto' };
    const rows = validateProductRows(
      [
        row(2, {
          ...base,
          presentation: 'Caja x 100',
          factor: '100',
          price: '150',
          quantity: '2',
          lotNumber: 'L1',
          expiresAt: '2027-03-31',
          cost: '90',
        }),
        row(3, {
          ...base,
          presentation: 'Caja x 100',
          factor: '100',
          quantity: '1',
          lotNumber: 'L2',
          expiresAt: '2027-09-30',
          cost: '92',
        }),
        row(4, { ...other, presentation: 'Caja', factor: '10', price: '5' }),
        row(5, { ...other, presentation: 'Caja', factor: '10' }),
        row(6, { ...third, presentation: 'Caja', factor: '10', price: '5' }),
        row(7, {
          ...third,
          presentation: 'Caja',
          factor: '50',
          quantity: '1',
          expiresAt: '2027-09-30',
        }),
        row(8, { ...base, presentation: 'Tableta', factor: '1', price: '2' }),
      ],
      today,
    );
    expect(rows[1]).toMatchObject({ extraLot: true, errors: [] });
    expect(rows[1].warnings).toEqual([]);
    expect(rows[3].errors[0]).toContain('para otro lote, pon su cantidad');
    expect(rows[5].errors[0]).toContain('otro «Trae» o precio');
  });

  it('el lote es obligatorio solo en vacunas y controlados; alimento basta con vencimiento', () => {
    const [food, vac, ctrl] = validateProductRows(
      [
        row(2, {
          name: 'Alimento cachorro 3 kg',
          category: 'Alimentos',
          baseUnit: 'Unidad',
          presentation: 'Bolsa 3 kg',
          factor: '1',
          price: '89',
          quantity: '4',
          expiresAt: '2027-05-01',
          cost: '60',
        }),
        row(3, {
          name: 'Nobivac Rabia',
          category: 'Vacuna',
          baseUnit: 'Unidad',
          presentation: 'Dosis',
          factor: '1',
          price: '40',
          quantity: '10',
          expiresAt: '2027-05-01',
        }),
        row(4, {
          name: 'Tramadol 50 mg',
          category: 'Medicamento',
          baseUnit: 'Tableta',
          presentation: 'Tableta',
          factor: '1',
          price: '3',
          controlled: 'Sí',
          quantity: '20',
          expiresAt: '2027-05-01',
        }),
      ],
      today,
    );
    expect(food.status).toBe('ok');
    expect(food.stock?.lotNumber).toBeNull();
    expect(vac.errors[0]).toContain('indica el lote');
    expect(ctrl.errors[0]).toContain('indica el lote');
  });

  it('lee el IGV y el código de barras; avisa sin bloquear si falta precio o costo o vence pronto', () => {
    const rows = validateProductRows(
      [
        row(2, {
          ...base,
          presentation: 'Tableta',
          factor: '1',
          igv: 'Exonerado',
          barcode: ' 7751234 ',
          quantity: '10',
          lotNumber: 'L1',
          expiresAt: '2026-11-10',
        }),
        row(3, {
          name: 'Otro',
          category: 'Medicamento',
          baseUnit: 'Tableta',
          presentation: 'Tableta',
          factor: '1',
          price: '2',
          barcode: '7751234',
        }),
        row(4, {
          name: 'Tercero',
          category: 'Medicamento',
          baseUnit: 'Tableta',
          presentation: 'Tableta',
          factor: '1',
          price: '2',
          igv: 'Libre',
        }),
      ],
      today,
    );
    expect(rows[0].status).toBe('ok');
    expect(rows[0].product.igv).toBe('EXEMPT');
    expect(rows[0].presentation.barcode).toBe('7751234');
    expect(rows[0].warnings).toEqual([
      'Vence en 14 días',
      'Sin costo: el margen de este lote saldrá incompleto',
      'Sin precio: no se podrá cobrar hasta ponérselo',
    ]);
    expect(rows[1].errors).toContain(
      'El código de barras ya está en la fila 2',
    );
    expect(rows[2].errors[0]).toContain('IGV «Libre» no reconocido');
  });
  it('sin una fila con Trae = 1 no se importa: casi siempre es el stock puesto en «Trae»', () => {
    const [a, b] = validateProductRows(
      [
        row(2, {
          name: 'Shampoo Alerdog',
          category: 'Higiene',
          baseUnit: 'Unidad',
          presentation: 'Unidad',
          factor: '3',
          price: '35',
        }),
        row(3, {
          name: 'Shampoo bien',
          category: 'Higiene',
          baseUnit: 'Frasco',
          presentation: 'Frasco',
          factor: '1',
          price: '35',
        }),
      ],
      today,
    );
    expect(a.status).toBe('error');
    expect(a.errors[0]).toContain('«Trae» = 1');
    expect(b.status).toBe('ok');
  });

  it('el vencimiento MM/AAAA es el último día del mes', () => {
    const [r, bad] = validateProductRows(
      [
        row(2, {
          ...base,
          presentation: 'Tableta',
          factor: '1',
          price: '2',
          quantity: '10',
          expiresAt: '02/2028',
        }),
        row(3, {
          name: 'Otro',
          category: 'Alimento',
          baseUnit: 'Unidad',
          presentation: 'Bolsa',
          factor: '1',
          quantity: '1',
          expiresAt: '13/2028',
        }),
      ],
      today,
    );
    expect(r.stock?.expiresAt).toBe('2028-02-29');
    expect(bad.errors[0]).toContain('MM/AAAA');
  });
});

import { wrongBasePresentation } from '../unit-names.js';

describe('presentación «de 1» mal cargada', () => {
  it('detecta el stock puesto en «Trae» y respeta las presentaciones de verdad', () => {
    const p = (name: string, factor: number) => ({ name, factor });
    expect(wrongBasePresentation([p('Unidad', 3)], 'UNIT')?.name).toBe(
      'Unidad',
    );
    expect(wrongBasePresentation([p('Shampoo', 3)], 'BOTTLE')?.name).toBe(
      'Shampoo',
    );
    expect(
      wrongBasePresentation(
        [p('Caja x 30', 30), p('Tableta x1', 192)],
        'TABLET',
      )?.name,
    ).toBe('Tableta x1');
    expect(wrongBasePresentation([p('Caja x 30', 30)], 'TABLET')).toBeNull();
    expect(
      wrongBasePresentation([p('Blíster', 10), p('Caja x 100', 100)], 'TABLET'),
    ).toBeNull();
    expect(wrongBasePresentation([p('Por kilo', 1000)], 'G')).toBeNull();
    expect(
      wrongBasePresentation([p('Frasco', 1), p('Caja', 12)], 'BOTTLE'),
    ).toBeNull();
  });
});
