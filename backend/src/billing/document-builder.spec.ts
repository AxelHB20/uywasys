import { Prisma } from '../generated/prisma/client.js';
import { buildLines, customerFor, PaidCharge } from './document-builder.js';

const D = (v: number | string) => new Prisma.Decimal(v);
const charge = (
  over: Partial<PaidCharge['charge']> = {},
): PaidCharge['charge'] => ({
  id: 1,
  description: 'Consulta general',
  quantity: D(1),
  total: D(50),
  taxableAmount: D(42.37),
  igvAmount: D(7.63),
  igvAffectation: 'TAXED',
  igvRate: D(0.18),
  sunatUnit: 'ZZ',
  productId: null,
  careServiceId: 4,
  ...over,
});

describe('buildLines', () => {
  it('un cargo pagado completo sale con sus montos y la suma cuadra', () => {
    const { lines, totals } = buildLines([
      { amount: D(50), charge: charge() },
      {
        amount: D(36),
        charge: charge({
          id: 2,
          description: 'Meloxicam 1 mg',
          quantity: D(3),
          total: D(36),
          taxableAmount: D(30.51),
          igvAmount: D(5.49),
          sunatUnit: 'NIU',
          productId: 7,
          careServiceId: null,
        }),
      },
    ]);
    expect(lines[1]).toMatchObject({
      code: 'P7',
      unit: 'NIU',
      quantity: 3,
      unitPrice: '12',
      unitValue: '10.17',
      taxable: 30.51,
      igv: 5.49,
      total: 36,
    });
    expect(totals).toEqual({
      taxed: 72.88,
      exempt: 0,
      unaffected: 0,
      igv: 13.12,
      total: 86,
    });
    expect(totals.taxed + totals.igv).toBeCloseTo(totals.total, 10);
  });

  it('un pago a cuenta sale por lo pagado, con base e IGV proporcionales', () => {
    const { lines, totals } = buildLines([{ amount: D(20), charge: charge() }]);
    expect(lines[0]).toMatchObject({
      description: 'Consulta general (pago a cuenta)',
      quantity: 1,
      taxable: 16.95,
      igv: 3.05,
      total: 20,
    });
    expect(totals.total).toBe(20);
  });

  it('lo exonerado no lleva IGV', () => {
    const { totals } = buildLines([
      {
        amount: D(30),
        charge: charge({
          igvAffectation: 'EXEMPT',
          total: D(30),
          taxableAmount: D(30),
          igvAmount: D(0),
        }),
      },
    ]);
    expect(totals).toEqual({
      taxed: 0,
      exempt: 30,
      unaffected: 0,
      igv: 0,
      total: 30,
    });
  });
});

describe('customerFor', () => {
  const rosa = {
    name: 'Rosa Peña',
    docType: 'DNI' as const,
    docNumber: '45678912',
    address: null,
    walkIn: false,
  };
  const varios = {
    name: 'Cliente varios',
    docType: null,
    docNumber: null,
    address: null,
    walkIn: true,
  };

  it('boleta con DNI, o "clientes varios" hasta S/ 700', () => {
    expect(customerFor('BOLETA', rosa, 1500)).toMatchObject({
      docType: '1',
      docNumber: '45678912',
    });
    expect(customerFor('BOLETA', varios, 89)).toEqual({
      docType: '-',
      docNumber: '-',
      name: 'CLIENTES VARIOS',
      address: null,
      email: null,
    });
    // SUNAT: el DNI va cuando la boleta supera S/ 700 (700.00 justos aún no)
    expect(customerFor('BOLETA', varios, 700).docType).toBe('-');
    expect(() =>
      customerFor(
        'BOLETA',
        { ...rosa, docType: null, docNumber: null },
        700.01,
      ),
    ).toThrow('más de S/ 700');
  });

  it('lo escrito en el cobro manda: factura a la empresa del cliente, boleta con DNI', () => {
    const ruc = {
      docType: 'RUC' as const,
      docNumber: '20601847834',
      name: 'OSYS COMPANY S.A.C.',
      address: ' Av. Surco 125 ',
      email: 'conta@osys.pe',
    };
    expect(customerFor('FACTURA', rosa, 50, ruc)).toEqual({
      docType: '6',
      docNumber: '20601847834',
      name: 'OSYS COMPANY S.A.C.',
      address: 'Av. Surco 125',
      email: 'conta@osys.pe',
    });
    // Cliente varios que pide factura
    expect(customerFor('FACTURA', varios, 50, ruc).docNumber).toBe(
      '20601847834',
    );
    // Boleta de más de S/ 700 con el DNI escrito en el cobro
    expect(
      customerFor('BOLETA', varios, 900, {
        docType: 'DNI',
        docNumber: '45678912',
        name: 'ROSA PEÑA',
      }),
    ).toMatchObject({ docType: '1', docNumber: '45678912', name: 'ROSA PEÑA' });
    expect(() =>
      customerFor('FACTURA', rosa, 50, { ...ruc, docType: 'DNI' }),
    ).toThrow('RUC');
  });

  it('factura con los datos de facturación guardados en la ficha', () => {
    expect(
      customerFor(
        'FACTURA',
        {
          ...rosa,
          invoiceRuc: '20601847834',
          invoiceName: 'OSYS COMPANY S.A.C.',
          invoiceAddress: null,
          invoiceEmail: 'conta@osys.pe',
        },
        50,
      ),
    ).toEqual({
      docType: '6',
      docNumber: '20601847834',
      name: 'OSYS COMPANY S.A.C.',
      address: null,
      email: 'conta@osys.pe',
    });
  });

  it('la factura exige RUC', () => {
    expect(() => customerFor('FACTURA', rosa, 50)).toThrow('RUC');
    expect(
      customerFor(
        'FACTURA',
        {
          ...rosa,
          name: 'Albergue SAC',
          docType: 'RUC',
          docNumber: '20131312955',
          address: 'Av. Lima 1',
        },
        50,
      ),
    ).toMatchObject({
      docType: '6',
      docNumber: '20131312955',
      address: 'Av. Lima 1',
    });
  });
});
