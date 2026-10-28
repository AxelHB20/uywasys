import { Prisma } from '../../generated/prisma/client.js';
import { discountPercent, lineAmounts } from './igv.js';

const n = (d: Prisma.Decimal) => d.toFixed(2);

describe('lineAmounts (IGV incluido en el precio)', () => {
  it('separa base e IGV de un precio con IGV', () => {
    const a = lineAmounts({
      quantity: 1,
      unitPrice: 118,
      affectation: 'TAXED',
    });
    expect([n(a.total), n(a.taxable), n(a.igv), a.rate.toString()]).toEqual([
      '118.00',
      '100.00',
      '18.00',
      '0.18',
    ]);
  });

  it('base + IGV suman exactamente el total en cualquier precio, cantidad y descuento', () => {
    for (let cents = 1; cents <= 5000; cents += 7) {
      for (const quantity of [1, 2, 3, 0.5, 1.25]) {
        for (const discount of [0, 0.01, 0.33]) {
          const price = new Prisma.Decimal(cents).dividedBy(100);
          if (price.times(quantity).lt(discount)) continue;
          const a = lineAmounts({
            quantity,
            unitPrice: price,
            discount,
            affectation: 'TAXED',
          });
          expect(a.taxable.plus(a.igv).equals(a.total)).toBe(true);
          expect(a.taxable.decimalPlaces()).toBeLessThanOrEqual(2);
          expect(a.igv.decimalPlaces()).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('aplica el descuento antes de separar el IGV', () => {
    const a = lineAmounts({
      quantity: 2,
      unitPrice: 59,
      discount: 18,
      affectation: 'TAXED',
    });
    expect([n(a.gross), n(a.total), n(a.taxable), n(a.igv)]).toEqual([
      '118.00',
      '100.00',
      '84.75',
      '15.25',
    ]);
  });

  it('exonerado e inafecto no llevan IGV', () => {
    for (const affectation of ['EXEMPT', 'UNAFFECTED'] as const) {
      const a = lineAmounts({ quantity: 3, unitPrice: 10, affectation });
      expect([n(a.taxable), n(a.igv), a.rate.toString()]).toEqual([
        '30.00',
        '0.00',
        '0',
      ]);
    }
  });

  it('redondea medio céntimo hacia arriba', () => {
    const a = lineAmounts({
      quantity: 0.5,
      unitPrice: 0.05,
      affectation: 'EXEMPT',
    });
    expect(n(a.total)).toBe('0.03');
  });

  it('rechaza cantidades, precios o descuentos inválidos', () => {
    expect(() =>
      lineAmounts({ quantity: 0, unitPrice: 1, affectation: 'TAXED' }),
    ).toThrow();
    expect(() =>
      lineAmounts({ quantity: 1, unitPrice: -1, affectation: 'TAXED' }),
    ).toThrow();
    expect(() =>
      lineAmounts({
        quantity: 1,
        unitPrice: 10,
        discount: 11,
        affectation: 'TAXED',
      }),
    ).toThrow('El descuento no puede ser mayor que el importe');
  });

  it('calcula el porcentaje de descuento', () => {
    const d = discountPercent(new Prisma.Decimal(80), new Prisma.Decimal(8));
    expect(d.toNumber()).toBe(10);
    expect(
      discountPercent(new Prisma.Decimal(0), new Prisma.Decimal(0)).toNumber(),
    ).toBe(0);
  });
});
