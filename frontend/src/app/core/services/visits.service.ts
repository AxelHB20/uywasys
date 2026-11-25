import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Charge,
  ChargeItemInput,
  ClientAccount,
  CreatedCharges,
  VisitChanges,
  PetHistory,
  VisitContext,
  VisitDetail,
  VisitPage,
  VisitStatus,
  WeightPoint,
} from './visits.models';

/** Atenciones, cargos y cuenta del cliente. */
@Injectable({ providedIn: 'root' })
export class VisitsService {
  private readonly http = inject(HttpClient);

  list(query: {
    status?: VisitStatus;
    petId?: number;
    clientId?: number;
    page?: number;
    type?: 'CONSULTATION' | 'GROOMING';
    /** Mascota o dueño */
    q?: string;
    vetId?: number;
    /** AAAA-MM-DD */
    day?: string;
    /** Solo las abiertas desde días anteriores */
    stale?: boolean;
  }): Observable<VisitPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== null) params = params.set(key, String(value));
    return this.http.get<VisitPage>('/api/visits', { params });
  }

  /** Diagnósticos más usados por la clínica, para sugerir */
  diagnoses(): Observable<string[]> {
    return this.http.get<string[]>('/api/visits/diagnoses');
  }

  history(petId: number): Observable<PetHistory> {
    return this.http.get<PetHistory>(`/api/visits/pet/${petId}/history`);
  }

  weights(petId: number): Observable<WeightPoint[]> {
    return this.http.get<WeightPoint[]>(`/api/visits/pet/${petId}/weights`);
  }

  context(id: number): Observable<VisitContext> {
    return this.http.get<VisitContext>(`/api/visits/${id}/context`);
  }

  get(id: number): Observable<VisitDetail> {
    return this.http.get<VisitDetail>(`/api/visits/${id}`);
  }

  /** Abre una atención; desde la cola, la entrada pasa a "En atención". */
  open(petId: number, queueEntryId?: number): Observable<VisitDetail> {
    return this.http.post<VisitDetail>('/api/visits', { petId, queueEntryId });
  }

  update(id: number, changes: VisitChanges): Observable<VisitDetail> {
    return this.http.patch<VisitDetail>(`/api/visits/${id}`, changes);
  }

  close(id: number): Observable<VisitDetail> {
    return this.http.post<VisitDetail>(`/api/visits/${id}/close`, {});
  }

  cancel(id: number, reason: string): Observable<VisitDetail> {
    return this.http.post<VisitDetail>(`/api/visits/${id}/cancel`, { reason });
  }

  addAddendum(id: number, text: string): Observable<VisitDetail> {
    return this.http.post<VisitDetail>(`/api/visits/${id}/addenda`, { text });
  }

  addCharges(visitId: number, items: ChargeItemInput[]): Observable<CreatedCharges> {
    return this.http.post<CreatedCharges>('/api/charges', { visitId, items });
  }

  voidCharge(id: number, reason: string): Observable<Charge> {
    return this.http.post<Charge>(`/api/charges/${id}/void`, { reason });
  }

  account(clientId: number): Observable<ClientAccount> {
    return this.http.get<ClientAccount>(`/api/clients/${clientId}/account`);
  }

  /** Último precio de movilidad del cliente: se propone al marcarla */
  lastTransportPrice(clientId: number): Observable<{ price: number | null }> {
    return this.http.get<{ price: number | null }>(`/api/clients/${clientId}/transport-price`);
  }

  /** Caja: cambia el precio de la movilidad mientras no se cobre */
  changeTransportPrice(chargeId: number, price: number): Observable<Charge> {
    return this.http.patch<Charge>(`/api/charges/${chargeId}/transport-price`, { price });
  }
}
