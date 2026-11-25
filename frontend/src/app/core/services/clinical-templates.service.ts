import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type TemplateKind = 'CONSULTATION' | 'PRESCRIPTION';

/** Lo que deja escrito una plantilla de consulta (solo los campos con texto) */
export interface ConsultationContent {
  reason?: string | null;
  anamnesis?: string | null;
  physicalExam?: string | null;
  diagnosis?: string | null;
  plan?: string | null;
}

export interface TemplateRxItem {
  productId?: number | null;
  presentationId?: number | null;
  drug: string;
  dose: string;
  route?: string | null;
  frequency: string;
  duration: string;
  instructions?: string | null;
  dispenseQuantity?: number | null;
}

export interface PrescriptionContent {
  notes?: string | null;
  items: TemplateRxItem[];
}

export interface ClinicalTemplate {
  id: number;
  kind: TemplateKind;
  name: string;
  consultation: ConsultationContent | null;
  prescription: PrescriptionContent | null;
  usageCount: number;
  createdBy: { id: number; fullName: string };
  updatedAt: string;
}

export interface TemplateInput {
  kind: TemplateKind;
  name: string;
  consultation?: ConsultationContent;
  prescription?: PrescriptionContent;
}

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  CONSULTATION: 'Consultas',
  PRESCRIPTION: 'Recetas frecuentes',
};

export const CONSULTATION_FIELDS: { key: keyof ConsultationContent; label: string }[] = [
  { key: 'reason', label: 'Motivo' },
  { key: 'anamnesis', label: 'Anamnesis (S)' },
  { key: 'physicalExam', label: 'Examen físico (O)' },
  { key: 'diagnosis', label: 'Diagnóstico (A)' },
  { key: 'plan', label: 'Plan (P)' },
];

/** Resumen de una línea para listas y chips */
export function templateSummary(t: ClinicalTemplate): string {
  if (t.prescription) return t.prescription.items.map((i) => `${i.drug} ${i.dose}`).join(' · ');
  const c = t.consultation ?? {};
  return [c.diagnosis ?? c.reason, c.plan].filter(Boolean).join(' · ');
}

/** Plantillas de consulta y recetas frecuentes de la clínica. */
@Injectable({ providedIn: 'root' })
export class ClinicalTemplatesService {
  private readonly http = inject(HttpClient);

  list(kind?: TemplateKind): Observable<ClinicalTemplate[]> {
    const params = kind ? new HttpParams().set('kind', kind) : undefined;
    return this.http.get<ClinicalTemplate[]>('/api/clinical-templates', { params });
  }

  create(input: TemplateInput): Observable<ClinicalTemplate> {
    return this.http.post<ClinicalTemplate>('/api/clinical-templates', input);
  }

  update(id: number, input: Partial<TemplateInput>): Observable<ClinicalTemplate> {
    return this.http.patch<ClinicalTemplate>(`/api/clinical-templates/${id}`, input);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`/api/clinical-templates/${id}`);
  }

  /** Se aplicó: sube en la lista (no importa si falla) */
  used(id: number): Observable<void> {
    return this.http.post<void>(`/api/clinical-templates/${id}/used`, {});
  }
}
