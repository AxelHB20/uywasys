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
}

export interface VisitSummary {
  id: number;
  type: 'CONSULTATION' | 'GROOMING';
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
}

export interface VisitPage {
  items: VisitSummary[];
  total: number;
  page: number;
  pageSize: number;
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
  receipts: {
    id: number;
    number: number;
    total: number;
    status: 'ACTIVE' | 'VOID';
    createdAt: string;
  }[];
}
