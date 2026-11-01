import { Role } from '../auth/auth.models';

export type DocumentType = 'DNI' | 'CE' | 'RUC' | 'PASSPORT';
export type Species = 'DOG' | 'CAT' | 'RABBIT' | 'GUINEA_PIG' | 'BIRD' | 'REPTILE' | 'OTHER';
export type PetSex = 'MALE' | 'FEMALE';

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  DNI: 'DNI',
  CE: 'Carné de extranjería',
  RUC: 'RUC',
  PASSPORT: 'Pasaporte',
};

/** Etiqueta corta para listas y botones. */
export const DOCUMENT_SHORT: Record<DocumentType, string> = {
  DNI: 'DNI',
  CE: 'CE',
  RUC: 'RUC',
  PASSPORT: 'Pasaporte',
};

export const SPECIES_LABELS: Record<Species, string> = {
  DOG: 'Perro',
  CAT: 'Gato',
  RABBIT: 'Conejo',
  GUINEA_PIG: 'Cuy',
  BIRD: 'Ave',
  REPTILE: 'Reptil',
  OTHER: 'Otro',
};
export const SPECIES: Species[] = [
  'DOG',
  'CAT',
  'RABBIT',
  'GUINEA_PIG',
  'BIRD',
  'REPTILE',
  'OTHER',
];

export const SEX_LABELS: Record<PetSex, string> = { MALE: 'Macho', FEMALE: 'Hembra' };

/** Quienes registran y editan clientes, mascotas y la cola (igual que el backend). */
export const FRONT_DESK_ROLES: Role[] = ['ADMIN', 'VET', 'RECEPTION'];

export interface PetBadge {
  id: number;
  /** Correlativo de la clínica (HC-00045) */
  number: number;
  name: string;
  species: Species;
  aggressive: boolean;
  hasAllergies: boolean;
  active: boolean;
}

export interface ClientSummary {
  id: number;
  /** Correlativo de la clínica (C-00012) */
  number: number;
  /** Última atención terminada (AAAA-MM-DD) */
  lastVisit: string | null;
  docType: DocumentType | null;
  docNumber: string | null;
  name: string;
  phone: string;
  active: boolean;
  pets: PetBadge[];
}

export interface ClientPage {
  items: ClientSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Pet {
  id: number;
  /** Correlativo de la clínica (HC-00045) */
  number: number;
  clientId: number;
  name: string;
  species: Species;
  breed: string | null;
  sex: PetSex | null;
  neutered: boolean;
  birthDate: string | null;
  birthDateEstimated: boolean;
  weightKg: number | null;
  color: string | null;
  microchip: string | null;
  allergies: string | null;
  aggressive: boolean;
  aggressiveNote: string | null;
  notes: string | null;
  deceasedAt: string | null;
  active: boolean;
  /** Solo en la ficha: última atención terminada (AAAA-MM-DD) */
  lastVisit?: string | null;
}

export interface AuthorizedPerson {
  id: number;
  name: string;
  dni: string | null;
  phone: string | null;
  relation: string | null;
}

export interface ClientDetail {
  id: number;
  /** Correlativo de la clínica (C-00012) */
  number: number;
  docType: DocumentType | null;
  docNumber: string | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  district: string | null;
  notes: string | null;
  active: boolean;
  consentAt: string;
  consentVersion: string;
  consentChannel: string;
  marketingConsent: boolean;
  /** Ley 29733 (cancelación): sus datos personales se borraron en esta fecha */
  anonymizedAt: string | null;
  createdAt: string;
  pets: Pet[];
  authorized: AuthorizedPerson[];
}

export interface PetInput {
  name: string;
  species: Species;
  breed: string | null;
  sex: PetSex | null;
  neutered: boolean;
  birthDate: string | null;
  birthDateEstimated: boolean;
  weightKg: number | null;
  color: string | null;
  microchip: string | null;
  allergies: string | null;
  aggressive: boolean;
  aggressiveNote: string | null;
  notes: string | null;
}

export interface ClientInput {
  docType: DocumentType | null;
  docNumber: string | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  district: string | null;
  notes: string | null;
  marketingConsent: boolean;
}

export interface NewClient extends ClientInput {
  consent: true;
  pet?: PetInput;
}

export interface ConsentText {
  version: string;
  text: string;
  marketingText: string;
}

export type ClientStatus = 'active' | 'inactive' | 'all';

export type ImportRowStatus = 'ok' | 'exists' | 'error';

export interface ImportRow {
  row: number;
  key: string;
  client: { docType: DocumentType | null; docNumber: string | null; name: string; phone: string };
  pet: { name: string; species: Species } | null;
  status: ImportRowStatus;
  errors: string[];
}

export interface ImportPreview {
  rows: ImportRow[];
  summary: {
    rows: number;
    ok: number;
    exists: number;
    errors: number;
    clients: number;
    pets: number;
  };
}

export interface ImportResult {
  clients: number;
  pets: number;
  skipped: number;
  errors: number;
}
