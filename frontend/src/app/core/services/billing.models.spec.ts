import { documentOptions } from './billing.models';

const on = { enabled: true, provider: 'SIMULATED' as const, production: false, simulated: true };

describe('documentOptions', () => {
  it('sin facturación activa solo hay nota de venta', () => {
    expect(documentOptions(null, null, 50).map((o) => o.value)).toEqual(['NOTE']);
    expect(documentOptions({ ...on, enabled: false }, null, 50).map((o) => o.value)).toEqual([
      'NOTE',
    ]);
  });

  it('boleta y factura nunca se bloquean: lo que falta se escribe en el cobro', () => {
    const dni = documentOptions(on, { docType: 'DNI' }, 1200);
    expect(dni.find((o) => o.value === 'BOLETA')).toMatchObject({ disabled: false, hint: null });
    expect(dni.find((o) => o.value === 'FACTURA')).toMatchObject({ disabled: false });
    // Cliente varios con más de S/ 700: la boleta avisa que lleva DNI, pero se puede elegir
    const varios = documentOptions(on, { docType: null, walkIn: true }, 700.01);
    expect(varios.find((o) => o.value === 'BOLETA')).toMatchObject({
      disabled: false,
      hint: 'Más de S/ 700 la boleta lleva el DNI del comprador',
    });
    expect(
      documentOptions(on, { docType: null, walkIn: true }, 700).find((o) => o.value === 'BOLETA')!
        .hint,
    ).toBeNull();
  });
});
