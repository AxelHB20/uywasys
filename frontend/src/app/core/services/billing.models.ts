import { BadgeTone } from '../../shared/ui/badge/badge.component';

export type DocumentChoice = 'NOTE' | 'BOLETA' | 'FACTURA';
export type DocumentType = 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';
export type DocumentStatus = 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
export type BillingProvider = 'SIMULATED' | 'NUBEFACT';

export interface BillingStatus {
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  /** true = los comprobantes no van a SUNAT (demo) */
  simulated: boolean;
}

export interface BillingSettings {
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  legalName: string | null;
  apiUrl: string | null;
  hasToken: boolean;
  boletaSeries: string;
  facturaSeries: string;
  boletaCreditSeries: string;
  facturaCreditSeries: string;
  missing: string[];
}

export type BillingSettingsInput = Omit<BillingSettings, 'hasToken' | 'missing'> & {
  /** Solo para cambiarlo; null = se mantiene el guardado */
  apiToken: string | null;
};

export interface DocumentSummary {
  id: number;
  type: DocumentType;
  code: string;
  issueDate: string;
  customerDocType: string;
  customerDocNumber: string;
  customerName: string;
  total: number;
  status: DocumentStatus;
  provider: BillingProvider;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sunatDescription: string | null;
  receiptId: number | null;
  related: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  cdrUrl: string | null;
}

export interface DocumentPage {
  items: DocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Con error o rechazados, en toda la clínica */
  problems: number;
}

export interface DocumentFilters {
  status?: DocumentStatus | 'PROBLEMS' | null;
  type?: DocumentType | null;
  from?: string | null;
  to?: string | null;
  page?: number;
}

/** El comprobante tal como sale en el ticket. */
export interface TicketDocument {
  id: number;
  type: 'BOLETA' | 'FACTURA';
  code: string;
  status: DocumentStatus;
  issueDate: string;
  legalName: string | null;
  customer: { docType: string; docNumber: string; name: string; address: string | null };
  totals: { taxed: number; exempt: number; unaffected: number; igv: number; total: number };
  /** Las líneas tal como se emitieron (en un pago a cuenta, solo lo pagado) */
  lines: { description: string; quantity: number; unitPrice: number; total: number }[];
  amountInWords: string;
  hash: string | null;
  qrText: string | null;
  pdfUrl: string | null;
  simulated: boolean;
  creditNote: { code: string; status: DocumentStatus } | null;
}

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  BOLETA: 'Boleta',
  FACTURA: 'Factura',
  CREDIT_NOTE: 'Nota de crédito',
};

/** Título de la representación impresa */
export const DOC_TITLES: Record<'BOLETA' | 'FACTURA', string> = {
  BOLETA: 'Boleta de venta electrónica',
  FACTURA: 'Factura electrónica',
};

export const DOC_STATUS_LABELS: Record<DocumentStatus, string> = {
  PENDING: 'Por enviar',
  SENT: 'Esperando a SUNAT',
  ACCEPTED: 'Aceptado por SUNAT',
  REJECTED: 'Rechazado por SUNAT',
  ERROR: 'Error de envío',
};

/** En simulación nada llega a SUNAT: no se dice "aceptado por SUNAT" */
export function statusLabel(status: DocumentStatus, provider: BillingProvider): string {
  return provider === 'SIMULATED' && status === 'ACCEPTED' ? 'Simulado' : DOC_STATUS_LABELS[status];
}

export const DOC_STATUS_TONE: Record<DocumentStatus, BadgeTone> = {
  PENDING: 'neutral',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  ERROR: 'warning',
};

/** Catálogo 06: cómo se llama el documento del cliente en el ticket */
export const CUSTOMER_DOC_LABELS: Record<string, string> = {
  '1': 'DNI',
  '4': 'C.E.',
  '6': 'RUC',
  '7': 'Pasaporte',
};

/** Desde este total una boleta debe identificar al cliente */
export const BOLETA_ID_THRESHOLD = 700;

export interface DocumentOption {
  value: DocumentChoice;
  label: string;
  disabled: boolean;
  hint: string | null;
}

/** Comprobantes que se pueden emitir en un cobro, según el cliente y el monto. */
export function documentOptions(
  status: BillingStatus | null,
  client: { docType: string | null; walkIn?: boolean } | null,
  total: number,
): DocumentOption[] {
  const note: DocumentOption = {
    value: 'NOTE',
    label: 'Nota de venta',
    disabled: false,
    hint: null,
  };
  if (!status?.enabled) return [note];
  const hasDoc = !!client?.docType && !client.walkIn;
  const boletaNeedsId = !hasDoc && total >= BOLETA_ID_THRESHOLD;
  return [
    {
      value: 'BOLETA',
      label: 'Boleta',
      disabled: boletaNeedsId,
      hint: boletaNeedsId
        ? `Desde S/ ${BOLETA_ID_THRESHOLD} la boleta lleva el DNI del cliente`
        : null,
    },
    {
      value: 'FACTURA',
      label: 'Factura',
      disabled: client?.docType !== 'RUC',
      hint: client?.docType !== 'RUC' ? 'La factura necesita un cliente con RUC' : null,
    },
    note,
  ];
}
