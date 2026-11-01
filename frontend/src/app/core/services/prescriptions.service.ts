import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { PrescriptionItemInput, PrescriptionPrint } from './medical.models';

/** Recetas médicas veterinarias. */
@Injectable({ providedIn: 'root' })
export class PrescriptionsService {
  private readonly http = inject(HttpClient);

  create(
    visitId: number,
    body: { notes: string | null; items: PrescriptionItemInput[] },
  ): Observable<PrescriptionPrint> {
    return this.http.post<PrescriptionPrint>(`/api/visits/${visitId}/prescriptions`, body);
  }

  get(id: number): Observable<PrescriptionPrint> {
    return this.http.get<PrescriptionPrint>(`/api/prescriptions/${id}`);
  }

  void(id: number, reason: string): Observable<PrescriptionPrint> {
    return this.http.post<PrescriptionPrint>(`/api/prescriptions/${id}/void`, { reason });
  }
}
