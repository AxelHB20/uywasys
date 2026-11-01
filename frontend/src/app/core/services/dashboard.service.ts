import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Species } from './clients.models';
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
  sales: { total: number; receipts: number };
  recentClients: {
    id: number;
    name: string;
    createdAt: string;
    pets: { name: string; species: Species }[];
  }[];
}

/** Aviso de la campana (el backend ya filtra por rol y solo manda los que tienen algo) */
export interface HeaderAlert {
  kind: 'urgent' | 'expiring' | 'lowStock' | 'shortage' | 'staleCash' | 'billing';
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
