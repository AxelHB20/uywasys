import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import type { TemplateKind } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ConsultationContentDto,
  PrescriptionContentDto,
  TemplateDto,
  UpdateTemplateDto,
} from './dto/template.dto.js';

export interface TemplateView {
  id: number;
  kind: TemplateKind;
  name: string;
  consultation: ConsultationContentDto | null;
  prescription: PrescriptionContentDto | null;
  usageCount: number;
  createdBy: { id: number; fullName: string };
  updatedAt: Date;
}

const SELECT = {
  id: true,
  kind: true,
  name: true,
  content: true,
  usageCount: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true } },
} as const;

type Row = Prisma.ClinicalTemplateGetPayload<{ select: typeof SELECT }>;

function toView(row: Row): TemplateView {
  const content = row.content as Record<string, unknown>;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    consultation:
      row.kind === 'CONSULTATION' ? (content as ConsultationContentDto) : null,
    prescription:
      row.kind === 'PRESCRIPTION'
        ? (content as unknown as PrescriptionContentDto)
        : null,
    usageCount: row.usageCount,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  };
}

/** Solo lo que tiene texto: una plantilla de consulta no guarda campos vacíos */
function consultationContent(
  c: ConsultationContentDto,
): Prisma.InputJsonObject {
  const out: Record<string, string> = {};
  for (const key of [
    'reason',
    'anamnesis',
    'physicalExam',
    'diagnosis',
    'plan',
  ] as const) {
    const value = c[key]?.trim();
    if (value) out[key] = value;
  }
  if (!Object.keys(out).length)
    throw new BadRequestException(
      'La plantilla está vacía: escribe al menos un campo',
    );
  return out;
}

function prescriptionContent(
  p: PrescriptionContentDto,
): Prisma.InputJsonObject {
  return {
    notes: p.notes?.trim() || null,
    items: p.items.map((i) => ({
      productId: i.productId ?? null,
      presentationId: i.presentationId ?? null,
      drug: i.drug.trim(),
      dose: i.dose.trim(),
      route: i.route?.trim() || null,
      frequency: i.frequency.trim(),
      duration: i.duration.trim(),
      instructions: i.instructions?.trim() || null,
      dispenseQuantity: i.dispenseQuantity ?? null,
    })),
  };
}

/**
 * Plantillas de consulta y recetas frecuentes de la clínica: el veterinario aplica una y solo
 * completa lo particular del paciente. Las más usadas salen primero.
 */
@Injectable()
export class ClinicalTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clinicId: number, kind?: TemplateKind): Promise<TemplateView[]> {
    const rows = await this.prisma.clinicalTemplate.findMany({
      where: { clinicId, ...(kind ? { kind } : {}) },
      select: SELECT,
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toView);
  }

  async create(actor: AuthUser, dto: TemplateDto): Promise<TemplateView> {
    const content =
      dto.kind === 'CONSULTATION'
        ? consultationContent(dto.consultation ?? {})
        : prescriptionContent(dto.prescription ?? { items: [] });
    try {
      const row = await this.prisma.clinicalTemplate.create({
        data: {
          clinicId: actor.clinicId,
          kind: dto.kind,
          name: dto.name,
          content,
          createdById: actor.id,
        },
        select: SELECT,
      });
      return toView(row);
    } catch (error) {
      throw this.duplicated(error, dto.name);
    }
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateTemplateDto,
  ): Promise<TemplateView> {
    const current = await this.find(actor.clinicId, id);
    const content =
      current.kind === 'CONSULTATION'
        ? dto.consultation
          ? consultationContent(dto.consultation)
          : undefined
        : dto.prescription
          ? prescriptionContent(dto.prescription)
          : undefined;
    try {
      const row = await this.prisma.clinicalTemplate.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(content ? { content } : {}),
        },
        select: SELECT,
      });
      return toView(row);
    } catch (error) {
      throw this.duplicated(error, dto.name ?? current.name);
    }
  }

  async remove(actor: AuthUser, id: number): Promise<void> {
    await this.find(actor.clinicId, id);
    await this.prisma.clinicalTemplate.delete({ where: { id } });
  }

  /** Se usó: sube en la lista */
  async used(actor: AuthUser, id: number): Promise<void> {
    await this.find(actor.clinicId, id);
    await this.prisma.clinicalTemplate.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });
  }

  private async find(clinicId: number, id: number) {
    const row = await this.prisma.clinicalTemplate.findFirst({
      where: { id, clinicId },
      select: { id: true, kind: true, name: true },
    });
    if (!row) throw new NotFoundException('Plantilla no encontrada');
    return row;
  }

  private duplicated(error: unknown, name: string): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      return new ConflictException(`Ya hay una plantilla llamada «${name}»`);
    return error;
  }
}
