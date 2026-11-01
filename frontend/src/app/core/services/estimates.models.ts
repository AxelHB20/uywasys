import { Species } from './clients.models';

export type EstimateStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED' | 'EXPIRED';

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  PENDING: 'Por responder',
  ACCEPTED: 'Aceptado',
  REJECTED: 'No aceptado',
  CONVERTED: 'Cargado',
  EXPIRED: 'Vencido',
};

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
