import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Species } from './clients.models';
import { Appointment } from './appointments.models';
import { DueImmunization } from './medical.models';
import { QueueItem } from './queue.service';

export interface DashboardSummary {
  day: string;
  queue: {
    arrived: number;
    waiting: number;
    inProgress: number;
    urgent: number;
    done: number;
    items: QueueItem[];
  };
  clients: { active: number; newThisMonth: number };
  pets: { active: number };
  inventory: { expiring: number; lowStock: number };
  grooming?: { active: number; ready: number; delivered: number };
  /** Lo cobrado hoy (menos devoluciones) y cuántos cobros */
  /** total = neto; collected = lo cobrado; refunded = lo devuelto (se muestra aparte) */
  sales: { total: number; collected: number; refunded: number; receipts: number };
  recentClients: {
    id: number;
    name: string;
    createdAt: string;
    pets: { name: string; species: Species }[];
  }[];
  /** Citas de hoy (las de la agenda), sin las canceladas */
  appointments?: {
    total: number;
    pending: number;
    arrived: number;
    noShow: number;
    items: Appointment[];
  };
  /** Refuerzos de esta semana y vencidos (null para quien no llama a los dueños) */
  reminders?: { upcoming: number; overdue: number; items: DueImmunization[] } | null;
  /** Internados y dosis atrasadas (null para quien no atiende pacientes) */
  hospitalization?: { active: number; overdue: number } | null;
  /** Los mismos avisos de la campana */
  alerts?: HeaderAlert[];
}

/** Aviso de la campana (el backend ya filtra por rol y solo manda los que tienen algo) */
export interface HeaderAlert {
  kind:
    | 'urgent'
    | 'doses'
    | 'expiring'
    | 'lowStock'
    | 'shortage'
    | 'staleCash'
    | 'billing'
    | 'billingLate'
    | 'labReview'
    | 'labOverdue'
    | 'staleVisits'
    | 'staleGrooming';
  count: number;
  link: string;
  query?: Record<string, string>;
}

/** Resumen de la pantalla de inicio. */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  summary(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>('/api/dashboard');
  }

  alerts(): Observable<HeaderAlert[]> {
    return this.http.get<HeaderAlert[]>('/api/dashboard/alerts');
  }
}
