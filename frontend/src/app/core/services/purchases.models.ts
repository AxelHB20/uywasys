import { BaseUnit } from './inventory.models';

export type PurchaseDocType = 'FACTURA' | 'BOLETA' | 'GUIA' | 'OTRO';
export type PurchaseStatus = 'RECEIVED' | 'VOIDED';

export const DOC_TYPE_LABELS: Record<PurchaseDocType, string> = {
  FACTURA: 'Factura',
  BOLETA: 'Boleta',
  GUIA: 'Guía de remisión',
  OTRO: 'Nota de venta u otro',
};
export const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as PurchaseDocType[];

export interface Supplier {
  id: number;
  name: string;
  ruc: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  purchases: number;
  lastPurchaseAt: string | null;
  /** Comprado en el año: solo llega para el administrador */
  yearTotal?: number;
}

export interface SupplierInput {
  name: string;
  ruc: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active?: boolean;
}

export interface PurchaseSummary {
  id: number;
  number: number;
  code: string;
  supplier: { id: number; name: string; ruc: string | null };
  docType: PurchaseDocType;
  docNumber: string;
  issuedAt: string;
  createdAt: string;
  status: PurchaseStatus;
  lines: number;
  subtotal: number;
  igv: number;
  total: number;
  hasFile: boolean;
}

export interface PurchaseLineView {
  id: number;
  product: { id: number; name: string; baseUnit: BaseUnit; controlled: boolean };
  presentation: { id: number; name: string; factor: number };
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: number;
  igv: number;
  total: number;
  batch: {
    id: number;
    lotNumber: string | null;
    expiresAt: string | null;
    initialQuantity: number;
    quantity: number;
    unitCost: number | null;
  };
}

export interface PurchaseDetail extends PurchaseSummary {
  pricesIncludeIgv: boolean;
  notes: string | null;
  createdBy: { id: number; fullName: string };
  voidedAt: string | null;
  voidedBy: { id: number; fullName: string } | null;
  voidReason: string | null;
  file: { mime: string; size: number } | null;
  lineItems: PurchaseLineView[];
  canVoid: boolean;
  settledShortages?: number;
}

export interface PurchasePage {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Solo para el administrador */
  summary?: { count: number; subtotal: number; igv: number; total: number };
}

export interface PurchaseHeaderInput {
  supplierId: number;
  docType: PurchaseDocType;
  docNumber: string;
  issuedAt: string;
  notes: string | null;
}

export interface PurchaseLineInput {
  productId: number;
  presentationId: number;
  quantity: number;
  unitPrice: number;
  lotNumber: string | null;
  expiresAt: string | null;
}

export interface PurchaseInput extends PurchaseHeaderInput {
  pricesIncludeIgv: boolean;
  lines: PurchaseLineInput[];
  settleShortages?: boolean;
}

export interface PurchaseQuery {
  q?: string;
  supplierId?: number;
  from?: string;
  to?: string;
  status?: PurchaseStatus;
  page?: number;
}

export interface LastCost {
  /** Sin IGV, por unidad mínima */
  unitCost: number;
  supplier: string | null;
  receivedAt: string;
}

/** CO-00012 */
export const purchaseCode = (number: number) => `CO-${String(number).padStart(5, '0')}`;
