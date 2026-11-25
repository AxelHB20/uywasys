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
  /** A quién ya se avisó y por dónde */
  reminded: ReminderMark[];
  /** El dueño activó los avisos en su portal: le llega solo al celular */
  autoNotice: boolean;
}

export interface ReminderMark {
  channel: 'WHATSAPP' | 'PUSH';
  sentAt: string;
  /** null = aviso automático */
  by: string | null;
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
  pet: Pet & {
    client: {
      id: number;
      name: string;
      phone: string;
      address?: string | null;
      district?: string | null;
    };
  };
  items: Immunization[];
  /** Próxima cita que sigue en pie (servidores anteriores no la mandan) */
  nextAppointment?: {
    id: number;
    startsAt: string;
    type: 'CONSULTATION' | 'GROOMING' | 'HOSPITALIZATION';
    reason: string | null;
    vet: string | null;
  } | null;
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

/** Lo que hace falta entregar según la receta: dosis × tomas al día × días (null si no se puede saber) */
export function suggestedUnits(
  dose: string,
  frequency: string,
  duration: string,
): { perDose: number; perDay: number; days: number; total: number } | null {
  const d = dose.trim().replace(',', '.');
  const frac = d.match(/^(\d+)\s*\/\s*(\d+)/);
  const perDose = d.startsWith('½')
    ? 0.5
    : d.startsWith('¼')
      ? 0.25
      : frac
        ? Number(frac[1]) / Number(frac[2])
        : Number(d.match(/^\d+(\.\d+)?/)?.[0]);
  if (!(perDose > 0)) return null;
  const f = frequency.trim().toLocaleLowerCase('es');
  if (f.startsWith('dosis única'))
    return { perDose, perDay: 1, days: 1, total: Math.ceil(perDose) };
  const hours = f.match(/cada\s+(\d+)\s*h/);
  const times = f.match(/(\d+)\s*veces?\s+al\s+d[ií]a/);
  const perDay = hours
    ? 24 / Number(hours[1])
    : times
      ? Number(times[1])
      : /una vez al d[ií]a/.test(f)
        ? 1
        : 0;
  if (!(perDay > 0) || !Number.isInteger(perDay)) return null;
  const t = duration.trim().toLocaleLowerCase('es');
  const n = Number(t.match(/^\d+/)?.[0]);
  const days = !(n > 0)
    ? 0
    : /d[ií]a/.test(t)
      ? n
      : /semana/.test(t)
        ? n * 7
        : /mes/.test(t)
          ? n * 30
          : 0;
  if (!days) return null;
  return { perDose, perDay, days, total: Math.ceil(perDose * perDay * days) };
}

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
