import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BuyerInput, DocumentChoice } from './billing.models';
import {
  CounterSaleResult,
  PaymentInput,
  PendingClient,
  ReceiptTicket,
  SessionSummary,
} from './cash.models';
import { ChargeItemInput } from './visits.models';

/** Caja: sesiones con arqueo, cobros, venta de mostrador y egresos. */
@Injectable({ providedIn: 'root' })
export class CashService {
  private readonly http = inject(HttpClient);

  /** La sesión abierta, o null si la caja está cerrada. */
  current(): Observable<SessionSummary | null> {
    return this.http.get<SessionSummary | null>('/api/cash/sessions/current');
  }

  /** Historial de sesiones (la más reciente primero) */
  sessions(page = 1): Observable<{ items: { id: number; status: 'OPEN' | 'CLOSED' }[] }> {
    return this.http.get<{ items: { id: number; status: 'OPEN' | 'CLOSED' }[] }>(
      '/api/cash/sessions',
      { params: { page } },
    );
  }

  session(id: number): Observable<SessionSummary> {
    return this.http.get<SessionSummary>(`/api/cash/sessions/${id}`);
  }

  open(openingAmount: number): Observable<SessionSummary> {
    return this.http.post<SessionSummary>('/api/cash/sessions', { openingAmount });
  }

  close(id: number, countedCash: number, note: string | null): Observable<SessionSummary> {
    return this.http.post<SessionSummary>(`/api/cash/sessions/${id}/close`, { countedCash, note });
  }

  pending(): Observable<PendingClient[]> {
    return this.http.get<PendingClient[]>('/api/cash/pending');
  }

  collect(body: {
    requestKey: string;
    clientId: number;
    chargeIds?: number[];
    /** Productos o servicios agregados en caja (mismo comprobante) */
    items?: ChargeItemInput[];
    amount?: number;
    payments: PaymentInput[];
    document?: DocumentChoice;
    /** Datos del comprador escritos en el cobro */
    buyer?: BuyerInput;
  }): Observable<ReceiptTicket> {
    return this.http.post<ReceiptTicket>('/api/cash/receipts', body);
  }

  counterSale(body: {
    requestKey: string;
    clientId?: number;
    items: ChargeItemInput[];
    payments: PaymentInput[];
    document?: DocumentChoice;
    /** Datos del comprador escritos en el cobro */
    buyer?: BuyerInput;
  }): Observable<CounterSaleResult> {
    return this.http.post<CounterSaleResult>('/api/cash/counter-sales', body);
  }

  ticket(id: number): Observable<ReceiptTicket> {
    return this.http.get<ReceiptTicket>(`/api/cash/receipts/${id}`);
  }

  voidReceipt(id: number, reason: string, returnProducts = false): Observable<ReceiptTicket> {
    return this.http.post<ReceiptTicket>(`/api/cash/receipts/${id}/void`, {
      reason,
      ...(returnProducts ? { returnProducts: true } : {}),
    });
  }

  expense(amount: number, reason: string): Observable<SessionSummary> {
    return this.http.post<SessionSummary>('/api/cash/expenses', { amount, reason });
  }

  voidExpense(id: number, reason: string): Observable<SessionSummary> {
    return this.http.post<SessionSummary>(`/api/cash/expenses/${id}/void`, { reason });
  }
}
