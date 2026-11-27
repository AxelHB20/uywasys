import { parseExpiry } from './month-input.component';

describe('parseExpiry (vencimiento como en la caja)', () => {
  it('mes/año guarda el último día del mes', () => {
    expect(parseExpiry('08/2027')).toBe('2027-08-31');
    expect(parseExpiry('02/2028')).toBe('2028-02-29');
    expect(parseExpiry('11/27')).toBe('2027-11-30');
    expect(parseExpiry('3/2027')).toBe('2027-03-31');
  });

  it('acepta la fecha completa y rechaza lo que no es una fecha', () => {
    expect(parseExpiry('15/08/2027')).toBe('2027-08-15');
    expect(parseExpiry('31/02/2027')).toBe('');
    expect(parseExpiry('13/2027')).toBe('');
    expect(parseExpiry('08/')).toBe('');
    expect(parseExpiry('')).toBe('');
  });
});
