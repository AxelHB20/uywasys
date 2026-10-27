import { PASSWORD_PATTERN, generateTemporaryPassword } from './passwords.js';

describe('generateTemporaryPassword', () => {
  it('genera claves legibles que cumplen la regla de contraseñas', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(
        /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/,
      );
      expect(password).toMatch(PASSWORD_PATTERN);
      expect(password).not.toMatch(/[01OolI]/);
    }
  });

  it('no repite claves', () => {
    const set = new Set(Array.from({ length: 100 }, generateTemporaryPassword));
    expect(set.size).toBe(100);
  });
});

describe('PASSWORD_PATTERN', () => {
  it('exige 8 caracteres con letras y números', () => {
    expect(PASSWORD_PATTERN.test('abc12345')).toBe(true);
    expect(PASSWORD_PATTERN.test('abcdefgh')).toBe(false);
    expect(PASSWORD_PATTERN.test('12345678')).toBe(false);
    expect(PASSWORD_PATTERN.test('ab12')).toBe(false);
  });
});
