import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ActivityFilters, ActivityPage } from './activity.models';

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
    if (filters.page && filters.page > 1) params = params.set('page', filters.page);
    return this.http.get<ActivityPage>('/api/activity', { params });
  }
}
