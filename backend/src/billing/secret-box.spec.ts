import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const box = new SecretBox('una-clave-larga-de-prueba-123');

  it('cifra y descifra, y cada cifrado sale distinto', () => {
    const a = box.seal('token-del-pse');
    const b = box.seal('token-del-pse');
    expect(a).not.toBe(b);
    expect(a).not.toContain('token-del-pse');
    expect(box.open(a)).toBe('token-del-pse');
  });

  it('con otra clave no se puede abrir', () => {
    const sealed = box.seal('token-del-pse');
    expect(() =>
      new SecretBox('otra-clave-larga-distinta-456').open(sealed),
    ).toThrow();
  });
});
