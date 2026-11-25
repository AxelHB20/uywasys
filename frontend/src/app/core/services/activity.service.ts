import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ActivityFilters, ActivityPage, ActivityReview } from './activity.models';

/** Bitácora de la clínica (solo administradores). */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly http = inject(HttpClient);

  list(filters: ActivityFilters): Observable<ActivityPage> {
    let params = new HttpParams();
    if (filters.area) params = params.set('area', filters.area);
    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.important) params = params.set('important', 'true');
    if (filters.kind) params = params.set('kind', filters.kind);
    if (filters.page && filters.page > 1) params = params.set('page', filters.page);
    return this.http.get<ActivityPage>('/api/activity', { params });
  }

  /** Cuántas cosas para revisar hay en los últimos 7 días, por grupo */
  review(): Observable<ActivityReview> {
    return this.http.get<ActivityReview>('/api/activity/review');
  }
}
