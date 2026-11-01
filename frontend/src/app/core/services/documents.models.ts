import { Species } from './clients.models';

export type AttachmentKind = 'PHOTO' | 'LAB' | 'IMAGING' | 'DOCUMENT';
export type ConsentType = 'SURGERY' | 'ANESTHESIA' | 'EUTHANASIA' | 'HOSPITALIZATION' | 'OTHER';

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  PHOTO: 'Foto',
  LAB: 'Análisis',
  IMAGING: 'Rx o ecografía',
  DOCUMENT: 'Documento',
};

export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  SURGERY: 'Cirugía',
  ANESTHESIA: 'Anestesia o sedación',
  EUTHANASIA: 'Eutanasia',
  HOSPITALIZATION: 'Hospitalización',
  OTHER: 'Otro procedimiento',
};

export const MAX_ATTACHMENT_MB = 10;

export interface Attachment {
  id: number;
  petId: number;
  visitId: number | null;
  kind: AttachmentKind;
  title: string;
  fileName: string;
  mime: string;
  size: number;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  createdBy: { id: number; fullName: string };
}

export interface ConsentSummary {
  id: number;
  code: string;
  title: string;
  type: ConsentType;
  procedure: string;
  visitId: number | null;
  signerName: string;
  signedAt: string;
  vet: { id: number; fullName: string };
  voidedAt: string | null;
  voidReason: string | null;
}

export interface ConsentDocument extends ConsentSummary {
  text: string;
  signerDocument: string | null;
  signerRelation: string;
  signature: string;
  hash: string;
  vet: { id: number; fullName: string; licenseNumber: string | null };
  clinic: {
    name: string;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  pet: { id: number; number: number; name: string; species: Species; breed: string | null };
  client: { id: number; name: string; phone: string };
}

export interface ConsentInput {
  petId: number;
  visitId?: number;
  type: ConsentType;
  procedure: string;
  text: string;
  signerName: string;
  signerDocument: string | null;
  signerRelation: string;
  signature: string;
}

export const attachmentUrl = (id: number) => `/api/attachments/${id}/file`;

/** "1.2 MB", "340 KB" */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
