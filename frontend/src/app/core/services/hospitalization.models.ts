import { vitalRange } from '../../shared/utils/vital-signs';
import { Species } from './clients.models';

export type HospitalizationStatus = 'ACTIVE' | 'DISCHARGED' | 'DECEASED';
export type HospOrderKind = 'MEDICATION' | 'FLUIDS' | 'FEEDING' | 'PROCEDURE' | 'MONITORING';
export type SlotState = 'GIVEN' | 'SKIPPED' | 'OVERDUE' | 'DUE' | 'PENDING';

export interface Vitals {
  at: string;
  temperatureC: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  weightKg: number | null;
  mucosa: string | null;
}

export interface HospitalizationCard {
  id: number;
  number: number;
  code: string;
  status: HospitalizationStatus;
  /** Alta voluntaria: el dueño lo retiró antes del alta médica */
  voluntary: boolean;
  cage: string | null;
  reason: string;
  diagnosis: string | null;
  admittedAt: string;
  dischargedAt: string | null;
  days: number;
  visitId: number;
  pet: {
    id: number;
    name: string;
    species: Species;
    breed: string | null;
    weightKg: number | null;
    allergies: string | null;
    aggressive: boolean;
  };
  client: { id: number; name: string; phone: string | null };
  vet: { id: number; fullName: string };
  activeOrders: number;
  overdue: number;
  due: number;
  next: { at: string; description: string } | null;
  lastVitals: Vitals | null;
}

export interface Slot {
  at: string;
  state: SlotState;
  doneAt: string | null;
}

export interface HospOrder {
  id: number;
  kind: HospOrderKind;
  description: string;
  dose: string | null;
  route: string | null;
  everyHours: number | null;
  startsAt: string;
  endsAt: string | null;
  stoppedAt: string | null;
  notes: string | null;
  active: boolean;
  createdBy: { id: number; fullName: string };
  slots: Slot[];
  /** Cobrar aparte (opcional) y cuánto ya está en la cuenta */
  bill: {
    careServiceId: number | null;
    productId: number | null;
    presentationId: number | null;
    description: string;
    unitPrice: number;
    alreadyCharged: number;
  } | null;
}

export interface HospEntry {
  id: number;
  kind: 'DOSE' | 'VITALS' | 'NOTE';
  at: string;
  order: { id: number; description: string } | null;
  scheduledAt: string | null;
  skipped: boolean;
  temperatureC: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  weightKg: number | null;
  mucosa: string | null;
  notes: string | null;
  by: { id: number; fullName: string };
}

export interface HospitalizationDetail extends HospitalizationCard {
  window: { from: string; to: string };
  orders: HospOrder[];
  entries: HospEntry[];
  vitals: Vitals[];
  account: { total: number; pending: number; lines: number };
  /** Recetas vigentes de la atención */
  prescriptions: number;
  dischargeNotes: string | null;
  daysCharged: number | null;
  dischargedBy: { id: number; fullName: string } | null;
  /** Vino a consulta con entrega a casa: al darle de alta se lo llevan */
  homeDelivery: {
    queueEntryId: number;
    transport: 'DROPOFF' | 'ROUND_TRIP';
    address: string | null;
    deliveredAt: string | null;
  } | null;
}

export interface AdmitInput {
  petId: number;
  fromVisitId?: number;
  vetId?: number;
  cage?: string | null;
  reason: string;
  diagnosis?: string | null;
}

export interface OrderInput {
  kind: HospOrderKind;
  description: string;
  dose?: string | null;
  route?: string | null;
  everyHours?: number | null;
  startsAt?: string;
  durationDays?: number | null;
  notes?: string | null;
  careServiceId?: number | null;
  productId?: number | null;
  presentationId?: number | null;
}

export interface EntryInput {
  kind: 'DOSE' | 'VITALS' | 'NOTE';
  orderId?: number;
  scheduledAt?: string;
  /** Dosis: hora real en que se dio */
  givenAt?: string;
  skipped?: boolean;
  temperatureC?: number | null;
  heartRate?: number | null;
  respiratoryRate?: number | null;
  weightKg?: number | null;
  mucosa?: string | null;
  notes?: string | null;
}

export interface DischargeInput {
  outcome: 'DISCHARGED' | 'VOLUNTARY' | 'DECEASED';
  careServiceId?: number | null;
  days?: number | null;
  notes?: string | null;
  /** Lo dado en la hoja que se cobra aparte */
  extras?: { orderId: number; quantity: number }[];
}

export const HOSP_STATUS_LABELS: Record<HospitalizationStatus, string> = {
  ACTIVE: 'Internado',
  DISCHARGED: 'De alta',
  DECEASED: 'Fallecido',
};

/** "De alta", "Alta voluntaria", "Fallecido" o "Internado" */
export function statusLabel(c: Pick<HospitalizationCard, 'status' | 'voluntary'>): string {
  return c.status === 'DISCHARGED' && c.voluntary
    ? 'Alta voluntaria'
    : HOSP_STATUS_LABELS[c.status];
}

export const ORDER_KIND_LABELS: Record<HospOrderKind, string> = {
  MEDICATION: 'Medicamento',
  FLUIDS: 'Fluidoterapia',
  FEEDING: 'Alimentación',
  PROCEDURE: 'Procedimiento',
  MONITORING: 'Control',
};

export const SLOT_LABELS: Record<SlotState, string> = {
  GIVEN: 'Dada',
  SKIPPED: 'Omitida',
  OVERDUE: 'Atrasada',
  DUE: 'Toca ahora',
  PENDING: 'Pendiente',
};

/** Frecuencias habituales (en horas) */
export const EVERY_HOURS_OPTIONS = [
  { value: null, label: 'Una sola vez' },
  { value: 1, label: 'Cada hora' },
  { value: 2, label: 'Cada 2 h' },
  { value: 4, label: 'Cada 4 h' },
  { value: 6, label: 'Cada 6 h' },
  { value: 8, label: 'Cada 8 h' },
  { value: 12, label: 'Cada 12 h' },
  { value: 24, label: 'Cada 24 h' },
] as const;

export const HOSP_ROUTES = ['IV', 'SC', 'IM', 'Oral', 'Tópica', 'Oftálmica', 'Ótica', 'Rectal'];

/** Fiebre o hipotermia según el rango de la especie (el mismo de la consulta) */
export function temperatureFlag(species: Species, t: number | null): 'high' | 'low' | null {
  if (t === null) return null;
  const [low, high] = vitalRange(species, 'temperatureC') ?? [37.5, 39.5];
  return t > high ? 'high' : t < low ? 'low' : null;
}

export function frequencyLabel(everyHours: number | null): string {
  if (!everyHours) return 'Una sola vez';
  return everyHours === 1 ? 'Cada hora' : `Cada ${everyHours} h`;
}

/** "J-2 · día 3" */
export function stayLabel(card: Pick<HospitalizationCard, 'days' | 'status'>): string {
  return card.status === 'ACTIVE'
    ? `Día ${card.days}`
    : `${card.days} ${card.days === 1 ? 'día' : 'días'}`;
}

const LIMA = 'America/Lima';
const clock = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: LIMA,
});
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: LIMA });
const weekday = new Intl.DateTimeFormat('es-PE', {
  weekday: 'short',
  day: 'numeric',
  timeZone: LIMA,
});

/** "14:00" en hora de Lima */
export function hourOf(iso: string): string {
  return clock.format(new Date(iso));
}

/** "hoy", "mañana", "ayer" o "lun 3" */
export function dayOf(iso: string, now = new Date()): string {
  const day = dayKey.format(new Date(iso));
  const today = dayKey.format(now);
  const shift = (d: number) => dayKey.format(new Date(now.getTime() + d * 86_400_000));
  if (day === today) return 'hoy';
  if (day === shift(1)) return 'mañana';
  if (day === shift(-1)) return 'ayer';
  return weekday.format(new Date(iso));
}

/** "hoy 14:00" (o solo la hora si es hoy y se pide corto) */
export function whenOf(iso: string, now = new Date()): string {
  const day = dayOf(iso, now);
  return day === 'hoy' ? hourOf(iso) : `${day} ${hourOf(iso)}`;
}

/** Minutos que faltan (negativo = pasó) */
export function minutesFrom(iso: string, now = new Date()): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
}

/** "en 25 min", "en 2 h", "hace 40 min" */
export function relativeTime(iso: string, now = new Date()): string {
  const m = minutesFrom(iso, now);
  const abs = Math.abs(m);
  const text = abs < 60 ? `${abs} min` : `${Math.round(abs / 60)} h`;
  if (abs < 2) return 'ahora';
  return m > 0 ? `en ${text}` : `hace ${text}`;
}
