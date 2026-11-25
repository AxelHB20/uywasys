import { Species } from './clients.models';

export type EstimateStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED' | 'EXPIRED';

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  PENDING: 'Por responder',
  ACCEPTED: 'Aceptado',
  REJECTED: 'No aceptado',
  CONVERTED: 'Cargado',
  EXPIRED: 'Vencido',
};

/** Color del estado (mismo que usa la insignia) */
export const ESTIMATE_TONE: Record<
  EstimateStatus,
  'warning' | 'info' | 'success' | 'neutral' | 'danger'
> = {
  PENDING: 'warning',
  ACCEPTED: 'info',
  CONVERTED: 'success',
  REJECTED: 'neutral',
  EXPIRED: 'danger',
};

/** Indicadores de la bandeja */
export interface EstimatesSummary {
  pending: { count: number; amount: number };
  expiringSoon: number;
  accepted: { count: number; amount: number };
  convertedMonth: { count: number; amount: number };
  acceptance: { won: number; decided: number; rate: number | null };
}

/** Días entre hoy y la fecha de vigencia (ambas AAAA-MM-DD); negativo si ya pasó. */
export function daysUntil(day: string, today: string): number {
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

export type ValidityTone = 'urgent' | 'soon' | 'ok' | 'closed';

/** Cuánto le queda a un presupuesto por responder: "Vence hoy", "Vence en 2 días"… */
export function validityView(
  e: Pick<Estimate, 'status' | 'validUntil'>,
  today: string,
): { text: string; tone: ValidityTone } {
  const days = daysUntil(e.validUntil, today);
  if (e.status === 'EXPIRED' || (e.status === 'PENDING' && days < 0)) {
    const ago = Math.abs(days);
    return { text: ago <= 1 ? 'Venció ayer' : `Venció hace ${ago} días`, tone: 'closed' };
  }
  if (e.status !== 'PENDING') return { text: '', tone: 'closed' };
  if (days === 0) return { text: 'Vence hoy', tone: 'urgent' };
  if (days === 1) return { text: 'Vence mañana', tone: 'soon' };
  if (days <= 3) return { text: `Vence en ${days} días`, tone: 'soon' };
  return { text: `Quedan ${days} días`, tone: 'ok' };
}

export interface EstimateItem {
  id: number;
  careServiceId: number | null;
  productId: number | null;
  presentationId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  igvAffectation: 'TAXED' | 'EXEMPT' | 'UNAFFECTED';
  controlled: boolean;
}

export interface Estimate {
  id: number;
  /** PR-00012 */
  code: string;
  title: string;
  /** AAAA-MM-DD */
  validUntil: string;
  notes: string | null;
  status: EstimateStatus;
  total: number;
  taxable: number;
  igv: number;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  visitId: number | null;
  convertedAt: string | null;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    weightKg: number | null;
  };
  client: {
    id: number;
    name: string;
    phone: string;
    docType: string | null;
    docNumber: string | null;
  };
  createdBy: { id: number; fullName: string; licenseNumber: string | null };
  decidedBy: { id: number; fullName: string } | null;
  items: EstimateItem[];
}

export interface EstimatePrint extends Estimate {
  clinic: {
    name: string;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
}

export interface EstimateInput {
  petId: number;
  title: string;
  validDays: number;
  notes: string | null;
  items: {
    careServiceId?: number;
    productId?: number;
    presentationId?: number;
    quantity: number;
    discount?: number;
  }[];
}

/** Resumen para enviar por WhatsApp */
export function estimateMessage(
  e: Estimate,
  clinicName: string,
  money: (n: number) => string,
): string {
  const [y, m, d] = e.validUntil.split('-');
  const lines = e.items.map((i) => `• ${i.description}: ${money(i.total)}`).join('\n');
  return (
    `Hola, le enviamos el presupuesto ${e.code} de ${clinicName} para ${e.pet.name}: ${e.title}.\n\n` +
    `${lines}\n\nTotal: ${money(e.total)} (incluye IGV). Válido hasta el ${d}/${m}/${y}.`
  );
}
