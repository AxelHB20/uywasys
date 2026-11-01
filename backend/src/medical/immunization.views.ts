import { fromDbDate } from '../common/time/clinic-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ImmunizationKind } from '../generated/prisma/enums.js';

export const IMMUNIZATION_SELECT = {
  id: true,
  petId: true,
  visitId: true,
  kind: true,
  name: true,
  laboratory: true,
  batchNumber: true,
  appliedAt: true,
  nextDueAt: true,
  external: true,
  externalClinic: true,
  notes: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  appliedBy: { select: { id: true, fullName: true, licenseNumber: true } },
} satisfies Prisma.ImmunizationSelect;

type Row = Prisma.ImmunizationGetPayload<{
  select: typeof IMMUNIZATION_SELECT;
}>;

export interface ImmunizationView {
  id: number;
  petId: number;
  visitId: number | null;
  kind: ImmunizationKind;
  name: string;
  laboratory: string | null;
  batchNumber: string | null;
  /** AAAA-MM-DD */
  appliedAt: string;
  nextDueAt: string | null;
  external: boolean;
  externalClinic: string | null;
  notes: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  appliedBy: { id: number; fullName: string; licenseNumber: string | null };
}

export function toImmunizationView(row: Row): ImmunizationView {
  return {
    ...row,
    appliedAt: fromDbDate(row.appliedAt)!,
    nextDueAt: fromDbDate(row.nextDueAt),
  };
}
