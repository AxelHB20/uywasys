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
  recentClients: {
    id: number;
    name: string;
    createdAt: string;
    pets: { name: string; species: Species }[];
  }[];
}

/** Resumen de la pantalla de inicio. */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  summary(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>('/api/dashboard');
  }
}
