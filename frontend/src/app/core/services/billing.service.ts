import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  BillingSettings,
  BillingSettingsInput,
  BillingStatus,
  DocumentFilters,
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

  test(): Observable<{ ok: true; message: string }> {
    return this.http.post<{ ok: true; message: string }>('/api/billing/settings/test', {});
  }

  documents(filters: DocumentFilters): Observable<DocumentPage> {
    let params = new HttpParams();
    if (filters.status) params = params.set('status', filters.status);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.page && filters.page > 1) params = params.set('page', filters.page);
    return this.http.get<DocumentPage>('/api/billing/documents', { params });
  }

  retry(id: number): Observable<DocumentSummary> {
    return this.http.post<DocumentSummary>(`/api/billing/documents/${id}/retry`, {});
  }

  /** Registro de ventas del periodo en Excel, para el contador */
  report(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/billing/report', {
      params: { from, to },
      responseType: 'blob',
    });
  }
}
