import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Species } from './clients.models';
import { GroomingTransport } from './grooming.models';

export type QueueStatus = 'ARRIVED' | 'WAITING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface QueueItem {
  id: number;
  day: string;
  type: 'CONSULTATION' | 'GROOMING';
  status: QueueStatus;
  urgent: boolean;
  reason: string | null;
  arrivedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    aggressive: boolean;
    allergies: string | null;
  };
  client: { id: number; number: number; name: string; phone: string };
  attendedBy: { id: number; fullName: string } | null;
  /** Atención abierta o cerrada que salió de esta entrada */
  visit: { id: number; status: 'OPEN' | 'CLOSED' } | null;
  transport: GroomingTransport;
  transportAddress: string | null;
  transportPrice: number | null;
  deliveredHomeAt: string | null;
  deliveredHomeBy: { id: number; fullName: string } | null;
  /** Atendido y falta llevarlo a su casa */
  homePending: boolean;
  /** Quedó internado: se lleva a casa al darle de alta */
  hospitalized: boolean;
}

/** Movilidad: recojo, entrega o ambos, con la dirección y el precio que pone recepción */
export interface TransportInput {
  transport: GroomingTransport;
  transportAddress: string | null;
  transportPrice: number | null;
}

export interface NewQueueEntry extends Partial<TransportInput> {
  petId: number;
  urgent: boolean;
  reason: string | null;
}

export interface QueueChanges extends Partial<TransportInput> {
  status?: QueueStatus;
  urgent?: boolean;
  reason?: string | null;
  /** Al cancelar: ya fueron a recogerlo, la movilidad se cobra igual */
  chargeTransport?: boolean;
}

/** Cola de atención del día. */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly http = inject(HttpClient);

  today(): Observable<{ day: string; items: QueueItem[] }> {
    return this.http.get<{ day: string; items: QueueItem[] }>('/api/queue');
  }

  update(id: number, changes: QueueChanges): Observable<QueueItem> {
    return this.http.patch<QueueItem>(`/api/queue/${id}`, changes);
  }

  add(entry: NewQueueEntry): Observable<QueueItem> {
    return this.http.post<QueueItem>('/api/queue', entry);
  }

  /** Consulta con entrega: ya se dejó en su casa */
  deliveredHome(id: number): Observable<QueueItem> {
    return this.http.post<QueueItem>(`/api/queue/${id}/delivered-home`, {});
  }
}
