import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';
import { prepareClinicalFile } from '../../shared/utils/image';
import {
  Attachment,
  AttachmentKind,
  ConsentDocument,
  ConsentInput,
  ConsentSummary,
  ConsentType,
} from './documents.models';

/** Adjuntos y consentimientos de la historia clínica. */
@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly http = inject(HttpClient);

  attachments(petId: number, visitId?: number): Observable<Attachment[]> {
    let params = new HttpParams();
    if (visitId) params = params.set('visitId', visitId);
    return this.http.get<Attachment[]>(`/api/pets/${petId}/attachments`, { params });
  }

  upload(
    petId: number,
    data: {
      file: File;
      kind: AttachmentKind;
      title: string;
      visitId?: number;
      /** true = sin comprimir (radiografía, microscopio) */
      original?: boolean;
    },
  ): Observable<Attachment> {
    // Las fotos se achican antes de subir (WebP ~0,35 MB); el PDF va tal cual
    return from(prepareClinicalFile(data.file, !!data.original)).pipe(
      switchMap(({ blob, name }) => {
        const form = new FormData();
        form.append('kind', data.kind);
        form.append('title', data.title);
        if (data.visitId) form.append('visitId', String(data.visitId));
        form.append('file', blob, name);
        return this.http.post<Attachment>(`/api/pets/${petId}/attachments`, form);
      }),
    );
  }

  voidAttachment(id: number, reason: string): Observable<Attachment> {
    return this.http.post<Attachment>(`/api/attachments/${id}/void`, { reason });
  }

  consents(petId: number): Observable<ConsentSummary[]> {
    return this.http.get<ConsentSummary[]>(`/api/pets/${petId}/consents`);
  }

  consent(id: number): Observable<ConsentDocument> {
    return this.http.get<ConsentDocument>(`/api/consents/${id}`);
  }

  template(
    type: ConsentType,
    petId: number,
    procedure: string,
  ): Observable<{ title: string; text: string }> {
    const params = new HttpParams()
      .set('type', type)
      .set('petId', petId)
      .set('procedure', procedure);
    return this.http.get<{ title: string; text: string }>('/api/consents/template', { params });
  }

  sign(input: ConsentInput): Observable<ConsentDocument> {
    return this.http.post<ConsentDocument>('/api/consents', input);
  }

  voidConsent(id: number, reason: string): Observable<ConsentDocument> {
    return this.http.post<ConsentDocument>(`/api/consents/${id}/void`, { reason });
  }
}
