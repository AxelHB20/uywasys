import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DueImmunization,
  Immunization,
  ImmunizationCard,
  ImmunizationInput,
} from './medical.models';

/** Vacunas y desparasitaciones (carnet y recordatorios). */
@Injectable({ providedIn: 'root' })
export class ImmunizationsService {
  private readonly http = inject(HttpClient);

  forPet(petId: number): Observable<Immunization[]> {
    return this.http.get<Immunization[]>(`/api/pets/${petId}/immunizations`);
  }

  card(petId: number): Observable<ImmunizationCard> {
    return this.http.get<ImmunizationCard>(`/api/pets/${petId}/immunization-card`);
  }

  create(input: ImmunizationInput): Observable<Immunization> {
    return this.http.post<Immunization>('/api/immunizations', input);
  }

  void(id: number, reason: string): Observable<Immunization> {
    return this.http.post<Immunization>(`/api/immunizations/${id}/void`, { reason });
  }

  due(status: 'overdue' | 'upcoming', days = 30): Observable<DueImmunization[]> {
    const params = new HttpParams().set('status', status).set('days', days);
    return this.http.get<DueImmunization[]>('/api/immunizations/due', { params });
  }
}
