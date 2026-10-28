import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Species } from './clients.models';

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
}

export interface NewQueueEntry {
  petId: number;
  urgent: boolean;
  reason: string | null;
}

export interface QueueChanges {
  status?: QueueStatus;
  urgent?: boolean;
  reason?: string | null;
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
}
