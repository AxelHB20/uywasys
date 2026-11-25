import type { IgvAffectation } from '../generated/prisma/enums.js';

export type DocumentKind = 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';

/** Una línea del comprobante tal como se emite (y se guarda como foto en el documento). */
export interface DocumentLine {
  /** Código interno: P12 (producto) o S4 (servicio) */
  code: string;
  description: string;
  /** Catálogo 03 de SUNAT: NIU unidades, ZZ servicios */
  unit: string;
  quantity: number;
  /** Valor unitario sin IGV (hasta 10 decimales, como texto para no perder precisión) */
  unitValue: string;
  /** Precio unitario con IGV */
  unitPrice: string;
  taxable: number;
  igv: number;
  total: number;
  affectation: IgvAffectation;
}

export interface DocumentTotals {
  taxed: number;
  exempt: number;
  unaffected: number;
  igv: number;
  total: number;
}

/** Lo que el proveedor necesita para emitir: no depende de Prisma. */
export interface OutgoingDocument {
  type: DocumentKind;
  series: string;
  number: number;
  /** AAAA-MM-DD, fecha de Lima */
  issueDate: string;
  clinicRuc: string | null;
  customer: {
    /** 1 DNI · 4 CE · 6 RUC · 7 pasaporte · - sin documento */
    docType: string;
    docNumber: string;
    name: string;
    address: string | null;
    /** El PSE le envía el PDF (si lo soporta) */
    email?: string | null;
  };
  totals: DocumentTotals;
  lines: DocumentLine[];
  /** Nota de crédito: el comprobante que anula */
  related?: {
    type: 'BOLETA' | 'FACTURA';
    series: string;
    number: number;
    /** AAAA-MM-DD del comprobante anulado (Mifact lo exige) */
    issueDate?: string;
  } | null;
  reason?: string | null;
}

export interface ProviderConfig {
  url: string | null;
  token: string | null;
  production: boolean;
  /** Datos del emisor que algunos PSE piden en cada comprobante (Mifact) */
  issuer?: {
    /** RUC de la clínica: con él se prueba la conexión (Mifact valida el token contra el RUC) */
    ruc?: string | null;
    legalName: string | null;
    fiscalAddress: string | null;
    ubigeo: string | null;
  };
}

export interface ProviderOutcome {
  /** ACCEPTED por SUNAT · SENT recibido por el PSE, falta SUNAT (boletas por resumen) · REJECTED por SUNAT */
  status: 'ACCEPTED' | 'SENT' | 'REJECTED';
  description?: string | null;
  hash?: string | null;
  qrText?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  cdrUrl?: string | null;
}

/** Fallo al hablar con el PSE. retryable = conviene reintentar (caída, tiempo agotado). */
/**
 * Qué falló del lado del PSE (no del comprobante):
 * - auth: el token o la ruta no sirven
 * - suspended: el PSE cortó el servicio (falta de pago)
 * - network: el PSE no respondió o tuvo un error suyo
 * Sin tipo: problema del propio comprobante (datos, duplicado…).
 */
export type ProviderErrorKind = 'auth' | 'suspended' | 'network';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly kind: ProviderErrorKind | null = null,
  ) {
    super(message);
  }
}

/** El tipo de un error cualquiera: lo que no es del PSE se toma como de red (fetch, timeout…) */
export function providerErrorKind(error: unknown): ProviderErrorKind | null {
  if (error instanceof ProviderError) return error.kind;
  return 'network';
}

export interface BillingProviderClient {
  send(doc: OutgoingDocument, config: ProviderConfig): Promise<ProviderOutcome>;
  /** Consulta el estado de un documento ya enviado (boletas que esperan el resumen diario). */
  query(
    doc: OutgoingDocument,
    config: ProviderConfig,
  ): Promise<ProviderOutcome>;
  /** Verifica la ruta y el token sin emitir nada. */
  check(config: ProviderConfig): Promise<void>;
}

/** Código SUNAT del tipo de comprobante (catálogo 01). */
export const SUNAT_TYPE: Record<DocumentKind, string> = {
  FACTURA: '01',
  BOLETA: '03',
  CREDIT_NOTE: '07',
};

export const documentCode = (series: string, number: number) =>
  `${series}-${String(number).padStart(8, '0')}`;
