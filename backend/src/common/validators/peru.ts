import {
  ValidateBy,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import type { DocumentType } from '../../generated/prisma/enums.js';
import { isValidRuc } from './ruc.js';

export const DOCUMENT_TYPES: DocumentType[] = ['DNI', 'CE', 'RUC', 'PASSPORT'];

/** Celular peruano: 9 dígitos y empieza con 9. */
export const MOBILE_REGEX = /^9\d{8}$/;
export const DNI_REGEX = /^\d{8}$/;

const DOCUMENT_ERRORS: Record<DocumentType, string> = {
  DNI: 'El DNI debe tener 8 dígitos',
  CE: 'El carné de extranjería debe tener entre 8 y 12 letras o números',
  RUC: 'El RUC no es válido: revisa los 11 dígitos',
  PASSPORT: 'El pasaporte debe tener entre 6 y 12 letras o números',
};

export function isValidDocument(type: DocumentType, number: string): boolean {
  switch (type) {
    case 'DNI':
      return DNI_REGEX.test(number);
    case 'CE':
      return /^[A-Z0-9]{8,12}$/.test(number);
    case 'RUC':
      return isValidRuc(number);
    case 'PASSPORT':
      return /^[A-Z0-9]{6,12}$/.test(number);
    default:
      return false;
  }
}

export function documentError(type: DocumentType): string {
  return DOCUMENT_ERRORS[type] ?? 'El número de documento no es válido';
}

/** Valida el número según el campo docType del mismo objeto. */
export function IsDocumentNumber(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDocumentNumber',
      validator: {
        validate: (value: unknown, args?: ValidationArguments) => {
          const type = docTypeOf(args);
          return (
            typeof value === 'string' && !!type && isValidDocument(type, value)
          );
        },
        defaultMessage: (args?: ValidationArguments) => {
          const type = docTypeOf(args);
          return type ? documentError(type) : 'Elige el tipo de documento';
        },
      },
    },
    options,
  );
}

/** Documento en mayúsculas y sin espacios ni guiones. */
export const toDocNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.replace(/[\s-]/g, '').toUpperCase() || null
    : value;

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/** Celular sin espacios: "987 654 321" → "987654321". */
export const toPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s/g, '') || null : value;

function docTypeOf(args?: ValidationArguments): DocumentType | undefined {
  return args ? (args.object as { docType?: DocumentType }).docType : undefined;
}
