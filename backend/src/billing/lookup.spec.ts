import {
  APISPERU_LOOKUP,
  lookupApisperu,
  parseApisperuDni,
  parseApisperuRuc,
} from './lookup.js';

describe('Consulta RUC/DNI (APISPERU)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('RUC: razón social, dirección con distrito, estado y condición', () => {
    expect(
      parseApisperuRuc({
        ruc: '20601847834',
        razonSocial: 'OSYS COMPANY S.A.C.',
        direccion: 'CAL. MELCHORMALO NRO. 125',
        departamento: 'LIMA',
        provincia: 'LIMA',
        distrito: 'SANTIAGO DE SURCO',
        estado: 'ACTIVO',
        condicion: 'HABIDO',
      }),
    ).toEqual({
      name: 'OSYS COMPANY S.A.C.',
      address: 'CAL. MELCHORMALO NRO. 125, SANTIAGO DE SURCO - LIMA - LIMA',
      status: 'ACTIVO',
      condition: 'HABIDO',
      source: 'APISPERU',
    });
    expect(parseApisperuRuc({ razonSocial: '' })).toBeNull();
  });

  it('DNI: nombres y apellidos', () => {
    expect(
      parseApisperuDni({
        nombres: 'ROSA',
        apellidoPaterno: 'PEÑA',
        apellidoMaterno: 'QUISPE',
      })?.name,
    ).toBe('ROSA PEÑA QUISPE');
    expect(parseApisperuDni({})).toBeNull();
  });

  it('llama con el token y, si falla o se agotó el cupo, devuelve null', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ razonSocial: 'SUNAT' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockRejectedValueOnce(new Error('timeout'));
    expect((await lookupApisperu('t k', 'RUC', '20131312955'))?.name).toBe(
      'SUNAT',
    );
    expect(fetch.mock.calls[0][0]).toBe(
      `${APISPERU_LOOKUP}/ruc/20131312955?token=t%20k`,
    );
    expect(await lookupApisperu('tk', 'DNI', '45678912')).toBeNull();
    expect(await lookupApisperu('tk', 'DNI', '45678912')).toBeNull();
  });
});
