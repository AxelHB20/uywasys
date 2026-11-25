import { Prisma } from '../generated/prisma/client.js';
import {
  allocate,
  checkPayments,
  expectedCash,
  saleNoteCode,
} from './cash-math.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('checkPayments', () => {
  it('cobro mixto: efectivo con vuelto más Yape', () => {
    const { lines, change } = checkPayments(
      [
        { method: 'CASH', amount: 50, tendered: 100 },
        { method: 'YAPE', amount: 30.5, operationCode: '123456' },
      ],
      D('80.50'),
    );
    expect(change.toFixed(2)).toBe('50.00');
    expect(lines.map((l) => [l.method, l.amount.toFixed(2)])).toEqual([
      ['CASH', '50.00'],
      ['YAPE', '30.50'],
    ]);
  });

  it('los pagos deben sumar exactamente lo cobrado', () => {
    expect(() =>
      checkPayments([{ method: 'CASH', amount: 79.99 }], D(80)),
    ).toThrow('Los pagos suman S/ 79.99 y el cobro es de S/ 80.00');
  });

  it('el efectivo recibido no puede ser menor al monto', () => {
    expect(() =>
      checkPayments([{ method: 'CASH', amount: 50, tendered: 40 }], D(50)),
    ).toThrow('no cubre');
  });

  it('el código de operación es opcional; si se escribe, mínimo 4 caracteres', () => {
    for (const method of ['YAPE', 'PLIN', 'TRANSFER'] as const) {
      const { lines } = checkPayments([{ method, amount: 10 }], D(10));
      expect(lines[0].operationCode).toBeNull();
      expect(() =>
        checkPayments([{ method, amount: 10, operationCode: '12' }], D(10)),
      ).toThrow('al menos 4');
    }
    // El voucher de tarjeta no tiene largo mínimo
    expect(
      checkPayments(
        [{ method: 'CARD', amount: 10, operationCode: 'V-1' }],
        D(10),
      ).lines[0].operationCode,
    ).toBe('V-1');
    expect(
      checkPayments(
        [{ method: 'YAPE', amount: 10, operationCode: ' 0012345 ' }],
        D(10),
      ).lines[0].operationCode,
    ).toBe('0012345');
  });

  it('solo el efectivo tiene vuelto y cada medio va una vez', () => {
    expect(() =>
      checkPayments([{ method: 'CARD', amount: 10, tendered: 20 }], D(10)),
    ).toThrow('Solo el efectivo');
    expect(() =>
      checkPayments(
        [
          { method: 'CASH', amount: 5 },
          { method: 'CASH', amount: 5 },
        ],
        D(10),
      ),
    ).toThrow('una sola vez');
  });
});

describe('allocate', () => {
  const charges = [
    { id: 1, balance: D(60) },
    { id: 2, balance: D(45) },
    { id: 3, balance: D('19.90') },
  ];

  it('cubre del más antiguo al más nuevo y deja el resto como deuda', () => {
    expect(
      allocate(charges, D(80)).map((a) => [a.chargeId, a.amount.toFixed(2)]),
    ).toEqual([
      [1, '60.00'],
      [2, '20.00'],
    ]);
  });

  it('el pago completo cubre todo exacto', () => {
    const all = allocate(charges, D('124.90'));
    expect(all.reduce((s, a) => s.plus(a.amount), D(0)).toFixed(2)).toBe(
      '124.90',
    );
    expect(all).toHaveLength(3);
  });

  it('no deja cobrar más de lo que se debe', () => {
    expect(() => allocate(charges, D(125))).toThrow('supera lo que debe');
  });
});

describe('arqueo', () => {
  it('esperado = inicial + efectivo − egresos − devoluciones en efectivo', () => {
    expect(
      expectedCash({
        opening: D(100),
        cashIn: D('230.50'),
        expenses: D(15),
        cashRefunds: D(40),
      }).toFixed(2),
    ).toBe('275.50');
  });

  it('código del ticket', () => {
    expect(saleNoteCode(123)).toBe('NV-000123');
  });
});
