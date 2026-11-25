import type { OutgoingDocument, ProviderConfig } from '../billing.types.js';
import {
  MIFACT_DEMO,
  alreadySent,
  friendlyError,
  MifactProvider,
  mifactPayload,
  parseMifact,
} from './mifact.provider.js';

const boleta: OutgoingDocument = {
  type: 'BOLETA',
  series: 'B001',
  number: 12,
  issueDate: '2026-11-14',
  clinicRuc: '20601234561',
  customer: {
    docType: '1',
    docNumber: '45678912',
    name: 'Rosa Peña',
    address: null,
  },
  totals: { taxed: 42.37, exempt: 75, unaffected: 0, igv: 7.63, total: 125 },
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
const config: ProviderConfig = {
  url: null,
  token: 'tok',
  production: false,
  issuer: {
    legalName: 'VETERINARIA HUELLITAS S.A.C.',
    fiscalAddress: 'Av. Los Olivos 123, Lima',
    ubigeo: '150101',
  },
};
/** Respuesta real del demo de Mifact (14/11/2026) */
const accepted = {
  cadena_para_codigo_qr:
    '20100100100|03|B004|00113631|1.80|11.80|2026-11-14|0|00000000|SFvVbrWsVFbaZjL6H1mByHQdro0=',
  cdr_sunat: '',
  codigo_hash: 'SFvVbrWsVFbaZjL6H1mByHQdro0=',
  correlativo_cpe: '00113631',
  errors: '',
  estado_documento: '102',
  pdf_bytes: null,
  serie_cpe: 'B004',
  sunat_description: 'La Boleta numero B004-00113631, ha sido aceptada',
  sunat_note: '',
  sunat_responsecode: '0',
  ticket_sunat: '',
  tipo_cpe: '03',
  url: '',
  xml_enviado: '',
};
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status });
const sentBody = (fetch: { mock: { calls: unknown[][] } }, i = 0) =>
  JSON.parse((fetch.mock.calls[i][1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;

describe('Mifact', () => {
  afterEach(() => vi.restoreAllMocks());

  it('arma el JSON de la boleta con los campos que espera Mifact', () => {
    const p = mifactPayload(boleta, config);
    expect(p).toMatchObject({
      TOKEN: 'tok',
      NUM_NIF_EMIS: '20601234561',
      COD_TIP_NIF_EMIS: '6',
      NOM_RZN_SOC_EMIS: 'VETERINARIA HUELLITAS S.A.C.',
      COD_UBI_EMIS: '150101',
      TXT_DMCL_FISC_EMIS: 'Av. Los Olivos 123, Lima',
      COD_TIP_NIF_RECP: '1',
      NUM_NIF_RECP: '45678912',
      NOM_RZN_SOC_RECP: 'Rosa Peña',
      TXT_DMCL_FISC_RECEP: 'SIN DIRECCION',
      FEC_EMIS: '2026-11-14',
      COD_TIP_CPE: '03',
      NUM_SERIE_CPE: 'B001',
      NUM_CORRE_CPE: '00000012',
      COD_MND: 'PEN',
      MNT_TOT_GRAVADO: '42.37',
      MNT_TOT_EXONERADO: '75.00',
      MNT_TOT_INAFECTO: '0.00',
      MNT_TOT_TRIB_IGV: '7.63',
      MNT_TOT: '125.00',
      ENVIAR_A_SUNAT: 'true',
      COD_TIP_OPE_SUNAT: '0101',
    });
    expect(p).not.toHaveProperty('COD_TIP_NC');
    const [service, food] = p['items'] as Record<string, string>[];
    expect(service).toEqual({
      COD_ITEM: 'S4',
      COD_UNID_ITEM: 'ZZ',
      CANT_UNID_ITEM: '1',
      VAL_UNIT_ITEM: '42.3728813559',
      PRC_VTA_UNIT_ITEM: '50',
      VAL_VTA_ITEM: '42.37',
      MNT_BRUTO: '42.37',
      MNT_PV_ITEM: '50.00',
      COD_TIP_PRC_VTA: '01',
      COD_TIP_AFECT_IGV_ITEM: '10',
      COD_TRIB_IGV_ITEM: '1000',
      POR_IGV_ITEM: '18',
      MNT_IGV_ITEM: '7.63',
      TXT_DESC_ITEM: 'Consulta general',
    });
    // Exonerado: tributo 9997 y 0 %
    expect(food).toMatchObject({
      CANT_UNID_ITEM: '1.5',
      COD_TIP_AFECT_IGV_ITEM: '20',
      COD_TRIB_IGV_ITEM: '9997',
      POR_IGV_ITEM: '0.00',
    });
  });

  it('con correo del comprador, Mifact le envía el PDF', () => {
    expect(mifactPayload(boleta, config)).not.toHaveProperty(
      'TXT_CORREO_ENVIO',
    );
    expect(
      mifactPayload(
        { ...boleta, customer: { ...boleta.customer, email: 'conta@osys.pe' } },
        config,
      ),
    ).toMatchObject({ TXT_CORREO_ENVIO: 'conta@osys.pe' });
  });

  it('inafecto: tributo 9998', () => {
    const p = mifactPayload(
      { ...boleta, lines: [{ ...boleta.lines[1], affectation: 'UNAFFECTED' }] },
      config,
    );
    expect((p['items'] as Record<string, string>[])[0]).toMatchObject({
      COD_TIP_AFECT_IGV_ITEM: '30',
      COD_TRIB_IGV_ITEM: '9998',
    });
  });

  it('boleta sin documento del cliente: tipo 0 y 00000000, como lo pide Mifact', () => {
    const p = mifactPayload(
      {
        ...boleta,
        customer: { docType: '-', docNumber: '-', name: '', address: null },
      },
      config,
    );
    expect(p).toMatchObject({
      COD_TIP_NIF_RECP: '0',
      NUM_NIF_RECP: '00000000',
      NOM_RZN_SOC_RECP: 'CLIENTE SIN NOMBRE',
    });
  });

  it('la nota de crédito referencia el comprobante con su fecha', () => {
    const p = mifactPayload(
      {
        ...boleta,
        type: 'CREDIT_NOTE',
        series: 'BC01',
        number: 1,
        related: {
          type: 'BOLETA',
          series: 'B001',
          number: 12,
          issueDate: '2026-11-10',
        },
        reason: 'Cobro duplicado',
      },
      config,
    );
    expect(p).toMatchObject({
      COD_TIP_CPE: '07',
      NUM_SERIE_CPE: 'BC01',
      COD_TIP_NC: '01',
      TXT_DESC_MTVO: 'Cobro duplicado',
      docs_referenciado: [
        {
          COD_TIP_DOC_REF: '03',
          NUM_SERIE_CPE_REF: 'B001',
          NUM_CORRE_CPE_REF: '00000012',
          FEC_DOC_REF: '2026-11-10',
        },
      ],
    });
  });

  it('sin datos del emisor o sin el comprobante anulado no envía (no se reintenta)', () => {
    expect(() =>
      mifactPayload(boleta, {
        ...config,
        issuer: { ...config.issuer!, ubigeo: null },
      }),
    ).toThrow(expect.objectContaining({ retryable: false }));
    expect(() =>
      mifactPayload({ ...boleta, type: 'CREDIT_NOTE', related: null }, config),
    ).toThrow(expect.objectContaining({ retryable: false }));
  });

  it('interpreta la respuesta real del demo: aceptada, con hash y QR', () => {
    expect(parseMifact(accepted)).toEqual({
      status: 'ACCEPTED',
      description: 'La Boleta numero B004-00113631, ha sido aceptada',
      hash: 'SFvVbrWsVFbaZjL6H1mByHQdro0=',
      qrText: accepted.cadena_para_codigo_qr,
      pdfUrl: null,
      xmlUrl: null,
      cdrUrl: null,
    });
    expect(parseMifact({ estado_documento: '103' }).status).toBe('ACCEPTED');
    expect(parseMifact({ estado_documento: '101' }).status).toBe('SENT');
    expect(
      parseMifact({
        estado_documento: '104',
        sunat_description: 'El RUC del receptor no existe',
      }),
    ).toMatchObject({
      status: 'REJECTED',
      description: 'El RUC del receptor no existe',
    });
  });

  it('envía al demo sin ruta y a la ruta guardada en producción', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply(accepted))
      .mockResolvedValueOnce(reply(accepted));
    await new MifactProvider().send(boleta, config);
    await new MifactProvider().send(boleta, {
      ...config,
      production: true,
      url: 'https://www.mifact.net.pe/api/invoiceService.svc/',
    });
    expect(fetch.mock.calls[0][0]).toBe(`${MIFACT_DEMO}/SendInvoice`);
    expect(fetch.mock.calls[1][0]).toBe(
      'https://www.mifact.net.pe/api/invoiceService.svc/SendInvoice',
    );
    expect(sentBody(fetch).TOKEN).toBe('tok');
  });

  it('si ya se había enviado (se cortó la respuesta), consulta el estado', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        reply({ errors: 'El documento B001-00000012 ya existe' }),
      )
      .mockResolvedValueOnce(reply(accepted));
    const result = await new MifactProvider().send(boleta, config);
    expect(result.status).toBe('ACCEPTED');
    expect(fetch.mock.calls[1][0]).toBe(`${MIFACT_DEMO}/GetEstatusInvoice`);
    expect(sentBody(fetch, 1)).toEqual({
      TOKEN: 'tok',
      NUM_NIF_EMIS: '20601234561',
      COD_TIP_CPE: '03',
      NUM_SERIE_CPE: 'B001',
      NUM_CORRE_CPE: '00000012',
      FEC_EMIS: '2026-11-14',
    });
  });

  it('"ya que … no existe" no es un duplicado: se muestra el error real del envío', async () => {
    expect(alreadySent('El documento B001-00000012 ya existe')).toBe(true);
    expect(alreadySent('Comprobante registrado anteriormente')).toBe(true);
    expect(
      alreadySent(
        'No se puede emitir ya que el documento de referencia no existe',
      ),
    ).toBe(false);
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        reply({ errors: 'El comprobante ya fue enviado anteriormente' }),
      )
      .mockResolvedValueOnce(
        reply({ errors: 'El documento consultado no existe' }),
      );
    await expect(
      new MifactProvider().send(boleta, config),
    ).rejects.toMatchObject({
      message: expect.stringContaining('usa una serie nueva'),
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('un dato mal no se reintenta; una caída o un error del servidor, sí', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      reply({ errors: 'El ubigeo no es válido' }),
    );
    await expect(
      new MifactProvider().send(boleta, config),
    ).rejects.toMatchObject({
      retryable: false,
      message: 'PSE: El ubigeo no es válido',
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );
    await expect(
      new MifactProvider().send(boleta, config),
    ).rejects.toMatchObject({ retryable: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 503 }),
    );
    await expect(
      new MifactProvider().send(boleta, config),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('probar conexión: un "no existe" prueba el token; una queja del token, no', async () => {
    const withRuc = {
      ...config,
      issuer: { ...config.issuer!, ruc: '20601234561' },
    };
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply({ errors: 'No existe el documento' }));
    await expect(new MifactProvider().check(withRuc)).resolves.toBeUndefined();
    // Prueba con el RUC de la clínica: Mifact valida el token contra el RUC
    expect(sentBody(fetch).NUM_NIF_EMIS).toBe('20601234561');
    // Sin RUC no se puede probar
    await expect(new MifactProvider().check(config)).rejects.toMatchObject({
      retryable: false,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      reply({ errors: 'Error : TOKEN INCORRECTO PARA 20601234561' }),
    );
    await expect(new MifactProvider().check(withRuc)).rejects.toMatchObject({
      retryable: false,
      kind: 'auth',
      message: expect.stringContaining('no corresponde al RUC 20601234561'),
    });
    // Servicio cortado por falta de pago: tampoco es "conexión correcta"
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      reply({ errors: 'Usuario suspendido por deuda' }),
    );
    await expect(new MifactProvider().check(withRuc)).rejects.toMatchObject({
      kind: 'suspended',
      message: expect.stringContaining('revisa el pago'),
    });
  });

  it('cada error dice si es del token, del servicio, de la red o del comprobante', async () => {
    const kindOf = async (res: Response | Error) => {
      const spy = vi.spyOn(globalThis, 'fetch');
      if (res instanceof Error) spy.mockRejectedValueOnce(res);
      else spy.mockResolvedValueOnce(res);
      return new MifactProvider()
        .send(boleta, config)
        .then(() => 'ok')
        .catch((e: { kind: string | null }) => e.kind);
    };
    expect(await kindOf(new Response('', { status: 401 }))).toBe('auth');
    expect(await kindOf(reply({ errors: 'Token vencido' }))).toBe('auth');
    expect(await kindOf(reply({ errors: 'Servicio restringido' }))).toBe(
      'suspended',
    );
    expect(await kindOf(new Error('ECONNRESET'))).toBe('network');
    expect(await kindOf(new Response('', { status: 503 }))).toBe('network');
    expect(
      await kindOf(reply({ errors: 'El ubigeo no es válido' })),
    ).toBeNull();
  });

  it('sin token no intenta enviar', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(
      new MifactProvider().send(boleta, { ...config, token: null }),
    ).rejects.toMatchObject({ retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('friendlyError', () => {
  it('token vencido: dice qué hacer y conserva la palabra token', () => {
    const msg = friendlyError('Token invalido o expirado');
    expect(msg).toContain('Actualizar token');
    expect(msg).toMatch(/token/i);
  });
  it('servicio restringido: pide revisar el pago', () => {
    expect(friendlyError('Cuenta suspendida por deuda')).toContain(
      'revisa el pago',
    );
  });
  it('otros errores (forma de pago, fechas) pasan tal cual', () => {
    expect(friendlyError('La forma de pago es obligatoria')).toBe(
      'La forma de pago es obligatoria',
    );
    expect(friendlyError('Fecha de emisión vencida')).toBe(
      'Fecha de emisión vencida',
    );
  });
});
