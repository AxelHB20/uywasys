import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  BillingSettings,
  BillingSettingsInput,
  BillingStatus,
  BuyerInput,
  BuyerProposal,
  DocumentFilters,
  LookupResult,
  PrintDocument,
  DocumentPage,
  DocumentSummary,
} from './billing.models';

/** Facturación electrónica: configuración del PSE y comprobantes emitidos. */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);

  status(): Observable<BillingStatus> {
    return this.http.get<BillingStatus>('/api/billing/status');
  }

  settings(): Observable<BillingSettings> {
    return this.http.get<BillingSettings>('/api/billing/settings');
  }

  save(input: BillingSettingsInput): Observable<BillingSettings> {
    return this.http.put<BillingSettings>('/api/billing/settings', input);
  }

  /** Token nuevo del PSE: se prueba antes de guardar; si falla, queda el anterior */
  updateToken(apiToken: string): Observable<BillingSettings> {
    return this.http.put<BillingSettings>('/api/billing/settings/token', { apiToken });
  }

  /** Reenvía todos los que no se pudieron enviar */
  retryAll(): Observable<{ count: number }> {
    return this.http.post<{ count: number }>('/api/billing/documents/retry-all', {});
  }

  test(): Observable<{ ok: true; message: string }> {
    return this.http.post<{ ok: true; message: string }>('/api/billing/settings/test', {});
  }

  documents(filters: DocumentFilters): Observable<DocumentPage> {
    let params = new HttpParams();
    if (filters.status) params = params.set('status', filters.status);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.q?.trim()) params = params.set('q', filters.q.trim());
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.page && filters.page > 1) params = params.set('page', filters.page);
    return this.http.get<DocumentPage>('/api/billing/documents', { params });
  }

  retry(id: number): Observable<DocumentSummary> {
    return this.http.post<DocumentSummary>(`/api/billing/documents/${id}/retry`, {});
  }

  /** Datos de facturación que se proponen para el cliente; null si no tiene */
  buyer(clientId: number): Observable<BuyerProposal | null> {
    return this.http.get<BuyerProposal | null>(`/api/billing/buyer/${clientId}`);
  }

  /** Nombre de un RUC o DNI (lo que tiene la clínica o APISPERU); null = escribirlo a mano */
  lookup(type: 'RUC' | 'DNI', number: string): Observable<LookupResult | null> {
    return this.http.get<LookupResult | null>('/api/billing/lookup', {
      params: { type, number },
    });
  }

  /** Datos de la hoja A4 del comprobante */
  print(id: number): Observable<PrintDocument> {
    return this.http.get<PrintDocument>(`/api/billing/documents/${id}/print`);
  }

  /** Cambia una boleta por factura (nota de crédito + factura nueva) */
  toFactura(id: number, buyer: BuyerInput): Observable<{ id: number; code: string }> {
    return this.http.post<{ id: number; code: string }>(`/api/billing/documents/${id}/factura`, {
      buyer,
    });
  }

  /** Corrige un comprobante rechazado: otro del mismo tipo con el DNI, RUC o nombre corregido */
  reissue(id: number, buyer: BuyerInput): Observable<{ id: number; code: string }> {
    return this.http.post<{ id: number; code: string }>(`/api/billing/documents/${id}/reissue`, {
      buyer,
    });
  }

  /** Registro de ventas del periodo en Excel, para el contador */
  report(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/billing/report', {
      params: { from, to },
      responseType: 'blob',
    });
  }
}
