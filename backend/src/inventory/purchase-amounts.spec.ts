import { Prisma } from '../generated/prisma/client.js';
import {
  docKeyOf,
  purchaseLineAmounts,
  unitCostOf,
} from './purchase-amounts.js';

const D = Prisma.Decimal;
const plain = (a: ReturnType<typeof purchaseLineAmounts>) => ({
  taxable: a.taxable.toFixed(2),
  igv: a.igv.toFixed(2),
  total: a.total.toFixed(2),
});

describe('purchaseLineAmounts', () => {
  it('precios sin IGV (valor unitario de la factura): suma el 18 %', () => {
    expect(
      plain(
        purchaseLineAmounts({
          quantity: 5,
          unitPrice: 40,
          pricesIncludeIgv: false,
          affectation: 'TAXED',
        }),
      ),
    ).toEqual({ taxable: '200.00', igv: '36.00', total: '236.00' });
  });

  it('precios con IGV: separa la base', () => {
    expect(
      plain(
        purchaseLineAmounts({
          quantity: 2,
          unitPrice: 59,
          pricesIncludeIgv: true,
          affectation: 'TAXED',
        }),
      ),
    ).toEqual({ taxable: '100.00', igv: '18.00', total: '118.00' });
  });

  it('exonerado o inafecto: sin IGV aunque la ficha diga "con IGV"', () => {
    for (const pricesIncludeIgv of [true, false])
      expect(
        plain(
          purchaseLineAmounts({
            quantity: 3,
            unitPrice: 10.5,
            pricesIncludeIgv,
            affectation: 'EXEMPT',
          }),
        ),
      ).toEqual({ taxable: '31.50', igv: '0.00', total: '31.50' });
  });

  it('bonificación: precio 0', () => {
    expect(
      plain(
        purchaseLineAmounts({
          quantity: 1,
          unitPrice: 0,
          pricesIncludeIgv: false,
          affectation: 'TAXED',
        }),
      ),
    ).toEqual({ taxable: '0.00', igv: '0.00', total: '0.00' });
  });

  it('base + IGV = total, exacto al céntimo', () => {
    for (const price of [0.33, 1.99, 12.345, 7.1])
      for (const pricesIncludeIgv of [true, false]) {
        const a = purchaseLineAmounts({
          quantity: 7,
          unitPrice: price,
          pricesIncludeIgv,
          affectation: 'TAXED',
        });
        expect(a.taxable.plus(a.igv).equals(a.total)).toBe(true);
      }
  });
});

describe('unitCostOf', () => {
  it('reparte el valor sin IGV entre las unidades mínimas (4 decimales)', () => {
    expect(unitCostOf(new D(200), new D(500)).toFixed(4)).toBe('0.4000');
    expect(unitCostOf(new D(100), new D(3)).toFixed(4)).toBe('33.3333');
    expect(unitCostOf(new D(0), new D(12)).toFixed(4)).toBe('0.0000');
  });
});

describe('docKeyOf', () => {
  it('la misma ficha escrita de varias formas da la misma clave', () => {
    for (const v of ['F001-00123', 'f001-123', ' F001 - 000123 '])
      expect(docKeyOf(v)).toBe('F001-123');
  });
  it('sin serie: solo el número sin ceros', () => {
    expect(docKeyOf('000456')).toBe('456');
  });
  it('textos libres quedan en mayúsculas y sin espacios', () => {
    expect(docKeyOf('Nota venta A')).toBe('NOTAVENTAA');
  });
  it('series distintas no se confunden', () => {
    expect(docKeyOf('F001-1')).not.toBe(docKeyOf('F002-1'));
    expect(docKeyOf('EG01-15')).toBe('EG01-15');
  });
});
