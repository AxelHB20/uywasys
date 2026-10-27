import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const BCRYPT_ROUNDS = 12;

/** Regla de contraseñas: al menos 8 caracteres, con letras y números. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,100}$/;
export const PASSWORD_RULE_MESSAGE =
  'La contraseña debe tener al menos 8 caracteres, con letras y números';

/** Sin caracteres que se confunden al dictarlos o copiarlos (0/O, 1/l/I). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';

/** Clave temporal legible, por ejemplo "Kxtm-P7qr-9wHa". Siempre cumple la regla de contraseñas. */
export function generateTemporaryPassword(): string {
  const pool = ALPHABET + DIGITS;
  const chars = Array.from({ length: 12 }, () => pool[randomInt(pool.length)]);
  chars[randomInt(12)] = DIGITS[randomInt(DIGITS.length)];
  let letterIndex = randomInt(12);
  while (DIGITS.includes(chars[letterIndex]))
    letterIndex = (letterIndex + 1) % 12;
  chars[letterIndex] = ALPHABET[randomInt(ALPHABET.length)];
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
