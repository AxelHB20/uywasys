import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Estimate, EstimateInput, EstimatePrint, EstimatesSummary } from './estimates.models';

/** Presupuestos. */
@Injectable({ providedIn: 'root' })
export class EstimatesService {
  private readonly http = inject(HttpClient);

  list(query: { status?: string; petId?: number; clientId?: number } = {}): Observable<Estimate[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== null && value !== '')
        params = params.set(key, String(value));
    return this.http.get<Estimate[]>('/api/estimates', { params });
  }

  summary(): Observable<EstimatesSummary> {
    return this.http.get<EstimatesSummary>('/api/estimates/summary');
  }

  get(id: number): Observable<EstimatePrint> {
    return this.http.get<EstimatePrint>(`/api/estimates/${id}`);
  }

  create(input: EstimateInput): Observable<EstimatePrint> {
    return this.http.post<EstimatePrint>('/api/estimates', input);
  }

  accept(id: number, note: string | null): Observable<EstimatePrint> {
    return this.http.post<EstimatePrint>(`/api/estimates/${id}/accept`, { note });
  }

  reject(id: number, note: string | null): Observable<EstimatePrint> {
    return this.http.post<EstimatePrint>(`/api/estimates/${id}/reject`, { note });
  }

  convert(id: number, visitId: number, prescriptionRef: string | null): Observable<EstimatePrint> {
    return this.http.post<EstimatePrint>(`/api/estimates/${id}/convert`, {
      visitId,
      prescriptionRef,
    });
  }
}
