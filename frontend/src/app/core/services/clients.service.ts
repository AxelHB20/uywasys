import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import {
  AuthorizedPerson,
  ClientDetail,
  ClientInput,
  ClientPage,
  ClientStatus,
  ConsentText,
  DocumentType,
  ImportPreview,
  ImportResult,
  NewClient,
  Pet,
  PetInput,
} from './clients.models';

export interface ClientQuery {
  q?: string;
  page?: number;
  status?: ClientStatus;
}

/** Clientes, sus mascotas y personas autorizadas. */
@Injectable({ providedIn: 'root' })
export class ClientsService {
  private readonly http = inject(HttpClient);
  /** El texto de consentimiento casi nunca cambia: se pide una vez por sesión. */
  private consent$?: Observable<ConsentText>;

  list(query: ClientQuery): Observable<ClientPage> {
    let params = new HttpParams();
    if (query.q) params = params.set('q', query.q);
    if (query.page && query.page > 1) params = params.set('page', query.page);
    if (query.status && query.status !== 'active') params = params.set('status', query.status);
    return this.http.get<ClientPage>('/api/clients', { params });
  }

  get(id: number): Observable<ClientDetail> {
    return this.http.get<ClientDetail>(`/api/clients/${id}`);
  }

  consentText(): Observable<ConsentText> {
    this.consent$ ??= this.http
      .get<ConsentText>('/api/clients/consent')
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.consent$;
  }

  lookup(
    docType: DocumentType,
    docNumber: string,
  ): Observable<{ client: { id: number; name: string; phone: string; active: boolean } | null }> {
    return this.http.get<{
      client: { id: number; name: string; phone: string; active: boolean } | null;
    }>('/api/clients/lookup', { params: { docType, docNumber } });
  }

  create(client: NewClient): Observable<ClientDetail> {
    return this.http.post<ClientDetail>('/api/clients', client);
  }

  update(
    id: number,
    changes: Partial<ClientInput> & { active?: boolean },
  ): Observable<ClientDetail> {
    return this.http.patch<ClientDetail>(`/api/clients/${id}`, changes);
  }

  addPet(clientId: number, pet: PetInput): Observable<Pet> {
    return this.http.post<Pet>(`/api/clients/${clientId}/pets`, pet);
  }

  updatePet(
    petId: number,
    changes: Partial<PetInput> & { deceasedAt?: string | null; active?: boolean },
  ): Observable<Pet> {
    return this.http.patch<Pet>(`/api/pets/${petId}`, changes);
  }

  addAuthorized(
    clientId: number,
    person: Omit<AuthorizedPerson, 'id'>,
  ): Observable<AuthorizedPerson> {
    return this.http.post<AuthorizedPerson>(`/api/clients/${clientId}/authorized`, person);
  }

  removeAuthorized(clientId: number, personId: number): Observable<void> {
    return this.http.delete<void>(`/api/clients/${clientId}/authorized/${personId}`);
  }

  // ── Importación desde Excel (solo administrador) ──
  importTemplate(): Observable<Blob> {
    return this.http.get('/api/clients/import/template', { responseType: 'blob' });
  }

  previewImport(file: File): Observable<ImportPreview> {
    const data = new FormData();
    data.append('file', file);
    return this.http.post<ImportPreview>('/api/clients/import/preview', data);
  }

  import(file: File): Observable<ImportResult> {
    const data = new FormData();
    data.append('consentDeclared', 'true');
    data.append('file', file);
    return this.http.post<ImportResult>('/api/clients/import', data);
  }
}
