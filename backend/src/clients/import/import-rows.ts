import { normalizeSearch } from '../../common/text/search.js';
import {
  documentError,
  isValidDocument,
  MOBILE_REGEX,
} from '../../common/validators/peru.js';
import type {
  DocumentType,
  PetSex,
  Species,
} from '../../generated/prisma/enums.js';

/** Celdas ya convertidas a texto (o fecha) por el lector de Excel, por número de fila. */
export interface RawRow {
  row: number;
  values: Partial<Record<ImportField, string | Date>>;
}

export type ImportField =
  | 'docType'
  | 'docNumber'
  | 'name'
  | 'phone'
  | 'email'
  | 'address'
  | 'district'
  | 'petName'
  | 'species'
  | 'breed'
  | 'sex'
  | 'birthDate'
  | 'weightKg'
  | 'allergies'
  | 'neutered';

/** Encabezados de la plantilla, en orden. El lector los reconoce sin importar tildes ni mayúsculas. */
export const COLUMNS: {
  field: ImportField;
  header: string;
  required?: boolean;
  width: number;
}[] = [
  { field: 'docType', header: 'Tipo de documento', width: 18 },
  { field: 'docNumber', header: 'N.º de documento', width: 16 },
  {
    field: 'name',
    header: 'Nombres y apellidos o razón social',
    required: true,
    width: 34,
  },
  { field: 'phone', header: 'Celular', required: true, width: 13 },
  { field: 'email', header: 'Correo', width: 26 },
  { field: 'address', header: 'Dirección', width: 30 },
  { field: 'district', header: 'Distrito', width: 18 },
  { field: 'petName', header: 'Mascota', width: 16 },
  { field: 'species', header: 'Especie', width: 12 },
  { field: 'breed', header: 'Raza', width: 16 },
  { field: 'sex', header: 'Sexo', width: 10 },
  { field: 'birthDate', header: 'Fecha de nacimiento (AAAA-MM-DD)', width: 20 },
  { field: 'weightKg', header: 'Peso (kg)', width: 10 },
  { field: 'allergies', header: 'Alergias', width: 22 },
  { field: 'neutered', header: 'Esterilizado (Sí/No)', width: 14 },
];

/** Reconoce el campo de un encabezado: "N.º de documento" → docNumber */
export function fieldForHeader(header: string): ImportField | null {
  const h = normalizeSearch(header);
  if (!h) return null;
  for (const column of COLUMNS) {
    const expected = normalizeSearch(column.header);
    // "Fecha de nacimiento" o "Peso" a secas también valen
    const base = expected.split(' ').slice(0, 3).join(' ');
    if (
      h === expected ||
      h.startsWith(base) ||
      (h.length >= 4 && expected.startsWith(h))
    )
      return column.field;
  }
  if (h === 'nombre' || h === 'cliente' || h === 'razon social') return 'name';
  if (h === 'telefono' || h === 'celular') return 'phone';
  if (h === 'documento' || h === 'dni' || h === 'numero de documento')
    return 'docNumber';
  return null;
}

const DOC_TYPES: Record<string, DocumentType | null> = {
  dni: 'DNI',
  ce: 'CE',
  'carne de extranjeria': 'CE',
  'carnet de extranjeria': 'CE',
  ruc: 'RUC',
  pasaporte: 'PASSPORT',
  passport: 'PASSPORT',
  'sin documento': null,
  '': null,
};

const SPECIES: Record<string, Species> = {
  perro: 'DOG',
  perra: 'DOG',
  canino: 'DOG',
  gato: 'CAT',
  gata: 'CAT',
  felino: 'CAT',
  conejo: 'RABBIT',
  cuy: 'GUINEA_PIG',
  cobayo: 'GUINEA_PIG',
  ave: 'BIRD',
  loro: 'BIRD',
  pajaro: 'BIRD',
  reptil: 'REPTILE',
  tortuga: 'REPTILE',
  otro: 'OTHER',
};

const SEXES: Record<string, PetSex> = {
  macho: 'MALE',
  m: 'MALE',
  hembra: 'FEMALE',
  h: 'FEMALE',
  f: 'FEMALE',
};

export interface ImportClient {
  docType: DocumentType | null;
  docNumber: string | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  district: string | null;
}

export interface ImportPet {
  name: string;
  species: Species;
  breed: string | null;
  sex: PetSex | null;
  birthDate: string | null;
  weightKg: number | null;
  allergies: string | null;
  neutered: boolean;
}

export type RowStatus = 'ok' | 'exists' | 'error';

export interface ImportRow {
  row: number;
  /** Agrupa las filas del mismo cliente (varias mascotas = varias filas) */
  key: string;
  client: ImportClient;
  pet: ImportPet | null;
  status: RowStatus;
  errors: string[];
}

const text = (value: string | Date | undefined): string =>
  value instanceof Date ? '' : (value ?? '').toString().trim();

const optional = (
  value: string | Date | undefined,
  max: number,
): string | null => text(value).slice(0, max) || null;

function toDocNumber(type: DocumentType | null, raw: string): string {
  const value = raw.replace(/[\s.-]/g, '').toUpperCase();
  // Excel guarda los DNI como número y se come los ceros de la izquierda
  if (type === 'DNI' && /^\d{5,7}$/.test(value)) return value.padStart(8, '0');
  return value;
}

function toPhone(raw: string): string {
  const digits = raw.replace(/[\s()+-]/g, '');
  return digits.length === 11 && digits.startsWith('51')
    ? digits.slice(2)
    : digits;
}

type ParsedDate = { date: string | null; invalid: boolean };
const INVALID_DATE: ParsedDate = { date: null, invalid: true };

/** Acepta fecha de Excel, AAAA-MM-DD o DD/MM/AAAA. */
function toDate(value: string | Date | undefined): ParsedDate {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? INVALID_DATE
      : { date: value.toISOString().slice(0, 10), invalid: false };
  }
  const raw = text(value);
  if (!raw) return { date: null, invalid: false };
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match) return iso(+match[1], +match[2], +match[3]);
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (match) return iso(+match[3], +match[2], +match[1]);
  return INVALID_DATE;
}

function iso(y: number, m: number, d: number): ParsedDate {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return INVALID_DATE;
  return { date: date.toISOString().slice(0, 10), invalid: false };
}

/** Valida cada fila sin tocar la base de datos. `today` = AAAA-MM-DD de la clínica. */
export function validateRows(rows: RawRow[], today: string): ImportRow[] {
  const seen = new Map<string, { row: number; name: string; phone: string }>();
  const minYear = Number(today.slice(0, 4)) - 40;

  return rows.map(({ row, values }) => {
    const errors: string[] = [];

    const typeText = normalizeSearch(text(values.docType));
    const rawDoc = text(values.docNumber);
    let docType: DocumentType | null = null;
    if (typeText in DOC_TYPES) docType = DOC_TYPES[typeText];
    else
      errors.push(`Tipo de documento «${text(values.docType)}» no reconocido`);
    // Si dejaron el tipo vacío pero hay un número de 8 dígitos, es un DNI
    if (!docType && !typeText && /^\d{8}$/.test(rawDoc.replace(/\s/g, '')))
      docType = 'DNI';
    const docNumber = docType ? toDocNumber(docType, rawDoc) : null;
    if (docType && !docNumber) errors.push('Falta el número de documento');
    else if (docType && docNumber && !isValidDocument(docType, docNumber))
      errors.push(documentError(docType));
    if (!docType && rawDoc && typeText)
      errors.push('Elige el tipo de documento');

    const name = text(values.name).replace(/\s+/g, ' ').slice(0, 150);
    if (name.length < 3) errors.push('Falta el nombre del cliente');

    const phone = toPhone(text(values.phone));
    if (!phone) errors.push('Falta el celular');
    else if (!MOBILE_REGEX.test(phone))
      errors.push('El celular debe tener 9 dígitos y empezar con 9');

    const email = optional(values.email, 120)?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push('El correo no es válido');

    let pet: ImportPet | null = null;
    const petName = text(values.petName).slice(0, 60);
    if (petName) {
      const speciesText = normalizeSearch(text(values.species));
      const species = SPECIES[speciesText];
      if (!species)
        errors.push(
          speciesText
            ? `Especie «${text(values.species)}» no reconocida (usa Perro, Gato, Conejo, Cuy, Ave, Reptil u Otro)`
            : `Falta la especie de ${petName}`,
        );
      const sexText = normalizeSearch(text(values.sex));
      const sex = sexText ? SEXES[sexText] : null;
      if (sexText && !sex)
        errors.push(
          `Sexo «${text(values.sex)}» no reconocido (Macho o Hembra)`,
        );

      const { date: birth, invalid: badDate } = toDate(values.birthDate);
      if (badDate)
        errors.push('La fecha de nacimiento no es válida (usa AAAA-MM-DD)');
      else if (birth && (birth > today || Number(birth.slice(0, 4)) < minYear))
        errors.push('Revisa la fecha de nacimiento');

      const weightText = text(values.weightKg).replace(',', '.');
      const weight = weightText ? Number(weightText) : null;
      if (
        weight !== null &&
        (!Number.isFinite(weight) || weight <= 0 || weight >= 1000)
      )
        errors.push('El peso debe ser un número en kg (ej.: 12.5)');

      pet = {
        name: petName,
        species: species ?? 'OTHER',
        breed: optional(values.breed, 60),
        sex: sex ?? null,
        birthDate: birth,
        weightKg:
          weight !== null && Number.isFinite(weight)
            ? Math.round(weight * 100) / 100
            : null,
        allergies: optional(values.allergies, 300),
        neutered: ['si', 'x', '1', 'true', 'verdadero'].includes(
          normalizeSearch(text(values.neutered)),
        ),
      };
    } else if (text(values.species)) {
      errors.push('Falta el nombre de la mascota');
    }

    const key =
      docType && docNumber
        ? `${docType}:${docNumber}`
        : `sin-doc:${phone}:${normalizeSearch(name)}`;
    const first = seen.get(key);
    if (
      first &&
      (normalizeSearch(first.name) !== normalizeSearch(name) ||
        first.phone !== phone)
    )
      errors.push(
        `El mismo documento está en la fila ${first.row} con otro nombre o celular`,
      );
    if (!first && errors.length === 0) seen.set(key, { row, name, phone });

    return {
      row,
      key,
      client: {
        docType,
        docNumber,
        name,
        phone,
        email,
        address: optional(values.address, 200),
        district: optional(values.district, 60),
      },
      pet,
      status: errors.length ? 'error' : 'ok',
      errors,
    };
  });
}
