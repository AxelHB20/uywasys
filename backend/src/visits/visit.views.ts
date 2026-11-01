import type { Prisma } from '../generated/prisma/client.js';
import type {
  BaseUnit,
  ChargeKind,
  ChargeStatus,
  GroomingStatus,
  PetSize,
  Species,
  VisitStatus,
  VisitType,
} from '../generated/prisma/enums.js';

import {
  IMMUNIZATION_SELECT,
  toImmunizationView,
} from '../medical/immunization.views.js';
import type { ImmunizationView } from '../medical/immunization.views.js';
import {
  PRESCRIPTION_SUMMARY_SELECT,
  toPrescriptionSummary,
} from '../medical/prescription.views.js';
import type { PrescriptionSummary } from '../medical/prescription.views.js';

type Tx = Prisma.TransactionClient;

/** Montos como número (2 decimales) para la API; en la base siguen siendo Decimal. */
const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

// ── Cargos ──

export const CHARGE_SELECT = {
  id: true,
  kind: true,
  visitId: true,
  petId: true,
  careServiceId: true,
  productId: true,
  presentationId: true,
  description: true,
  quantity: true,
  unitPrice: true,
  discount: true,
  discountReason: true,
  igvAffectation: true,
  taxableAmount: true,
  igvAmount: true,
  total: true,
  paidAmount: true,
  prescriptionRef: true,
  status: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  createdBy: { select: { id: true, fullName: true } },
  pet: { select: { id: true, name: true } },
  shortages: {
    select: {
      quantity: true,
      resolvedAt: true,
      product: { select: { name: true, baseUnit: true } },
    },
  },
} satisfies Prisma.ChargeSelect;

type ChargeRow = Prisma.ChargeGetPayload<{ select: typeof CHARGE_SELECT }>;

export interface ChargeView {
  id: number;
  kind: ChargeKind;
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
  /** Lo cobrado de este cargo (pagos parciales) */
  paidAmount: number;
  /** Lo que falta cobrar (0 si está pagado o anulado) */
  balance: number;
  prescriptionRef: string | null;
  status: ChargeStatus;
  createdAt: Date;
  createdBy: { id: number; fullName: string };
  voidedAt: Date | null;
  voidReason: string | null;
  /** Insumos que se usaron sin stock registrado */
  shortages: {
    product: string;
    baseUnit: BaseUnit;
    quantity: number;
    resolved: boolean;
  }[];
}

export function toChargeView(row: ChargeRow): ChargeView {
  return {
    id: row.id,
    kind: row.kind,
    visitId: row.visitId,
    pet: row.pet,
    careServiceId: row.careServiceId,
    productId: row.productId,
    presentationId: row.presentationId,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    discount: Number(row.discount),
    discountReason: row.discountReason,
    igvAffectation: row.igvAffectation,
    taxableAmount: Number(row.taxableAmount),
    igvAmount: Number(row.igvAmount),
    total: Number(row.total),
    paidAmount: Number(row.paidAmount),
    balance:
      row.status === 'PENDING' ? Number(row.total.minus(row.paidAmount)) : 0,
    prescriptionRef: row.prescriptionRef,
    status: row.status,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    shortages: row.shortages.map((s) => ({
      product: s.product.name,
      baseUnit: s.product.baseUnit,
      quantity: Number(s.quantity),
      resolved: s.resolvedAt !== null,
    })),
  };
}

// ── Atenciones ──

export const VISIT_SUMMARY_SELECT = {
  id: true,
  type: true,
  status: true,
  reason: true,
  weightKg: true,
  diagnosis: true,
  diagnosisDefinitive: true,
  openedAt: true,
  closedAt: true,
  queueEntryId: true,
  pet: {
    select: { id: true, number: true, name: true, species: true },
  },
  client: { select: { id: true, number: true, name: true } },
  attendedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.VisitSelect;

export const VISIT_DETAIL_SELECT = {
  ...VISIT_SUMMARY_SELECT,
  temperatureC: true,
  notes: true,
  anamnesis: true,
  heartRate: true,
  respiratoryRate: true,
  capillaryRefillS: true,
  mucosa: true,
  hydration: true,
  bodyCondition: true,
  physicalExam: true,
  cancelReason: true,
  closedBy: { select: { id: true, fullName: true } },
  pet: {
    select: {
      id: true,
      number: true,
      name: true,
      species: true,
      breed: true,
      sex: true,
      birthDate: true,
      weightKg: true,
      allergies: true,
      aggressive: true,
      aggressiveNote: true,
    },
  },
  client: {
    select: { id: true, number: true, name: true, phone: true },
  },
  charges: { select: CHARGE_SELECT, orderBy: { id: 'asc' } },
  addenda: {
    select: {
      id: true,
      text: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
    },
    orderBy: { id: 'asc' },
  },
  immunizations: { select: IMMUNIZATION_SELECT, orderBy: { id: 'asc' } },
  prescriptions: {
    select: PRESCRIPTION_SUMMARY_SELECT,
    orderBy: { id: 'asc' },
  },
  grooming: { select: { id: true, number: true, status: true, size: true } },
} satisfies Prisma.VisitSelect;

type SummaryRow = Prisma.VisitGetPayload<{
  select: typeof VISIT_SUMMARY_SELECT;
}>;
type DetailRow = Prisma.VisitGetPayload<{
  select: typeof VISIT_DETAIL_SELECT;
}>;

export interface VisitSummary {
  id: number;
  type: VisitType;
  status: VisitStatus;
  reason: string | null;
  weightKg: number | null;
  /** A del SOAP: lo que se ve en el historial */
  diagnosis: string | null;
  diagnosisDefinitive: boolean;
  openedAt: Date;
  closedAt: Date | null;
  queueEntryId: number | null;
  pet: { id: number; number: number; name: string; species: Species };
  client: { id: number; number: number; name: string };
  attendedBy: { id: number; fullName: string };
  /** Suma de los cargos no anulados */
  total: number;
}

export interface VisitDetail extends Omit<VisitSummary, 'pet' | 'client'> {
  temperatureC: number | null;
  notes: string | null;
  anamnesis: string | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  capillaryRefillS: number | null;
  mucosa: string | null;
  hydration: string | null;
  bodyCondition: number | null;
  physicalExam: string | null;
  cancelReason: string | null;
  closedBy: { id: number; fullName: string } | null;
  pet: SummaryRow['pet'] & {
    breed: string | null;
    sex: string | null;
    birthDate: Date | null;
    weightKg: number | null;
    allergies: string | null;
    aggressive: boolean;
    aggressiveNote: string | null;
  };
  client: SummaryRow['client'] & { phone: string };
  charges: ChargeView[];
  addenda: {
    id: number;
    text: string;
    createdAt: Date;
    author: { id: number; fullName: string };
  }[];
  /** Vacunas y desparasitaciones aplicadas en esta atención (incluidas las anuladas) */
  immunizations: ImmunizationView[];
  /** Recetas emitidas en esta atención (incluidas las anuladas) */
  prescriptions: PrescriptionSummary[];
  /** Si es un servicio de grooming: se maneja desde el tablero y se cierra al entregar */
  grooming: {
    id: number;
    number: number;
    status: GroomingStatus;
    size: PetSize;
  } | null;
}

export function toVisitSummary(row: SummaryRow, total: number): VisitSummary {
  return { ...row, weightKg: num(row.weightKg), total };
}

export function toVisitDetail(row: DetailRow): VisitDetail {
  const charges = row.charges.map(toChargeView);
  return {
    ...row,
    weightKg: num(row.weightKg),
    temperatureC: num(row.temperatureC),
    capillaryRefillS: num(row.capillaryRefillS),
    pet: { ...row.pet, weightKg: num(row.pet.weightKg) },
    charges,
    immunizations: row.immunizations.map(toImmunizationView),
    prescriptions: row.prescriptions.map(toPrescriptionSummary),
    total: sumActive(charges),
  };
}

/** Total de los cargos que siguen vigentes (pendientes o pagados). */
export function sumActive(charges: { status: ChargeStatus; total: number }[]) {
  return (
    Math.round(
      charges
        .filter((c) => c.status !== 'VOID')
        .reduce((sum, c) => sum + c.total * 100, 0),
    ) / 100
  );
}

/**
 * Bloquea la fila de la atención hasta el fin de la transacción: agregar un cargo, cerrarla
 * o cancelarla se atienden uno detrás de otro.
 */
export async function lockVisit(
  tx: Tx,
  clinicId: number,
  id: number,
): Promise<{
  id: number;
  status: VisitStatus;
  pet_id: number;
  client_id: number;
  queue_entry_id: number | null;
} | null> {
  const rows = await tx.$queryRaw<
    {
      id: number;
      status: VisitStatus;
      pet_id: number;
      client_id: number;
      queue_entry_id: number | null;
    }[]
  >`SELECT id, status::text AS status, pet_id, client_id, queue_entry_id
    FROM visits WHERE id = ${id} AND clinic_id = ${clinicId} FOR UPDATE`;
  return rows[0] ?? null;
}
