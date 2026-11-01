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
/** Exigen código de operación */
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
  }[];
  expenses: number;
  totals: { collected: number; refunded: number; net: number; receipts: number };
  receipts: {
    id: number;
    code: string;
    client: string;
    total: number;
    status: 'ACTIVE' | 'VOID';
    createdAt: string;
    createdBy: string;
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

export interface PendingClient {
  client: { id: number; number: number; name: string; phone: string };
  balance: number;
  charges: number;
  since: string;
}

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
