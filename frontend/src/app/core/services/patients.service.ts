import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { PatientPage, PatientSort, PatientSpecies, PatientStatus } from './patients.models';

/** Historias clínicas: la lista de pacientes (la ficha de cada uno está en ClientsService). */
@Injectable({ providedIn: 'root' })
export class PatientsService {
  private readonly http = inject(HttpClient);

  list(query: {
    q?: string;
    status?: PatientStatus;
    species?: PatientSpecies;
    sort?: PatientSort;
    page?: number;
  }): Observable<PatientPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== '' && value !== null)
        params = params.set(key, String(value));
    return this.http.get<PatientPage>('/api/pets', { params });
  }
}
