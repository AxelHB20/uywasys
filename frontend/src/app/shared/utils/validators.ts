import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const RUC_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const RUC_PREFIXES = ['10', '15', '16', '17', '20'];

/** Mismo algoritmo que el backend (módulo 11 de SUNAT). */
export function isValidRuc(value: string): boolean {
  if (!/^\d{11}$/.test(value) || !RUC_PREFIXES.includes(value.slice(0, 2))) return false;
  const digits = value.split('').map(Number);
  const sum = RUC_WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  return (11 - (sum % 11)) % 10 === digits[10];
}

/** RUC opcional: vacío es válido; si se escribe algo, debe ser un RUC correcto. */
export const rucValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();
  return !value || isValidRuc(value) ? null : { ruc: true };
};

export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,100}$/;
export const PASSWORD_RULE = 'Al menos 8 caracteres, con letras y números';

/** Valida que dos campos del grupo coincidan (contraseña y su confirmación). */
export function matchFields(field: string, confirm: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const a = group.get(field)?.value;
    const b = group.get(confirm)?.value;
    return a && b && a !== b ? { mismatch: true } : null;
  };
}

/** Mensaje de error de la API, o uno genérico. */
export function apiErrorMessage(
  error: unknown,
  fallback = 'No se pudo completar la acción. Inténtalo de nuevo.',
): string {
  const body =
    (error as { error?: { message?: string; errors?: string[] }; status?: number } | null) ?? null;
  if (body?.status === 0)
    return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  return body?.error?.errors?.[0] ?? body?.error?.message ?? fallback;
}
