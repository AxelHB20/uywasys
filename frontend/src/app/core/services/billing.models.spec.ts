import { documentOptions } from './billing.models';

const on = { enabled: true, provider: 'SIMULATED' as const, production: false, simulated: true };

describe('documentOptions', () => {
  it('sin facturación activa solo hay nota de venta', () => {
    expect(documentOptions(null, null, 50).map((o) => o.value)).toEqual(['NOTE']);
    expect(documentOptions({ ...on, enabled: false }, null, 50).map((o) => o.value)).toEqual([
      'NOTE',
    ]);
  });

  it('factura solo con RUC; boleta sin documento hasta S/ 700', () => {
    const dni = documentOptions(on, { docType: 'DNI' }, 1200);
    expect(dni.find((o) => o.value === 'BOLETA')!.disabled).toBe(false);
    expect(dni.find((o) => o.value === 'FACTURA')).toMatchObject({
      disabled: true,
      hint: 'La factura necesita un cliente con RUC',
    });
    expect(
      documentOptions(on, { docType: 'RUC' }, 50).find((o) => o.value === 'FACTURA')!.disabled,
    ).toBe(false);
    const varios = documentOptions(on, { docType: null, walkIn: true }, 700);
    expect(varios.find((o) => o.value === 'BOLETA')).toMatchObject({ disabled: true });
    expect(
      documentOptions(on, { docType: null, walkIn: true }, 699.9).find((o) => o.value === 'BOLETA')!
        .disabled,
    ).toBe(false);
  });
});
