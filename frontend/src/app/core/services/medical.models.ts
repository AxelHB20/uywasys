import { Pet, Species } from './clients.models';

export type ImmunizationKind = 'VACCINE' | 'DEWORMING_INTERNAL' | 'DEWORMING_EXTERNAL';

export const IMMUNIZATION_KIND_LABELS: Record<ImmunizationKind, string> = {
  VACCINE: 'Vacuna',
  DEWORMING_INTERNAL: 'Desparasitación interna',
  DEWORMING_EXTERNAL: 'Antipulgas y garrapatas',
};

/** Etiqueta corta para tablas y el carnet */
export const IMMUNIZATION_KIND_SHORT: Record<ImmunizationKind, string> = {
  VACCINE: 'Vacuna',
  DEWORMING_INTERNAL: 'Interna',
  DEWORMING_EXTERNAL: 'Externa',
};

export interface Immunization {
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
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  appliedBy: { id: number; fullName: string; licenseNumber: string | null };
}

export interface ImmunizationInput {
  petId: number;
  visitId?: number;
  kind: ImmunizationKind;
  name: string;
  laboratory?: string | null;
  batchNumber?: string | null;
  appliedAt?: string;
  nextDueAt?: string | null;
  external?: boolean;
  externalClinic?: string | null;
  notes?: string | null;
}

export interface DueImmunization {
  id: number;
  kind: ImmunizationKind;
  name: string;
  appliedAt: string;
  nextDueAt: string;
  /** Negativo = vencido hace N días */
  daysLeft: number;
  pet: { id: number; number: number; name: string; species: Species };
  client: { id: number; name: string; phone: string };
}

/** Nombres frecuentes para autocompletar (cada clínica escribe los suyos) */
export const COMMON_IMMUNIZATIONS: Record<ImmunizationKind, string[]> = {
  VACCINE: [
    'Séxtuple',
    'Quíntuple',
    'Antirrábica',
    'Puppy (parvovirus + moquillo)',
    'KC (tos de las perreras)',
    'Triple felina',
    'Leucemia felina',
  ],
  DEWORMING_INTERNAL: ['Drontal Plus', 'Canicur', 'Milbemax', 'Endogard'],
  DEWORMING_EXTERNAL: ['Bravecto', 'NexGard', 'Simparica', 'Frontline', 'Revolution'],
};

/** Atajos para el próximo refuerzo, en días */
export const NEXT_DUE_SHORTCUTS: { label: string; days: number }[] = [
  { label: '21 días', days: 21 },
  { label: '1 mes', days: 30 },
  { label: '3 meses', days: 90 },
  { label: '6 meses', days: 182 },
  { label: '1 año', days: 365 },
];

/** Estado de un refuerzo para mostrarlo con color y texto */
export function dueState(
  nextDueAt: string | null,
  today: string,
): { label: string; tone: 'overdue' | 'soon' | 'ok' } | null {
  if (!nextDueAt) return null;
  const days = Math.round((Date.parse(nextDueAt) - Date.parse(today)) / 86_400_000);
  if (days < 0)
    return { label: `Vencida hace ${-days} ${-days === 1 ? 'día' : 'días'}`, tone: 'overdue' };
  if (days === 0) return { label: 'Toca hoy', tone: 'soon' };
  if (days <= 30) return { label: `En ${days} ${days === 1 ? 'día' : 'días'}`, tone: 'soon' };
  return { label: 'Al día', tone: 'ok' };
}

/** Suma días a AAAA-MM-DD */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Enlace de WhatsApp con el recordatorio escrito (gratis, sin la API oficial) */
export function reminderLink(item: DueImmunization, clinicName: string): string {
  const what =
    item.kind === 'VACCINE' ? `la vacuna ${item.name}` : `la desparasitación (${item.name})`;
  const [y, m, d] = item.nextDueAt.split('-');
  const when = item.daysLeft < 0 ? `le tocaba el ${d}/${m}/${y}` : `le toca el ${d}/${m}/${y}`;
  const text = `Hola, le escribimos de ${clinicName}. A ${item.pet.name} ${when} ${what}. ¿Le reservamos un horario?`;
  return `https://wa.me/51${item.client.phone}?text=${encodeURIComponent(text)}`;
}

/** Carnet imprimible y cabecera de la historia clínica */
export interface ImmunizationCard {
  clinic: { name: string; address: string | null; phone: string | null; logoUrl: string | null };
  pet: Pet & { client: { id: number; name: string; phone: string } };
  items: Immunization[];
}

// ── Recetas ──

export interface PrescriptionItem {
  id: number;
  productId: number | null;
  presentationId: number | null;
  drug: string;
  dose: string;
  route: string | null;
  frequency: string;
  duration: string;
  instructions: string | null;
  /** Producto controlado: la receta se retiene */
  controlled: boolean;
  dispensedQuantity: number | null;
  presentation: string | null;
  charge: { id: number; status: 'PENDING' | 'PAID' | 'VOID' } | null;
}

export interface PrescriptionSummary {
  id: number;
  /** RX-00012 */
  code: string;
  visitId: number;
  notes: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  vet: { id: number; fullName: string; licenseNumber: string | null };
  items: PrescriptionItem[];
}

export interface PrescriptionPrint extends PrescriptionSummary {
  clinic: { name: string; address: string | null; phone: string | null; logoUrl: string | null };
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    sex: 'MALE' | 'FEMALE' | null;
    birthDate: string | null;
    weightKg: number | null;
    allergies: string | null;
  };
  client: {
    id: number;
    name: string;
    phone: string;
    docType: string | null;
    docNumber: string | null;
  };
}

export interface PrescriptionItemInput {
  productId?: number;
  presentationId?: number;
  drug: string;
  dose: string;
  route?: string | null;
  frequency: string;
  duration: string;
  instructions?: string | null;
  dispenseQuantity?: number | null;
}

export const ROUTE_OPTIONS = [
  'Oral',
  'Subcutánea',
  'Intramuscular',
  'Intravenosa',
  'Tópica',
  'Ótica',
  'Oftálmica',
];
export const FREQUENCY_OPTIONS = [
  'Cada 8 horas',
  'Cada 12 horas',
  'Cada 24 horas',
  'Dosis única',
  'Según necesidad',
];
export const DURATION_OPTIONS = ['3 días', '5 días', '7 días', '10 días', '14 días', '1 mes'];

/** "1 tableta · oral · cada 12 horas · 5 días" */
export function posology(
  item: Pick<PrescriptionItem, 'dose' | 'route' | 'frequency' | 'duration'>,
): string {
  return [
    item.dose,
    item.route?.toLocaleLowerCase('es'),
    item.frequency.toLocaleLowerCase('es'),
    item.duration,
  ]
    .filter(Boolean)
    .join(' · ');
}
