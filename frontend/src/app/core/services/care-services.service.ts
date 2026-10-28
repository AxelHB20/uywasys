import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CareService, CareServiceInput } from './inventory.models';

/** Catálogo de servicios con sus precios e insumos. */
@Injectable({ providedIn: 'root' })
export class CareServicesService {
  private readonly http = inject(HttpClient);

  list(status: 'active' | 'inactive' | 'all' = 'all'): Observable<CareService[]> {
    return this.http.get<CareService[]>('/api/care-services', { params: { status } });
  }

  create(service: CareServiceInput): Observable<CareService> {
    return this.http.post<CareService>('/api/care-services', service);
  }

  update(id: number, changes: Partial<CareServiceInput>): Observable<CareService> {
    return this.http.patch<CareService>(`/api/care-services/${id}`, changes);
  }
}
