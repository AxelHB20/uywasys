import { prescriptionCode } from '../common/sequence/clinic-sequence.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ChargeStatus } from '../generated/prisma/enums.js';

const ITEM_SELECT = {
  id: true,
  position: true,
  productId: true,
  presentationId: true,
  drug: true,
  dose: true,
  route: true,
  frequency: true,
  duration: true,
  instructions: true,
  controlled: true,
  dispensedQuantity: true,
  presentation: { select: { name: true } },
  charge: { select: { id: true, status: true } },
} satisfies Prisma.PrescriptionItemSelect;

/** Lo que muestra la atención: la receta con sus medicamentos */
export const PRESCRIPTION_SUMMARY_SELECT = {
  id: true,
  number: true,
  visitId: true,
  notes: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  vet: { select: { id: true, fullName: true, licenseNumber: true } },
  items: { select: ITEM_SELECT, orderBy: { position: 'asc' } },
} satisfies Prisma.PrescriptionSelect;

type SummaryRow = Prisma.PrescriptionGetPayload<{
  select: typeof PRESCRIPTION_SUMMARY_SELECT;
}>;

export interface PrescriptionItemView {
  id: number;
  productId: number | null;
  presentationId: number | null;
  drug: string;
  dose: string;
  route: string | null;
  frequency: string;
  duration: string;
  instructions: string | null;
  controlled: boolean;
  /** Presentaciones entregadas en la clínica (con su cargo) */
  dispensedQuantity: number | null;
  presentation: string | null;
  charge: { id: number; status: ChargeStatus } | null;
}

export interface PrescriptionSummary {
  id: number;
  /** RX-00012 */
  code: string;
  visitId: number;
  notes: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  vet: { id: number; fullName: string; licenseNumber: string | null };
  items: PrescriptionItemView[];
}

export function toPrescriptionSummary(row: SummaryRow): PrescriptionSummary {
  const { number, items, ...rest } = row;
  return {
    ...rest,
    code: prescriptionCode(number),
    items: items.map(({ position: _position, presentation, ...item }) => ({
      ...item,
      dispensedQuantity:
        item.dispensedQuantity === null ? null : Number(item.dispensedQuantity),
      presentation: presentation?.name ?? null,
    })),
  };
}
