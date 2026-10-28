import { isValidDocument, MOBILE_REGEX } from './peru.js';

describe('documentos peruanos', () => {
  it('DNI de 8 dígitos', () => {
    expect(isValidDocument('DNI', '45678912')).toBe(true);
    expect(isValidDocument('DNI', '4567891')).toBe(false);
  });

  it('carné de extranjería y pasaporte alfanuméricos', () => {
    expect(isValidDocument('CE', '001234567')).toBe(true);
    expect(isValidDocument('CE', '12345')).toBe(false);
    expect(isValidDocument('PASSPORT', 'AB123456')).toBe(true);
  });

  it('RUC con dígito verificador', () => {
    expect(isValidDocument('RUC', '20131312955')).toBe(true);
    expect(isValidDocument('RUC', '20131312956')).toBe(false);
  });

  it('celular de 9 dígitos que empieza con 9', () => {
    expect(MOBILE_REGEX.test('987654321')).toBe(true);
    expect(MOBILE_REGEX.test('887654321')).toBe(false);
    expect(MOBILE_REGEX.test('98765432')).toBe(false);
  });
});
