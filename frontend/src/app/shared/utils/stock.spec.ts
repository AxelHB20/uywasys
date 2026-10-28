import { expiryText, presentationWord, readableStock } from './stock';

const meloxicam = [
  { name: 'Caja x 100', factor: 100 },
  { name: 'Blíster x 10', factor: 10 },
  { name: 'Tableta', factor: 1 },
];

describe('stock legible', () => {
  it('desarma el stock en presentaciones, de la más grande a la más chica', () => {
    expect(readableStock(347, 'TABLET', meloxicam)).toBe('3 cajas, 4 blísteres y 7 tabletas');
    expect(readableStock(100, 'TABLET', meloxicam)).toBe('1 caja');
    expect(readableStock(1, 'TABLET', meloxicam)).toBe('1 tableta');
    expect(readableStock(0, 'TABLET', meloxicam)).toBe('Sin stock');
  });

  it('maneja ml con decimales', () => {
    expect(readableStock(25.5, 'ML', [{ name: 'Frasco x 10 ml', factor: 10 }])).toBe(
      '2 frascos y 5.5 ml',
    );
  });

  it('plurales en español', () => {
    expect(presentationWord('Bolsa 15 kg', 2)).toBe('bolsas');
    expect(presentationWord('Blíster x 10', 2)).toBe('blísteres');
    expect(presentationWord('Caja', 1)).toBe('caja');
  });

  it('textos del vencimiento', () => {
    expect(expiryText(-5)).toBe('Venció hace 5 días');
    expect(expiryText(0)).toBe('Vence hoy');
    expect(expiryText(20)).toBe('Vence en 20 días');
  });
});
