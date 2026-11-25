import { whatsappNumber } from './document-print.page';

describe('número de WhatsApp', () => {
  it('celular peruano: agrega 51; si ya lo tiene, lo deja', () => {
    expect(whatsappNumber('987 654 321')).toBe('51987654321');
    expect(whatsappNumber('+51 987654321')).toBe('51987654321');
    expect(whatsappNumber('51987654321')).toBe('51987654321');
  });

  it('extranjero con + y código de país', () => {
    expect(whatsappNumber('+1 305 555 0123')).toBe('13055550123');
  });

  it('vacío, fijo o incompleto no sirve', () => {
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber('123')).toBeNull();
    expect(whatsappNumber('01 4567890')).toBeNull();
    expect(whatsappNumber('98765432')).toBeNull();
    expect(whatsappNumber('+51 01 4567890')).toBeNull();
  });
});
