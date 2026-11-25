import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, of, switchMap } from 'rxjs';
import { prepareClinicalFile } from '../../shared/utils/image';
import { LabListQuery, LabOrder, LabOrderInput, LabOrderPage } from './lab.models';

/** Exámenes de laboratorio: pedido en la atención, muestra, resultado y revisión. */
@Injectable({ providedIn: 'root' })
export class LabService {
  private readonly http = inject(HttpClient);

  /** Exámenes de la clínica por pestaña, con búsqueda, lugar y "ver más" */
  list(query: LabListQuery): Observable<LabOrderPage> {
    let params = new HttpParams().set('status', query.status);
    if (query.q?.trim()) params = params.set('q', query.q.trim());
    if (query.destination) params = params.set('destination', query.destination);
    if (query.skip) params = params.set('skip', query.skip);
    if (query.take) params = params.set('take', query.take);
    return this.http.get<LabOrderPage>('/api/lab-orders', { params });
  }

  forVisit(visitId: number): Observable<LabOrder[]> {
    return this.http.get<LabOrder[]>(`/api/visits/${visitId}/lab-orders`);
  }

  create(visitId: number, input: LabOrderInput): Observable<LabOrder> {
    return this.http.post<LabOrder>(`/api/visits/${visitId}/lab-orders`, input);
  }

  sample(id: number): Observable<LabOrder> {
    return this.http.post<LabOrder>(`/api/lab-orders/${id}/sample`, {});
  }

  /** original = foto sin comprimir; si no, se achica antes de subir (el PDF va tal cual) */
  result(
    id: number,
    resultText: string | null,
    file: File | null,
    original = false,
  ): Observable<LabOrder> {
    const prepared: Observable<{ blob: Blob; name: string } | null> = file
      ? from(prepareClinicalFile(file, original))
      : of(null);
    return prepared.pipe(
      switchMap((f) => {
        const form = new FormData();
        if (resultText) form.append('resultText', resultText);
        if (f) form.append('file', f.blob, f.name);
        return this.http.post<LabOrder>(`/api/lab-orders/${id}/result`, form);
      }),
    );
  }

  review(id: number, interpretation: string): Observable<LabOrder> {
    return this.http.post<LabOrder>(`/api/lab-orders/${id}/review`, { interpretation });
  }

  notified(id: number): Observable<LabOrder> {
    return this.http.post<LabOrder>(`/api/lab-orders/${id}/notified`, {});
  }

  cancel(id: number, reason: string): Observable<LabOrder> {
    return this.http.post<LabOrder>(`/api/lab-orders/${id}/cancel`, { reason });
  }

  /** El archivo del resultado (adjunto de la historia) */
  fileUrl(attachmentId: number): string {
    return `/api/attachments/${attachmentId}/file`;
  }
}
