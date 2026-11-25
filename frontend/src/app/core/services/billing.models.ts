import { BadgeTone } from '../../shared/ui/badge/badge.component';

export type DocumentChoice = 'NOTE' | 'BOLETA' | 'FACTURA';
export type DocumentType = 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';
export type DocumentStatus = 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
export type BillingProvider = 'SIMULATED' | 'NUBEFACT' | 'LUCODE' | 'MIFACT';

export interface BillingStatus {
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  /** true = los comprobantes no van a SUNAT (demo) */
  simulated: boolean;
  /** false en producción: la simulación no se puede activar */
  simulationAllowed?: boolean;
}

export interface BillingSettings {
  /** false en producción: la opción de simulación no se ofrece */
  simulationAllowed?: boolean;
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  legalName: string | null;
  /** Domicilio fiscal y ubigeo: los pide Mifact */
  fiscalAddress: string | null;
  ubigeo: string | null;
  apiUrl: string | null;
  hasToken: boolean;
  /** Hay token de la consulta de RUC/DNI (APISPERU) */
  hasLookupToken: boolean;
  boletaSeries: string;
  facturaSeries: string;
  boletaCreditSeries: string;
  facturaCreditSeries: string;
  missing: string[];
  /** Cuándo se guardó el token actual (Mifact lo cambia cada ~6 meses) */
  tokenUpdatedAt?: string | null;
  /** Comprobantes por mes del plan (nulo = sin límite) y cuántos van este mes */
  monthlyQuota?: number | null;
  usedThisMonth?: number;
  /** Vencimientos del servicio, YYYY-MM-DD: se avisa 30 días antes */
  planExpiresOn?: string | null;
  domainExpiresOn?: string | null;
  serverExpiresOn?: string | null;
  /** Conexión con el PSE según la última revisión automática (nulo en simulación) */
  health?: {
    state: 'OK' | 'TOKEN' | 'SUSPENDED' | 'UNREACHABLE';
    checkedAt: string | null;
    since: string | null;
    error: string | null;
  } | null;
}

export type BillingSettingsInput = Omit<
  BillingSettings,
  'hasToken' | 'hasLookupToken' | 'missing' | 'health' | 'tokenUpdatedAt' | 'usedThisMonth'
> & {
  /** Solo para cambiarlo; null = se mantiene el guardado */
  apiToken: string | null;
  lookupToken?: string | null;
  clearLookupToken?: boolean;
};

/** Datos del comprador escritos en el cobro (factura sin RUC guardado, boleta de más de S/ 700). */
export interface BuyerInput {
  docType: 'RUC' | 'DNI';
  docNumber: string;
  name: string;
  address: string | null;
  email: string | null;
  /** Guardar en la ficha del cliente */
  save?: boolean;
}

/** Datos de facturación que el sistema propone para un cliente. */
export interface BuyerProposal {
  docNumber: string;
  name: string;
  address: string | null;
  email: string | null;
}

/** Resultado de buscar un RUC o DNI. LOCAL = ya estaba en la clínica. */
export interface LookupResult {
  name: string;
  address: string | null;
  status: string | null;
  condition: string | null;
  source: 'LOCAL' | 'APISPERU';
}

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
  /** La nota de crédito que la anuló (boletas y facturas) */
  annulledBy: { code: string; date: string } | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  cdrUrl: string | null;
  /** Rechazado ya resuelto: se emitió otro comprobante o se anuló el cobro */
  replacedAt: string | null;
}

export interface DocumentPage {
  items: DocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Con error o rechazados sin corregir, en toda la clínica */
  problems: number;
  /** Del periodo y la búsqueda (sin filtro de tipo ni estado); los rechazados no cuentan */
  summary: {
    boletas: { count: number; amount: number };
    facturas: { count: number; amount: number };
    creditNotes: { count: number; amount: number };
    annulled: number;
    net: number;
  };
}

export interface DocumentFilters {
  status?: DocumentStatus | 'PROBLEMS' | 'LATE' | 'ANNULLED' | null;
  q?: string | null;
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

/** Representación impresa A4 de un comprobante (también la nota de crédito) */
export interface PrintDocument {
  id: number;
  type: DocumentType;
  code: string;
  status: DocumentStatus;
  issueDate: string;
  issuedAt: string;
  simulated: boolean;
  clinic: {
    name: string;
    legalName: string | null;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    logo: string | null;
  };
  customer: { docType: string; docNumber: string; name: string; address: string | null };
  lines: {
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitValue: number;
    unitPrice: number;
    total: number;
    affectation: string;
  }[];
  totals: { taxed: number; exempt: number; unaffected: number; igv: number; total: number };
  amountInWords: string;
  hash: string | null;
  qrText: string | null;
  related: { type: DocumentType; code: string; issueDate: string } | null;
  reason: string | null;
  annulledBy: { code: string; status: DocumentStatus } | null;
  receiptCode: string | null;
  /** Celular del cliente (solo dentro del sistema, para WhatsApp) */
  contactPhone: string | null;
}

/** Título completo en la hoja A4 */
export const DOC_SHEET_TITLES: Record<DocumentType, string> = {
  BOLETA: 'Boleta de venta electrónica',
  FACTURA: 'Factura electrónica',
  CREDIT_NOTE: 'Nota de crédito electrónica',
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
  const boletaNeedsId = !hasDoc && total > BOLETA_ID_THRESHOLD;
  return [
    // Nunca se bloquean: lo que falte (DNI o RUC del comprador) se escribe en el mismo cobro
    {
      value: 'BOLETA',
      label: 'Boleta',
      disabled: false,
      hint: boletaNeedsId
        ? `Más de S/ ${BOLETA_ID_THRESHOLD} la boleta lleva el DNI del comprador`
        : null,
    },
    {
      value: 'FACTURA',
      label: 'Factura',
      disabled: false,
      hint: null,
    },
    {
      ...note,
      label: 'Solo nota de venta',
      hint: 'No es comprobante para SUNAT: toda venta debe llevar boleta o factura',
    },
  ];
}
