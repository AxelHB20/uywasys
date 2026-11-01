import type { OutgoingDocument } from '../billing.types.js';
import {
  NubefactProvider,
  nubefactPayload,
  parseNubefact,
} from './nubefact.provider.js';

const boleta: OutgoingDocument = {
  type: 'BOLETA',
  series: 'B001',
  number: 12,
  issueDate: '2026-10-28',
  clinicRuc: '20601234561',
  customer: {
    docType: '1',
    docNumber: '45678912',
    name: 'Rosa Peña',
    address: null,
  },
  totals: { taxed: 105.93, exempt: 0, unaffected: 0, igv: 19.07, total: 125 },
  lines: [
    {
      code: 'S4',
      description: 'Consulta general',
      unit: 'ZZ',
      quantity: 1,
      unitValue: '42.37',
      unitPrice: '50',
      taxable: 42.37,
      igv: 7.63,
      total: 50,
      affectation: 'TAXED',
    },
    {
      code: 'S6',
      description: 'Vacunación séxtuple',
      unit: 'ZZ',
      quantity: 1,
      unitValue: '63.56',
      unitPrice: '75',
      taxable: 63.56,
      igv: 11.44,
      total: 75,
      affectation: 'TAXED',
    },
  ],
};
const config = {
  url: 'https://api.nubefact.com/api/v1/ruta',
  token: 'tok',
  production: false,
};

describe('Nubefact', () => {
  afterEach(() => vi.restoreAllMocks());

  it('arma el JSON de la boleta con los nombres que espera Nubefact', () => {
    const p = nubefactPayload(boleta);
    expect(p).toMatchObject({
      operacion: 'generar_comprobante',
      tipo_de_comprobante: 2,
      serie: 'B001',
      numero: 12,
      cliente_tipo_de_documento: '1',
      fecha_de_emision: '28-10-2026',
      moneda: 1,
      total_gravada: 105.93,
      total_igv: 19.07,
      total: 125,
      codigo_unico: 'B001-12',
    });
    expect(p).not.toHaveProperty('total_exonerada');
    expect((p['items'] as unknown[])[0]).toMatchObject({
      unidad_de_medida: 'ZZ',
      valor_unitario: '42.37',
      precio_unitario: '50',
      subtotal: 42.37,
      tipo_de_igv: 1,
      igv: 7.63,
      total: 50,
    });
  });

  it('la nota de crédito indica qué comprobante anula', () => {
    const p = nubefactPayload({
      ...boleta,
      type: 'CREDIT_NOTE',
      series: 'BC01',
      number: 1,
      related: { type: 'BOLETA', series: 'B001', number: 12 },
      reason: 'Cobro duplicado',
    });
    expect(p).toMatchObject({
      tipo_de_comprobante: 3,
      documento_que_se_modifica_tipo: 2,
      documento_que_se_modifica_serie: 'B001',
      documento_que_se_modifica_numero: 12,
      tipo_de_nota_de_credito: 1,
      observaciones: 'Cobro duplicado',
    });
  });

  it('interpreta la respuesta: aceptado, esperando a SUNAT o rechazado', () => {
    expect(
      parseNubefact({
        aceptada_por_sunat: true,
        codigo_hash: 'abc',
        enlace_del_pdf: 'https://x/pdf',
      }),
    ).toMatchObject({
      status: 'ACCEPTED',
      hash: 'abc',
      pdfUrl: 'https://x/pdf',
    });
    expect(
      parseNubefact({ aceptada_por_sunat: false, sunat_responsecode: '0' })
        .status,
    ).toBe('SENT');
    expect(
      parseNubefact({
        aceptada_por_sunat: false,
        sunat_responsecode: '2017',
        sunat_description: 'RUC no existe',
      }),
    ).toMatchObject({ status: 'REJECTED', description: 'RUC no existe' });
  });

  it('manda el token en la cabecera y, si el documento ya existía, lo consulta', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ errors: 'Este documento ya existe', codigo: 23 }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ aceptada_por_sunat: true }), {
          status: 200,
        }),
      );
    const result = await new NubefactProvider().send(boleta, config);
    expect(result.status).toBe('ACCEPTED');
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Token token="tok"',
    );
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({
      operacion: 'consultar_comprobante',
    });
  });

  it('una caída se reintenta; un token malo, no', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );
    await expect(
      new NubefactProvider().send(boleta, config),
    ).rejects.toMatchObject({ retryable: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 401 }),
    );
    await expect(
      new NubefactProvider().send(boleta, config),
    ).rejects.toMatchObject({ retryable: false });
  });
});
