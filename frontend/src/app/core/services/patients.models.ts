import { PetSex, Species } from './clients.models';

/** Activos: se atienden hoy. Inactivos: fallecidos o retirados (la historia se conserva). */
export type PatientStatus = 'ACTIVE' | 'INACTIVE';
export type PatientSpecies = 'DOG' | 'CAT' | 'OTHER';
export type PatientSort = 'RECENT' | 'NAME' | 'NUMBER';

/** Una fila de Historias clínicas */
export interface PatientRow {
  id: number;
  number: number;
  name: string;
  species: Species;
  breed: string | null;
  sex: PetSex | null;
  birthDate: string | null;
  birthDateEstimated: boolean;
  deceasedAt: string | null;
  /** false: retirado (por ejemplo, el dueño pidió cancelar sus datos) */
  active: boolean;
  allergies: string | null;
  aggressive: boolean;
  client: { id: number; name: string; phone: string };
  lastVisit: {
    id: number;
    type: 'CONSULTATION' | 'GROOMING' | 'HOSPITALIZATION';
    openedAt: string;
    diagnosis: string | null;
    reason: string | null;
    attendedBy: string;
  } | null;
  openVisit: { id: number; type: 'CONSULTATION' | 'GROOMING' | 'HOSPITALIZATION' } | null;
  overdue: number;
}

export interface PatientPage {
  items: PatientRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<PatientStatus, number>;
}
