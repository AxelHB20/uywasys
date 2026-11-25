import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AdmitInput,
  DischargeInput,
  EntryInput,
  HospitalizationCard,
  HospitalizationDetail,
  OrderInput,
} from './hospitalization.models';

/** Hospitalización: internados, hoja de tratamiento y alta. */
@Injectable({ providedIn: 'root' })
export class HospitalizationService {
  private readonly http = inject(HttpClient);

  board(): Observable<HospitalizationCard[]> {
    return this.http.get<HospitalizationCard[]>('/api/hospitalizations');
  }

  get(id: number): Observable<HospitalizationDetail> {
    return this.http.get<HospitalizationDetail>(`/api/hospitalizations/${id}`);
  }

  admit(input: AdmitInput): Observable<HospitalizationDetail> {
    return this.http.post<HospitalizationDetail>('/api/hospitalizations', input);
  }

  update(
    id: number,
    input: { cage?: string | null; diagnosis?: string | null; vetId?: number; reason?: string },
  ): Observable<HospitalizationDetail> {
    return this.http.patch<HospitalizationDetail>(`/api/hospitalizations/${id}`, input);
  }

  addOrder(id: number, input: OrderInput): Observable<HospitalizationDetail> {
    return this.http.post<HospitalizationDetail>(`/api/hospitalizations/${id}/orders`, input);
  }

  stopOrder(id: number, orderId: number): Observable<HospitalizationDetail> {
    return this.http.post<HospitalizationDetail>(
      `/api/hospitalizations/${id}/orders/${orderId}/stop`,
      {},
    );
  }

  addEntry(id: number, input: EntryInput): Observable<HospitalizationDetail> {
    return this.http.post<HospitalizationDetail>(`/api/hospitalizations/${id}/entries`, input);
  }

  discharge(id: number, input: DischargeInput): Observable<HospitalizationDetail> {
    return this.http.post<HospitalizationDetail>(`/api/hospitalizations/${id}/discharge`, input);
  }
}
