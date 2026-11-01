import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AgendaStaff, Appointment, AppointmentInput } from './appointments.models';

/** Agenda de citas. */
@Injectable({ providedIn: 'root' })
export class AppointmentsService {
  private readonly http = inject(HttpClient);

  list(query: {
    from: string;
    to?: string;
    vetId?: number;
    petId?: number;
  }): Observable<Appointment[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== null) params = params.set(key, String(value));
    return this.http.get<Appointment[]>('/api/appointments', { params });
  }

  staff(): Observable<AgendaStaff[]> {
    return this.http.get<AgendaStaff[]>('/api/appointments/staff');
  }

  create(input: AppointmentInput): Observable<Appointment> {
    return this.http.post<Appointment>('/api/appointments', input);
  }

  update(id: number, input: Partial<AppointmentInput>): Observable<Appointment> {
    return this.http.patch<Appointment>(`/api/appointments/${id}`, input);
  }

  confirm(id: number): Observable<Appointment> {
    return this.http.post<Appointment>(`/api/appointments/${id}/confirm`, {});
  }

  arrive(id: number): Observable<Appointment> {
    return this.http.post<Appointment>(`/api/appointments/${id}/arrive`, {});
  }

  noShow(id: number): Observable<Appointment> {
    return this.http.post<Appointment>(`/api/appointments/${id}/no-show`, {});
  }

  cancel(id: number, reason: string): Observable<Appointment> {
    return this.http.post<Appointment>(`/api/appointments/${id}/cancel`, { reason });
  }
}
