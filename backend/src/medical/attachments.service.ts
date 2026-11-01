import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { detectImageType } from '../clinic/clinic.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AttachmentKind } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ListAttachmentsQuery,
  UploadAttachmentDto,
  VoidAttachmentDto,
} from './dto/attachment.dto.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface UploadedAttachment {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const SELECT = {
  id: true,
  petId: true,
  visitId: true,
  kind: true,
  title: true,
  fileName: true,
  mime: true,
  size: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AttachmentSelect;

export interface AttachmentView {
  id: number;
  petId: number;
  visitId: number | null;
  kind: AttachmentKind;
  title: string;
  fileName: string;
  mime: string;
  size: number;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  createdBy: { id: number; fullName: string };
}

/** Imágenes o PDF, reconocidos por sus primeros bytes (no por la extensión) */
export function detectAttachmentType(buffer: Buffer): string | null {
  const image = detectImageType(buffer);
  if (image) return image;
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-')
    return 'application/pdf';
  return null;
}

/** Nombre seguro para guardar y para la cabecera de descarga */
function safeName(name: string, mime: string): string {
  const ext = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  }[mime];
  const base = name
    .replace(/\.[^.]*$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 150);
  return `${base || 'archivo'}.${ext}`;
}

/**
 * Adjuntos de la historia clínica. Se guardan en la base (entran en el respaldo diario) y
 * no se borran: un archivo equivocado se anula con motivo y deja de mostrarse.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    clinicId: number,
    petId: number,
    query: ListAttachmentsQuery,
  ): Promise<AttachmentView[]> {
    await this.findPet(clinicId, petId);
    return this.prisma.attachment.findMany({
      where: {
        clinicId,
        petId,
        ...(query.visitId ? { visitId: query.visitId } : {}),
      },
      select: SELECT,
      orderBy: { id: 'desc' },
    });
  }

  async upload(
    actor: AuthUser,
    petId: number,
    dto: UploadAttachmentDto,
    file: UploadedAttachment | undefined,
    ip?: string,
  ): Promise<AttachmentView> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Elige el archivo');
    const mime = detectAttachmentType(file.buffer);
    if (!mime)
      throw new BadRequestException(
        'Solo se aceptan fotos (JPG, PNG, WebP) o PDF',
      );
    await this.findPet(actor.clinicId, petId);
    if (dto.visitId) {
      const visit = await this.prisma.visit.findFirst({
        where: { id: dto.visitId, clinicId: actor.clinicId, petId },
        select: { status: true },
      });
      if (!visit) throw new NotFoundException('La atención no existe');
      if (visit.status === 'CANCELLED')
        throw new ConflictException('La atención fue cancelada');
    }
    const row = await this.prisma.attachment.create({
      data: {
        clinicId: actor.clinicId,
        petId,
        visitId: dto.visitId ?? null,
        kind: dto.kind,
        title: dto.title,
        // Multer entrega el nombre en latin1: se recupera el UTF-8 (tildes, ñ)
        fileName: safeName(
          Buffer.from(file.originalname ?? '', 'latin1').toString('utf8'),
          mime,
        ),
        mime,
        size: file.size,
        createdById: actor.id,
        file: { create: { data: new Uint8Array(file.buffer) } },
      },
      select: SELECT,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'attachment.create',
      entity: 'attachment',
      entityId: row.id,
      ip,
      data: { petId, visitId: dto.visitId ?? null, mime, bytes: file.size },
    });
    return row;
  }

  async file(
    clinicId: number,
    id: number,
  ): Promise<{ data: Buffer; mime: string; fileName: string }> {
    const row = await this.prisma.attachment.findFirst({
      where: { id, clinicId },
      select: { mime: true, fileName: true, file: { select: { data: true } } },
    });
    if (!row?.file) throw new NotFoundException('El archivo no existe');
    return {
      data: Buffer.from(row.file.data),
      mime: row.mime,
      fileName: row.fileName,
    };
  }

  async void(
    actor: AuthUser,
    id: number,
    dto: VoidAttachmentDto,
    ip?: string,
  ): Promise<AttachmentView> {
    const current = await this.prisma.attachment.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { createdById: true, voidedAt: true, petId: true },
    });
    if (!current) throw new NotFoundException('El archivo no existe');
    if (current.createdById !== actor.id && actor.role !== 'ADMIN')
      throw new ForbiddenException(
        'Solo quien lo subió o el administrador puede anularlo',
      );
    if (current.voidedAt)
      throw new ConflictException('Ese archivo ya está anulado');
    const row = await this.prisma.attachment.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedById: actor.id,
        voidReason: dto.reason,
      },
      select: SELECT,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'attachment.void',
      entity: 'attachment',
      entityId: id,
      ip,
      data: { petId: current.petId, reason: dto.reason },
    });
    return row;
  }

  private async findPet(clinicId: number, petId: number) {
    const pet = await this.prisma.pet.findFirst({
      where: { id: petId, clinicId },
      select: { id: true },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
  }
}
