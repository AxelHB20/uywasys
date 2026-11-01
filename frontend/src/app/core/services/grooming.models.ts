import { Species } from './clients.models';

export type PetSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'GIANT';
export type GroomingStatus =
  'WAITING' | 'BATHING' | 'CUTTING' | 'READY' | 'DELIVERED' | 'CANCELLED';
export type BoardStatus = 'WAITING' | 'BATHING' | 'CUTTING' | 'READY';
export type GroomingTransport = 'NONE' | 'PICKUP' | 'DROPOFF' | 'ROUND_TRIP';

export const PET_SIZES: PetSize[] = ['SMALL', 'MEDIUM', 'LARGE', 'GIANT'];

export const PET_SIZE_LABELS: Record<PetSize, string> = {
  SMALL: 'Pequeño',
  MEDIUM: 'Mediano',
  LARGE: 'Grande',
  GIANT: 'Gigante',
};

/** Referencia de peso para elegir el tamaño */
export const PET_SIZE_HINTS: Record<PetSize, string> = {
  SMALL: 'hasta 10 kg',
  MEDIUM: '10 a 25 kg',
  LARGE: '25 a 40 kg',
  GIANT: 'más de 40 kg',
};

export const BOARD_STATUSES: BoardStatus[] = ['WAITING', 'BATHING', 'CUTTING', 'READY'];

export const GROOMING_STATUS_LABELS: Record<GroomingStatus, string> = {
  WAITING: 'En espera',
  BATHING: 'Baño',
  CUTTING: 'Corte',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

export const TRANSPORT_LABELS: Record<GroomingTransport, string> = {
  NONE: 'Lo trae y lo recoge',
  PICKUP: 'Lo recogemos',
  DROPOFF: 'Lo llevamos',
  ROUND_TRIP: 'Recojo y entrega',
};

export interface GroomingCard {
  id: number;
  /** GR-00012 */
  code: string;
  day: string;
  status: GroomingStatus;
  size: PetSize;
  promisedAt: string | null;
  checkInAt: string;
  bathingAt: string | null;
  cuttingAt: string | null;
  readyAt: string | null;
  notifiedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
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
    status: 'PENDING' | 'PAID' | 'VOID';
  }[];
  total: number;
  pending: number;
}

export interface GroomingDetail extends Omit<GroomingCard, 'client'> {
  skinNotes: string | null;
  belongings: string | null;
  transportAddress: string | null;
  signerName: string | null;
  signature: string | null;
  pickedUpBy: string | null;
  pickedUpDocument: string | null;
  pickedUpRelation: string | null;
  cancelReason: string | null;
  createdBy: { id: number; fullName: string };
  deliveredBy: { id: number; fullName: string } | null;
  cancelledBy: { id: number; fullName: string } | null;
  client: GroomingCard['client'] & { docType: string | null; docNumber: string | null };
  clinic: {
    name: string;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
}

export interface Groomer {
  id: number;
  fullName: string;
}

export interface CheckInInput {
  petId: number;
  queueEntryId?: number;
  size: PetSize;
  groomerId: number | null;
  promisedAt: string | null;
  services: { careServiceId: number; quantity: number }[];
  fleas: boolean;
  ticks: boolean;
  matting: boolean;
  aggressive: boolean;
  skinNotes: string | null;
  belongings: string | null;
  instructions: string | null;
  transport: GroomingTransport;
  transportAddress: string | null;
  signerName: string | null;
  signature: string | null;
}

export interface DeliverInput {
  pickedUpBy: string;
  pickedUpDocument: string | null;
  pickedUpRelation: string;
}

/** Tamaño sugerido por el peso (los gatos y sin peso: pequeño) */
export function sizeForWeight(weightKg: number | null | undefined): PetSize {
  if (!weightKg || weightKg <= 10) return 'SMALL';
  if (weightKg <= 25) return 'MEDIUM';
  if (weightKg <= 40) return 'LARGE';
  return 'GIANT';
}

/** Precio de un servicio para un tamaño: el del tamaño si existe, o el base */
export function priceForSize(
  service: { price: number; sizePrices?: { size: PetSize; price: number }[] },
  size: PetSize,
): number {
  return service.sizePrices?.find((p) => p.size === size)?.price ?? service.price;
}

/** Avisos del checklist para mostrar en la tarjeta */
export function checklistFlags(
  c: Pick<GroomingCard, 'fleas' | 'ticks' | 'matting' | 'aggressive'>,
) {
  return [
    c.aggressive ? 'Agresivo' : null,
    c.fleas ? 'Pulgas' : null,
    c.ticks ? 'Garrapatas' : null,
    c.matting ? 'Nudos' : null,
  ].filter((x): x is string => x !== null);
}

/** Estados a los que se puede mover: adelante (saltando pasos) o uno atrás */
export function canMove(from: GroomingStatus, to: BoardStatus): boolean {
  const a = BOARD_STATUSES.indexOf(from as BoardStatus);
  const b = BOARD_STATUSES.indexOf(to);
  return a >= 0 && b !== a && b >= a - 1;
}

/** Siguiente estado del botón "Avanzar" */
export function nextStatus(from: GroomingStatus): BoardStatus | null {
  const i = BOARD_STATUSES.indexOf(from as BoardStatus);
  return i >= 0 && i < BOARD_STATUSES.length - 1 ? BOARD_STATUSES[i + 1] : null;
}

/** Celular peruano válido para WhatsApp: 9 dígitos que empiezan con 9 */
export function whatsappPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
  return /^9\d{8}$/.test(digits) ? `51${digits}` : null;
}

/** Aviso de "listo para recoger" por WhatsApp (enlace wa.me, sin costo) */
export function readyMessageLink(
  card: Pick<GroomingCard, 'pet' | 'client' | 'pending' | 'transport'>,
  clinicName: string,
): string | null {
  const phone = whatsappPhone(card.client.phone);
  if (!phone) return null;
  const first = card.client.name.split(' ')[0];
  const delivery = card.transport === 'DROPOFF' || card.transport === 'ROUND_TRIP';
  const lines = [
    `Hola ${first}, ${card.pet.name} ya está listo(a) en ${clinicName}.`,
    delivery ? 'En breve salimos a dejarlo(a).' : 'Ya puedes pasar a recogerlo(a).',
    card.pending > 0 ? `Total por pagar: S/ ${card.pending.toFixed(2)}.` : null,
    '¡Gracias por confiar en nosotros!',
  ].filter(Boolean);
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

// ── Comisiones ──

export interface CommissionLine {
  id: number;
  code: string;
  deliveredAt: string;
  groomer: { id: number; fullName: string } | null;
  pet: { id: number; name: string };
  client: { id: number; name: string };
  services: string;
  paid: number;
  pending: number;
  percent: number;
  commission: number;
}

export interface CommissionRow {
  groomer: { id: number; fullName: string } | null;
  currentPercent: number | null;
  services: number;
  paid: number;
  pending: number;
  commission: number;
}

export interface CommissionReport {
  from: string;
  to: string;
  rows: CommissionRow[];
  lines: CommissionLine[];
  totals: { services: number; paid: number; pending: number; commission: number };
}

export type CommissionPeriod = 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'custom';

export const COMMISSION_PERIOD_LABELS: Record<Exclude<CommissionPeriod, 'custom'>, string> = {
  week: 'Esta semana',
  lastWeek: 'Semana pasada',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
};

/** Rango [desde, hasta] (AAAA-MM-DD) de un período, con semanas de lunes a domingo */
export function periodRange(
  period: Exclude<CommissionPeriod, 'custom'>,
  today: string,
): { from: string; to: string } {
  const d = new Date(`${today}T12:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const shift = (x: Date, days: number) => new Date(x.getTime() + days * 86_400_000);
  const monday = shift(d, -((d.getUTCDay() + 6) % 7));
  switch (period) {
    case 'week':
      return { from: iso(monday), to: today };
    case 'lastWeek':
      return { from: iso(shift(monday, -7)), to: iso(shift(monday, -1)) };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12));
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));
      return { from: iso(first), to: iso(last) };
    }
  }
}
