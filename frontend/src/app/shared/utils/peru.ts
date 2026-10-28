import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { DocumentType } from '../../core/services/clients.models';
import { isValidRuc } from './validators';

/** Celular peruano: 9 dígitos y empieza con 9 (mismo criterio que el backend). */
export const MOBILE_PATTERN = /^9\d{8}$/;
export const DNI_PATTERN = /^\d{8}$/;

export function normalizeDocNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function normalizePhone(value: string): string {
  return value.replace(/\s/g, '');
}

export function isValidDocument(type: DocumentType, number: string): boolean {
  switch (type) {
    case 'DNI':
      return DNI_PATTERN.test(number);
    case 'CE':
      return /^[A-Z0-9]{8,12}$/.test(number);
    case 'RUC':
      return isValidRuc(number);
    case 'PASSPORT':
      return /^[A-Z0-9]{6,12}$/.test(number);
  }
}

export const DOCUMENT_HINTS: Record<DocumentType, string> = {
  DNI: '8 dígitos',
  CE: 'Entre 8 y 12 letras o números',
  RUC: '11 dígitos (empieza con 10 o 20)',
  PASSPORT: 'Entre 6 y 12 letras o números',
};

export const DOCUMENT_ERRORS: Record<DocumentType, string> = {
  DNI: 'El DNI debe tener 8 dígitos',
  CE: 'El carné debe tener entre 8 y 12 letras o números',
  RUC: 'El RUC no es válido: revisa los 11 dígitos',
  PASSPORT: 'El pasaporte debe tener entre 6 y 12 letras o números',
};

/** Valida el número contra el tipo que devuelve getType (el tipo vive en otro control). */
export function documentValidator(getType: () => DocumentType | null): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const type = getType();
    if (!type) return null;
    const value = normalizeDocNumber(String(control.value ?? ''));
    if (!value) return { required: true };
    return isValidDocument(type, value) ? null : { document: true };
  };
}

export const mobileValidator: ValidatorFn = (control) => {
  const value = normalizePhone(String(control.value ?? ''));
  if (!value) return null;
  return MOBILE_PATTERN.test(value) ? null : { mobile: true };
};

/** Enlace de WhatsApp para un celular peruano. */
export function whatsappLink(phone: string): string {
  return `https://wa.me/51${phone}`;
}

/** "987654321" → "987 654 321" */
export function formatPhone(phone: string): string {
  return phone.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
}
