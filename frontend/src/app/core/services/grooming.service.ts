import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { TransportInput } from './queue.service';
import {
  BoardStatus,
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

  /** El dueño ya no puede volver: se agrega (o cambia o quita) la movilidad */
  changeTransport(id: number, input: TransportInput): Observable<GroomingDetail> {
    return this.http.patch<GroomingDetail>(`/api/grooming/${id}/transport`, input);
  }

  /** chargeTransport: ya fueron a recogerlo, la movilidad se cobra igual */
  cancel(id: number, reason: string, chargeTransport = false): Observable<GroomingDetail> {
    return this.http.post<GroomingDetail>(`/api/grooming/${id}/cancel`, {
      reason,
      ...(chargeTransport ? { chargeTransport } : {}),
    });
  }
}
