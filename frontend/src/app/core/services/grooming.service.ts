import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  BoardStatus,
  CommissionReport,
  CheckInInput,
  DeliverInput,
  Groomer,
  GroomingCard,
  GroomingDetail,
} from './grooming.models';

/** Baño y peluquería: ingreso, tablero, entrega y cancelación. */
@Injectable({ providedIn: 'root' })
export class GroomingService {
  private readonly http = inject(HttpClient);

  board(day?: string): Observable<GroomingCard[]> {
    let params = new HttpParams();
    if (day) params = params.set('day', day);
    return this.http.get<GroomingCard[]>('/api/grooming', { params });
  }

  groomers(): Observable<Groomer[]> {
    return this.http.get<Groomer[]>('/api/grooming/groomers');
  }

  get(id: number): Observable<GroomingDetail> {
    return this.http.get<GroomingDetail>(`/api/grooming/${id}`);
  }

  forPet(petId: number): Observable<GroomingCard[]> {
    return this.http.get<GroomingCard[]>(`/api/pets/${petId}/grooming`);
  }

  checkIn(input: CheckInInput): Observable<GroomingDetail> {
    return this.http.post<GroomingDetail>('/api/grooming', input);
  }

  move(id: number, status: BoardStatus): Observable<GroomingCard> {
    return this.http.patch<GroomingCard>(`/api/grooming/${id}/status`, { status });
  }

  assign(id: number, groomerId: number | null): Observable<GroomingCard> {
    return this.http.patch<GroomingCard>(`/api/grooming/${id}/groomer`, { groomerId });
  }

  notify(id: number): Observable<GroomingCard> {
    return this.http.post<GroomingCard>(`/api/grooming/${id}/notify`, {});
  }

  deliver(id: number, input: DeliverInput): Observable<GroomingDetail> {
    return this.http.post<GroomingDetail>(`/api/grooming/${id}/deliver`, input);
  }

  commissions(from: string, to: string, groomerId?: number | null): Observable<CommissionReport> {
    return this.http.get<CommissionReport>('/api/grooming/commissions', {
      params: commissionParams(from, to, groomerId),
    });
  }

  commissionsExcel(from: string, to: string, groomerId?: number | null): Observable<Blob> {
    return this.http.get('/api/grooming/commissions/excel', {
      params: commissionParams(from, to, groomerId),
      responseType: 'blob',
    });
  }

  cancel(id: number, reason: string): Observable<GroomingDetail> {
    return this.http.post<GroomingDetail>(`/api/grooming/${id}/cancel`, { reason });
  }
}

function commissionParams(from: string, to: string, groomerId?: number | null): HttpParams {
  let params = new HttpParams().set('from', from).set('to', to);
  if (groomerId) params = params.set('groomerId', groomerId);
  return params;
}
