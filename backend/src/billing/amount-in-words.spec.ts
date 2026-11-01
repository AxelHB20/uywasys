import { amountInWords } from './amount-in-words.js';

describe('amountInWords', () => {
  it.each([
    [0.5, 'SON: CERO CON 50/100 SOLES'],
    [1, 'SON: UNO CON 00/100 SOLES'],
    [15, 'SON: QUINCE CON 00/100 SOLES'],
    [21, 'SON: VEINTIUNO CON 00/100 SOLES'],
    [100, 'SON: CIEN CON 00/100 SOLES'],
    [125.5, 'SON: CIENTO VEINTICINCO CON 50/100 SOLES'],
    [384, 'SON: TRESCIENTOS OCHENTA Y CUATRO CON 00/100 SOLES'],
    [1000, 'SON: MIL CON 00/100 SOLES'],
    [21500.99, 'SON: VEINTIÚN MIL QUINIENTOS CON 99/100 SOLES'],
    [1_250_000, 'SON: UN MILLÓN DOSCIENTOS CINCUENTA MIL CON 00/100 SOLES'],
  ])('%s → %s', (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });
});
