import { Role } from '../auth/auth.models';
import { DayHours } from '../../shared/utils/opening-hours';
import { TicketDocument } from './billing.models';
import { BaseUnit } from './inventory.models';

/** Quienes manejan la caja (igual que el backend). */
export const CASH_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'CASHIER'];

export type PaymentMethod = 'CASH' | 'YAPE' | 'PLIN' | 'CARD' | 'TRANSFER';

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};
export const PAYMENT_METHODS = Object.keys(METHOD_LABELS) as PaymentMethod[];
/** Llevan código de operación (opcional: el dueño no siempre lo tiene) */
export const NEEDS_CODE: PaymentMethod[] = ['YAPE', 'PLIN', 'TRANSFER'];

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  tendered?: number | null;
  operationCode?: string | null;
}

export interface SessionSummary {
  id: number;
  status: 'OPEN' | 'CLOSED';
  register: { id: number; name: string };
  openingAmount: number;
  openedAt: string;
  openedBy: { id: number; fullName: string };
  closedAt: string | null;
  closedBy: { id: number; fullName: string } | null;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  closingNote: string | null;
  byMethod: {
    method: PaymentMethod;
    label: string;
    collected: number;
    refunded: number;
    net: number;
    /** Pagos que entraron por este medio */
    payments: number;
    /** Yape, Plin o transferencia sin código: revisar en la app al cerrar */
    withoutCode: number;
  }[];
  expenses: number;
  totals: { collected: number; refunded: number; net: number; receipts: number };
  receipts: {
    id: number;
    /** Nota de venta interna (NV-000123) */
    code: string;
    /** La boleta o factura electrónica de ese cobro, si se emitió */
    document: {
      type: 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';
      code: string;
      status: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'ERROR' | string;
    } | null;
    client: string;
    total: number;
    status: 'ACTIVE' | 'VOID';
    createdAt: string;
    createdBy: string;
    /** Cómo se pagó; dos o más medios = pago dividido */
    payments: { method: PaymentMethod; label: string; amount: number; hasCode: boolean }[];
  }[];
  movements: {
    id: number;
    kind: 'EXPENSE' | 'REFUND';
    method: PaymentMethod;
    amount: number;
    reason: string;
    receiptCode: string | null;
    createdAt: string;
    createdBy: string;
    voided: boolean;
  }[];
}

export type PendingSource = 'CONSULTATION' | 'GROOMING' | 'HOSPITALIZATION' | 'COUNTER';

export interface PendingClient {
  client: { id: number; number: number; name: string; phone: string };
  balance: number;
  charges: number;
  since: string;
  /** Último cargo: lo de hoy va arriba ("De hoy") */
  last: string;
  /** Mascotas de las atenciones con saldo */
  pets: string[];
  /** De dónde viene lo que debe */
  sources: PendingSource[];
}

export const PENDING_SOURCE_LABELS: Record<PendingSource, string> = {
  CONSULTATION: 'Consulta',
  GROOMING: 'Grooming',
  HOSPITALIZATION: 'Hospitalización',
  COUNTER: 'Mostrador',
};

export interface ReceiptTicket {
  id: number;
  number: number;
  code: string;
  status: 'ACTIVE' | 'VOID';
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  legend: string;
  /** Boleta o factura electrónica del cobro; null = nota de venta interna */
  document: TicketDocument | null;
  clinic: {
    name: string;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
    openingHours: DayHours[];
  };
  client: {
    id: number;
    number: number;
    name: string;
    docType: string | null;
    docNumber: string | null;
    walkIn: boolean;
  };
  cashier: string;
  register: string;
  lines: {
    chargeId: number;
    description: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
    paid: number;
    /** Producto vendido en caja: al anular se puede devolver al stock */
    returnable?: boolean;
  }[];
  totals: {
    taxed: number;
    exempt: number;
    unaffected: number;
    igv: number;
    lines: number;
    paid: number;
    change: number;
    balance: number;
  };
  payments: {
    method: PaymentMethod;
    label: string;
    amount: number;
    tendered: number | null;
    operationCode: string | null;
  }[];
}

export interface CounterSaleResult {
  receipt: ReceiptTicket;
  shortages: { product: string; baseUnit: BaseUnit; quantity: number }[];
}
