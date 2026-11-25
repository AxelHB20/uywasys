import { HospitalizationStatus } from './hospitalization.models';
import { GroomingStatus, PetSize } from './grooming.models';
import { BaseUnit } from './inventory.models';
import { Species } from './clients.models';
import { Immunization, PrescriptionSummary } from './medical.models';

export type VisitStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type ChargeStatus = 'PENDING' | 'PAID' | 'VOID';

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  OPEN: 'En atención',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
};

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  PENDING: 'Por cobrar',
  PAID: 'Pagado',
  VOID: 'Quitado',
};

export interface Charge {
  id: number;
  kind: 'SERVICE' | 'PRODUCT';
  visitId: number | null;
  pet: { id: number; name: string } | null;
  careServiceId: number | null;
  productId: number | null;
  presentationId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  discountReason: string | null;
  igvAffectation: string;
  taxableAmount: number;
  igvAmount: number;
  total: number;
  paidAmount: number;
  balance: number;
  prescriptionRef: string | null;
  status: ChargeStatus;
  createdAt: string;
  createdBy: { id: number; fullName: string };
  voidedAt: string | null;
  voidReason: string | null;
  shortages: { product: string; baseUnit: BaseUnit; quantity: number; resolved: boolean }[];
  /** Movilidad: su precio se cambia en caja mientras no se cobre */
  transport?: boolean;
}

export interface VisitSummary {
  id: number;
  type: 'CONSULTATION' | 'GROOMING' | 'HOSPITALIZATION';
  status: VisitStatus;
  reason: string | null;
  weightKg: number | null;
  /** A del SOAP: lo que se ve en el historial */
  diagnosis: string | null;
  diagnosisDefinitive: boolean;
  openedAt: string;
  closedAt: string | null;
  queueEntryId: number | null;
  pet: { id: number; number: number; name: string; species: Species };
  client: { id: number; number: number; name: string };
  attendedBy: { id: number; fullName: string };
  total: number;
  /** Lo que falta cobrar (solo en la lista; puede faltar si el servidor es anterior) */
  pending?: number;
}

/** Contexto del paciente para el veterinario mientras atiende */
export interface VisitContext {
  previous: {
    id: number;
    type: VisitSummary['type'];
    openedAt: string;
    reason: string | null;
    diagnosis: string | null;
    attendedBy: string;
  } | null;
  previousWeight: { kg: number; at: string } | null;
  overdue: { name: string; kind: string; nextDueAt: string }[];
}

/** Campos de la consulta SOAP (S, O y A; el P va en notes) */
export interface SoapFields {
  anamnesis: string | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  capillaryRefillS: number | null;
  mucosa: string | null;
  hydration: string | null;
  bodyCondition: number | null;
  physicalExam: string | null;
  diagnosis: string | null;
  diagnosisDefinitive: boolean;
}

export interface VisitDetail extends Omit<VisitSummary, 'pet' | 'client'>, SoapFields {
  temperatureC: number | null;
  /** En consulta: el Plan (P). En grooming: notas del servicio */
  notes: string | null;
  cancelReason: string | null;
  closedBy: { id: number; fullName: string } | null;
  pet: VisitSummary['pet'] & {
    breed: string | null;
    sex: 'MALE' | 'FEMALE' | null;
    birthDate: string | null;
    weightKg: number | null;
    allergies: string | null;
    aggressive: boolean;
    aggressiveNote: string | null;
  };
  client: VisitSummary['client'] & { phone: string };
  charges: Charge[];
  addenda: {
    id: number;
    text: string;
    createdAt: string;
    author: { id: number; fullName: string };
  }[];
  immunizations: Immunization[];
  prescriptions: PrescriptionSummary[];
  /** Si es un servicio de grooming: se cierra al entregar desde el tablero */
  grooming: { id: number; number: number; status: GroomingStatus; size: PetSize } | null;
  /** Si es un internamiento: se maneja desde Hospitalización y se cierra al dar de alta */
  hospitalization: { id: number; number: number; status: HospitalizationStatus } | null;
}

export interface VisitPage {
  items: VisitSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Abiertas desde días anteriores (puede faltar si el servidor es anterior) */
  stale?: number;
  /** Las mismas por tipo, para avisar en la otra pestaña */
  staleByType?: { CONSULTATION: number; GROOMING: number };
  /** Abiertas en total, sin los filtros de búsqueda (pestaña "Abiertas") */
  open?: number;
}

export interface VisitChanges extends Partial<SoapFields> {
  reason?: string | null;
  weightKg?: number | null;
  temperatureC?: number | null;
  notes?: string | null;
}

export interface ChargeItemInput {
  careServiceId?: number;
  productId?: number;
  presentationId?: number;
  quantity: number;
  discount?: number;
  discountReason?: string | null;
  prescriptionRef?: string | null;
}

export interface CreatedCharges {
  charges: Charge[];
  shortages: { product: string; baseUnit: BaseUnit; quantity: number }[];
}

export interface ClientAccount {
  client: {
    id: number;
    number: number;
    name: string;
    phone: string;
    docType: string | null;
    docNumber: string | null;
  };
  pending: Charge[];
  pendingTotal: number;
  /** Mascotas con una atención abierta que ya tiene cargos (se cobra al cerrarla) */
  inProgress?: { visitId: number; petName: string }[];
  receipts: {
    id: number;
    number: number;
    total: number;
    status: 'ACTIVE' | 'VOID';
    createdAt: string;
  }[];
}

/** Una atención en la historia completa */
export interface VisitHistoryItem extends SoapFields {
  id: number;
  type: VisitSummary['type'];
  status: VisitStatus;
  openedAt: string;
  closedAt: string | null;
  reason: string | null;
  weightKg: number | null;
  temperatureC: number | null;
  notes: string | null;
  attendedBy: { id: number; fullName: string };
  addenda: VisitDetail['addenda'];
  immunizations: Immunization[];
  prescriptions: PrescriptionSummary[];
}

/** Historia clínica completa (para imprimir o derivar) */
export interface PetHistory {
  clinic: { name: string; address: string | null; phone: string | null; logoUrl: string | null };
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    sex: 'MALE' | 'FEMALE' | null;
    birthDate: string | null;
    allergies: string | null;
  };
  client: { id: number; name: string; phone: string };
  weights: WeightPoint[];
  visits: VisitHistoryItem[];
}

export interface WeightPoint {
  at: string;
  kg: number;
}
