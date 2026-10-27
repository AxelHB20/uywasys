import { ValidateBy, ValidationOptions } from 'class-validator';

const RUC_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
/** Prefijos válidos: 10 persona natural, 15/16/17 casos especiales, 20 empresa. */
const RUC_PREFIXES = ['10', '15', '16', '17', '20'];

/** Valida un RUC peruano: 11 dígitos, prefijo válido y dígito verificador (módulo 11 de SUNAT). */
export function isValidRuc(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{11}$/.test(value)) return false;
  if (!RUC_PREFIXES.includes(value.slice(0, 2))) return false;
  const digits = value.split('').map(Number);
  const sum = RUC_WEIGHTS.reduce(
    (acc, weight, i) => acc + weight * digits[i],
    0,
  );
  const check = (11 - (sum % 11)) % 10;
  return check === digits[10];
}

export function IsRuc(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    { name: 'isRuc', validator: { validate: isValidRuc } },
    { message: 'El RUC no es válido: revisa los 11 dígitos', ...options },
  );
}
