import { clinicLogoUrl } from '../auth/session-user.js';
import { groomingCode } from '../common/sequence/clinic-sequence.js';
import { fromDbDate } from '../common/time/clinic-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  ChargeStatus,
  GroomingStatus,
  GroomingTransport,
  PetSize,
  Species,
} from '../generated/prisma/enums.js';

export const GROOMING_STATUS_LABELS: Record<GroomingStatus, string> = {
  WAITING: 'En espera',
  BATHING: 'Baño',
  CUTTING: 'Corte',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

export const CARD_SELECT = {
  id: true,
  number: true,
  day: true,
  status: true,
  size: true,
  promisedAt: true,
  checkInAt: true,
  bathingAt: true,
  cuttingAt: true,
  readyAt: true,
  notifiedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  fleas: true,
  ticks: true,
  matting: true,
  aggressive: true,
  instructions: true,
  transport: true,
  visitId: true,
  pet: {
    select: {
      id: true,
      number: true,
      name: true,
      species: true,
      breed: true,
      allergies: true,
    },
  },
  client: { select: { id: true, name: true, phone: true } },
  groomer: { select: { id: true, fullName: true } },
  visit: {
    select: {
      queueEntryId: true,
      charges: {
        where: { status: { not: 'VOID' } },
        select: {
          id: true,
          description: true,
          quantity: true,
          total: true,
          paidAmount: true,
          status: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  },
} satisfies Prisma.GroomingSessionSelect;

export const DETAIL_SELECT = {
  ...CARD_SELECT,
  skinNotes: true,
  belongings: true,
  transportAddress: true,
  signerName: true,
  signature: true,
  pickedUpBy: true,
  pickedUpDocument: true,
  pickedUpRelation: true,
  cancelReason: true,
  createdBy: { select: { id: true, fullName: true } },
  deliveredBy: { select: { id: true, fullName: true } },
  cancelledBy: { select: { id: true, fullName: true } },
  client: {
    select: {
      id: true,
      name: true,
      phone: true,
      docType: true,
      docNumber: true,
    },
  },
  clinic: {
    select: {
      name: true,
      ruc: true,
      address: true,
      phone: true,
      logoMime: true,
      logoUpdatedAt: true,
    },
  },
} satisfies Prisma.GroomingSessionSelect;

type CardRow = Prisma.GroomingSessionGetPayload<{ select: typeof CARD_SELECT }>;
type DetailRow = Prisma.GroomingSessionGetPayload<{
  select: typeof DETAIL_SELECT;
}>;

export interface GroomingCard {
  id: number;
  /** GR-00012 */
  code: string;
  day: string;
  status: GroomingStatus;
  size: PetSize;
  promisedAt: Date | null;
  checkInAt: Date;
  bathingAt: Date | null;
  cuttingAt: Date | null;
  readyAt: Date | null;
  notifiedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  fleas: boolean;
  ticks: boolean;
  matting: boolean;
  aggressive: boolean;
  instructions: string | null;
  transport: GroomingTransport;
  visitId: number;
  queueEntryId: number | null;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    allergies: string | null;
  };
  client: { id: number; name: string; phone: string };
  groomer: { id: number; fullName: string } | null;
  services: {
    id: number;
    description: string;
    quantity: number;
    total: number;
    status: ChargeStatus;
  }[];
  /** Suma de los servicios vigentes */
  total: number;
  /** Lo que falta cobrar */
  pending: number;
}

export interface GroomingDetail extends Omit<GroomingCard, 'client'> {
  skinNotes: string | null;
  belongings: string | null;
  transportAddress: string | null;
  signerName: string | null;
  /** data:image/png;base64,… */
  signature: string | null;
  pickedUpBy: string | null;
  pickedUpDocument: string | null;
  pickedUpRelation: string | null;
  cancelReason: string | null;
  createdBy: { id: number; fullName: string };
  deliveredBy: { id: number; fullName: string } | null;
  cancelledBy: { id: number; fullName: string } | null;
  client: GroomingCard['client'] & {
    docType: string | null;
    docNumber: string | null;
  };
  clinic: {
    name: string;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toCard(row: CardRow): GroomingCard {
  const { visit, number, day, ...rest } = row;
  const services = visit.charges.map((c) => ({
    id: c.id,
    description: c.description,
    quantity: Number(c.quantity),
    total: Number(c.total),
    status: c.status,
  }));
  const pending = visit.charges
    .filter((c) => c.status === 'PENDING')
    .reduce((sum, c) => sum + Number(c.total) - Number(c.paidAmount), 0);
  return {
    ...rest,
    code: groomingCode(number),
    day: fromDbDate(day) ?? '',
    queueEntryId: visit.queueEntryId,
    services,
    total: round2(services.reduce((sum, s) => sum + s.total, 0)),
    pending: round2(pending),
  };
}

export function toDetail(row: DetailRow): GroomingDetail {
  const { clinic, signature, ...rest } = row;
  const card = toCard(row);
  return {
    ...rest,
    ...card,
    client: row.client,
    signature: signature
      ? `data:image/png;base64,${Buffer.from(signature).toString('base64')}`
      : null,
    clinic: {
      name: clinic.name,
      ruc: clinic.ruc,
      address: clinic.address,
      phone: clinic.phone,
      logoUrl: clinicLogoUrl(clinic),
    },
  };
}
