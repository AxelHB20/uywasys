import { isValidRuc } from './ruc.js';

describe('isValidRuc', () => {
  it('acepta RUC reales con dígito verificador correcto', () => {
    expect(isValidRuc('20131312955')).toBe(true); // SUNAT
  });

  it('rechaza un dígito verificador incorrecto', () => {
    expect(isValidRuc('20131312956')).toBe(false);
  });

  it('rechaza prefijos inválidos, letras y largos distintos de 11', () => {
    expect(isValidRuc('30131312955')).toBe(false);
    expect(isValidRuc('2013131295A')).toBe(false);
    expect(isValidRuc('2013131295')).toBe(false);
    expect(isValidRuc(20131312955)).toBe(false);
  });
});
