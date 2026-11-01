import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DocumentChoice } from './billing.models';
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
    amount?: number;
    payments: PaymentInput[];
    document?: DocumentChoice;
  }): Observable<ReceiptTicket> {
    return this.http.post<ReceiptTicket>('/api/cash/receipts', body);
  }

  counterSale(body: {
    requestKey: string;
    clientId?: number;
    items: ChargeItemInput[];
    payments: PaymentInput[];
    document?: DocumentChoice;
  }): Observable<CounterSaleResult> {
    return this.http.post<CounterSaleResult>('/api/cash/counter-sales', body);
  }

  ticket(id: number): Observable<ReceiptTicket> {
    return this.http.get<ReceiptTicket>(`/api/cash/receipts/${id}`);
  }

  voidReceipt(id: number, reason: string): Observable<ReceiptTicket> {
    return this.http.post<ReceiptTicket>(`/api/cash/receipts/${id}/void`, { reason });
  }

  expense(amount: number, reason: string): Observable<SessionSummary> {
    return this.http.post<SessionSummary>('/api/cash/expenses', { amount, reason });
  }

  voidExpense(id: number, reason: string): Observable<SessionSummary> {
    return this.http.post<SessionSummary>(`/api/cash/expenses/${id}/void`, { reason });
  }
}
