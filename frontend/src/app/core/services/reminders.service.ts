import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AppointmentStatus } from './appointments.models';
import { Species } from './clients.models';
import { ReminderMark } from './medical.models';

/** Cita de mañana por avisar */
export interface TomorrowAppointment {
  id: number;
  startsAt: string;
  durationMin: number;
  type: string;
  reason: string | null;
  status: AppointmentStatus;
  vet: string | null;
  pet: { id: number; number: number; name: string; species: Species };
  client: { id: number; name: string; phone: string };
  reminded: ReminderMark[];
  autoNotice: boolean;
}

/** Avisos a los dueños: citas de mañana y marcar lo que ya se avisó por WhatsApp. */
@Injectable({ providedIn: 'root' })
export class RemindersService {
  private readonly http = inject(HttpClient);

  tomorrow(): Observable<TomorrowAppointment[]> {
    return this.http.get<TomorrowAppointment[]>('/api/reminders/appointments');
  }

  markSent(kind: 'VACCINE' | 'APPOINTMENT', targetId: number): Observable<ReminderMark[]> {
    return this.http.post<ReminderMark[]>('/api/reminders/sent', { kind, targetId });
  }
}
