import type { OutgoingDocument } from '../billing.types.js';
import {
  LUCODE_PRODUCTION,
  LUCODE_SANDBOX,
  LucodeProvider,
  lucodePayload,
  lucodeQr,
  parseLucode,
} from './lucode.provider.js';

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
      unitValue: '42.3728813559',
      unitPrice: '50',
      taxable: 42.37,
      igv: 7.63,
      total: 50,
      affectation: 'TAXED',
    },
    {
      code: 'P6',
      description: 'Alimento renal 2 kg',
      unit: 'NIU',
      quantity: 1.5,
      unitValue: '50',
      unitPrice: '50',
      taxable: 75,
      igv: 0,
      total: 75,
      affectation: 'EXEMPT',
    },
  ],
};
const config = { url: null, token: 'tok', production: false };
const ok = (estado: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      success: true,
      message: 'El comprobante fue enviado y aceptado por SUNAT.',
      payload: {
        estado,
        hash: '4HY34uR7a+Vc1Ax3',
        xml: 'https://sandbox.apisunat.pe/x.xml',
        cdr:
          estado === 'PENDIENTE' ? null : 'https://sandbox.apisunat.pe/R-x.xml',
        pdf: {
          ticket: 'https://sandbox.apisunat.pe/pdf/ticket/x',
          a4: 'https://sandbox.apisunat.pe/pdf/a4/x',
        },
        ...extra,
      },
    }),
    { status: 200 },
  );

describe('Lucode (APISUNAT)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('arma el JSON de la boleta con los nombres que espera Lucode', () => {
    const p = lucodePayload(boleta);
    expect(p).toMatchObject({
      documento: 'boleta',
      serie: 'B001',
      numero: 12,
      fecha_de_emision: '2026-10-28',
      moneda: 'PEN',
      tipo_operacion: '0101',
      cliente_tipo_de_documento: '1',
      cliente_numero_de_documento: '45678912',
      cliente_denominacion: 'Rosa Peña',
      cliente_direccion: '-',
      total: '125.00',
    });
    const [service, food] = p['items'] as Record<string, string>[];
    expect(service).toEqual({
      unidad_de_medida: 'ZZ',
      codigo_interno: 'S4',
      descripcion: 'Consulta general',
      cantidad: '1',
      valor_unitario: '42.3728813559',
      porcentaje_igv: '18',
      codigo_tipo_afectacion_igv: '10',
      nombre_tributo: 'IGV',
    });
    // Exonerado: 0 % y tributo EXO
    expect(food).toMatchObject({
      cantidad: '1.5',
      porcentaje_igv: '0',
      codigo_tipo_afectacion_igv: '20',
      nombre_tributo: 'EXO',
    });
  });

  it('inafecto: tributo INA', () => {
    const p = lucodePayload({
      ...boleta,
      lines: [{ ...boleta.lines[1], affectation: 'UNAFFECTED' }],
    });
    expect((p['items'] as Record<string, string>[])[0]).toMatchObject({
      codigo_tipo_afectacion_igv: '30',
      nombre_tributo: 'INA',
    });
  });

  it('boleta sin documento del cliente: "clientes varios" como lo pide Lucode', () => {
    const p = lucodePayload({
      ...boleta,
      customer: {
        docType: '-',
        docNumber: '-',
        name: 'CLIENTES VARIOS',
        address: null,
      },
    });
    expect(p).toMatchObject({
      cliente_tipo_de_documento: '1',
      cliente_numero_de_documento: '99999999',
      cliente_denominacion: 'CLIENTES VARIOS',
    });
  });

  it('la nota de crédito indica qué comprobante anula y no lleva tipo de operación', () => {
    const p = lucodePayload({
      ...boleta,
      type: 'CREDIT_NOTE',
      series: 'BC01',
      number: 1,
      related: { type: 'BOLETA', series: 'B001', number: 12 },
      reason: 'Cobro duplicado',
    });
    expect(p).toMatchObject({
      documento: 'nota_credito',
      nota_credito_codigo_tipo: '01',
      nota_credito_motivo: 'Cobro duplicado',
      documento_afectado: { documento: 'boleta', serie: 'B001', numero: 12 },
    });
    expect(p).not.toHaveProperty('tipo_operacion');
  });

  it('interpreta la respuesta: aceptado, pendiente o rechazado; arma el QR con el hash', () => {
    const accepted = parseLucode(
      {
        success: true,
        message: 'Aceptado',
        payload: {
          estado: 'ACEPTADO',
          hash: 'abc=',
          xml: 'https://x/xml',
          cdr: 'https://x/cdr',
          pdf: { ticket: 'https://x/t', a4: 'https://x/a4' },
        },
      },
      boleta,
    );
    expect(accepted).toMatchObject({
      status: 'ACCEPTED',
      hash: 'abc=',
      pdfUrl: 'https://x/a4',
      xmlUrl: 'https://x/xml',
      cdrUrl: 'https://x/cdr',
      qrText: '20601234561|03|B001|12|19.07|125.00|2026-10-28|1|45678912|abc=|',
    });
    expect(
      parseLucode({ success: true, payload: { estado: 'PENDIENTE' } }, boleta)
        .status,
    ).toBe('SENT');
    expect(
      parseLucode(
        {
          success: true,
          message: 'El comprobante presenta errores',
          payload: { estado: 'RECHAZADO' },
        },
        boleta,
      ),
    ).toMatchObject({
      status: 'REJECTED',
      description: 'El comprobante presenta errores',
    });
  });

  it('el QR de una boleta a clientes varios usa el documento genérico', () => {
    expect(
      lucodeQr(
        {
          ...boleta,
          customer: { docType: '-', docNumber: '-', name: 'X', address: null },
        },
        'h',
      ),
    ).toContain('|1|99999999|h|');
  });

  it('usa el sandbox en pruebas y la app en producción, con el token Bearer', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok('ACEPTADO'))
      .mockResolvedValueOnce(ok('ACEPTADO'));
    await new LucodeProvider().send(boleta, config);
    await new LucodeProvider().send(boleta, { ...config, production: true });
    expect(fetch.mock.calls[0][0]).toBe(`${LUCODE_SANDBOX}/api/v3/documents`);
    expect(fetch.mock.calls[1][0]).toBe(
      `${LUCODE_PRODUCTION}/api/v3/documents`,
    );
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok',
    );
  });

  it('si el documento ya se había emitido (se cortó la respuesta), lo consulta', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            message: 'ERROR: boleta B001-12 fue emitido anteriormente.',
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(ok('ACEPTADO'));
    const result = await new LucodeProvider().send(boleta, config);
    expect(result.status).toBe('ACCEPTED');
    expect(fetch.mock.calls[1][0]).toBe(`${LUCODE_SANDBOX}/api/v3/status`);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      documento: 'boleta',
      serie: 'B001',
      numero: 12,
    });
  });

  it('un dato mal no se reintenta; una caída o un error del PSE, sí; un token malo, no', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          message: 'El campo documento es requerido',
        }),
        {
          status: 422,
        },
      ),
    );
    await expect(
      new LucodeProvider().send(boleta, config),
    ).rejects.toMatchObject({
      retryable: false,
      message: 'PSE: El campo documento es requerido',
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );
    await expect(
      new LucodeProvider().send(boleta, config),
    ).rejects.toMatchObject({
      retryable: true,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 502 }),
    );
    await expect(
      new LucodeProvider().send(boleta, config),
    ).rejects.toMatchObject({
      retryable: true,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, message: 'Acceso no autorizado.' }),
        {
          status: 401,
        },
      ),
    );
    await expect(
      new LucodeProvider().send(boleta, config),
    ).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('probar conexión: "no se encuentra registrado" significa que el token sirve', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          message: 'Boleta B001-99999999 no se encuentra registrado.',
        }),
        { status: 400 },
      ),
    );
    await expect(new LucodeProvider().check(config)).resolves.toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 401 }),
    );
    await expect(new LucodeProvider().check(config)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('sin token no intenta enviar', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(
      new LucodeProvider().send(boleta, { ...config, token: null }),
    ).rejects.toMatchObject({ retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
