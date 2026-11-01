import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OPEN_STATUSES } from '../queue/queue.service.js';
import type {
  AddendumDto,
  CancelVisitDto,
  ListVisitsQuery,
  OpenVisitDto,
  UpdateVisitDto,
} from './dto/visit.dto.js';
import {
  VISIT_DETAIL_SELECT,
  VISIT_SUMMARY_SELECT,
  lockVisit,
  toVisitDetail,
  toVisitSummary,
} from './visit.views.js';
import type { VisitDetail, VisitSummary } from './visit.views.js';

const PAGE_SIZE = 20;

/** Campos del SOAP que se guardan tal cual (null borra) */
const SOAP_FIELDS = [
  'anamnesis',
  'heartRate',
  'respiratoryRate',
  'capillaryRefillS',
  'mucosa',
  'hydration',
  'bodyCondition',
  'physicalExam',
  'diagnosis',
] as const;

/**
 * Atenciones: abrir (desde la cola o la ficha), registrar signos y notas, cerrar o cancelar.
 * Cerrada, la atención es parte de la historia clínica: solo admite adendas.
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async open(
    actor: AuthUser,
    dto: OpenVisitDto,
    ip?: string,
  ): Promise<VisitDetail> {
    const id = await this.prisma.$transaction((tx) =>
      this.openInTx(tx, actor, dto),
    );

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'visit.open',
      entity: 'visit',
      entityId: id,
      ip,
      data: { petId: dto.petId, queueEntryId: dto.queueEntryId ?? null },
    });
    return this.get(actor.clinicId, id);
  }

  /** Abre la atención dentro de una transacción que ya existe (también la usa el ingreso a grooming). */
  async openInTx(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    dto: OpenVisitDto,
  ): Promise<number> {
    // Bloquea la mascota: dos clics en "Atender" no abren dos atenciones
    const [pet] = await tx.$queryRaw<
      {
        name: string;
        client_id: number;
        active: boolean;
        deceased_at: Date | null;
      }[]
    >`SELECT name, client_id, active, deceased_at FROM pets
      WHERE id = ${dto.petId} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
    if (!pet) throw new NotFoundException('La mascota no existe');
    if (pet.deceased_at)
      throw new BadRequestException(
        `${pet.name} está registrada como fallecida`,
      );
    const client = await tx.client.findUniqueOrThrow({
      where: { id: pet.client_id },
      select: { active: true },
    });
    if (!pet.active || !client.active)
      throw new BadRequestException(
        `${pet.name} está inactiva: actívala en la ficha del cliente`,
      );

    const open = await tx.visit.findFirst({
      where: { clinicId: actor.clinicId, petId: dto.petId, status: 'OPEN' },
      select: { id: true },
    });
    if (open)
      throw new ConflictException({
        message: `${pet.name} ya tiene una atención abierta`,
        visitId: open.id,
      });

    let type = dto.type ?? 'CONSULTATION';
    let reason = dto.reason ?? null;
    if (dto.queueEntryId) {
      const entry = await tx.queueEntry.findFirst({
        where: {
          id: dto.queueEntryId,
          clinicId: actor.clinicId,
          petId: dto.petId,
        },
        select: { status: true, startedAt: true, type: true, reason: true },
      });
      if (!entry)
        throw new NotFoundException('Esa entrada de la cola no existe');
      if (!OPEN_STATUSES.includes(entry.status))
        throw new ConflictException('Esa entrada de la cola ya se cerró');
      type = dto.type ?? entry.type;
      reason = dto.reason ?? entry.reason;
      await tx.queueEntry.update({
        where: { id: dto.queueEntryId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: entry.startedAt ?? new Date(),
          attendedBy: { connect: { id: actor.id } },
        },
      });
    }

    const visit = await tx.visit.create({
      data: {
        clinicId: actor.clinicId,
        petId: dto.petId,
        clientId: pet.client_id,
        queueEntryId: dto.queueEntryId ?? null,
        type,
        reason,
        attendedById: actor.id,
      },
      select: { id: true },
    });
    return visit.id;
  }

  async get(clinicId: number, id: number): Promise<VisitDetail> {
    const row = await this.prisma.visit.findFirst({
      where: { id, clinicId },
      select: VISIT_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException('La atención no existe');
    return toVisitDetail(row);
  }

  async list(
    clinicId: number,
    query: ListVisitsQuery,
  ): Promise<{
    items: VisitSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const where: Prisma.VisitWhereInput = { clinicId };
    if (query.status) where.status = query.status;
    if (query.petId) where.petId = query.petId;
    if (query.clientId) where.clientId = query.clientId;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
        select: VISIT_SUMMARY_SELECT,
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.visit.count({ where }),
    ]);
    const totals = rows.length
      ? await this.prisma.charge.groupBy({
          by: ['visitId'],
          where: {
            clinicId,
            visitId: { in: rows.map((r) => r.id) },
            status: { not: 'VOID' },
          },
          _sum: { total: true },
        })
      : [];
    const byVisit = new Map(
      totals.map((t) => [t.visitId, Number(t._sum.total ?? 0)]),
    );
    return {
      items: rows.map((r) => toVisitSummary(r, byVisit.get(r.id) ?? 0)),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /** Signos, SOAP, motivo y notas: solo mientras está abierta. El peso también actualiza la ficha. */
  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateVisitDto,
  ): Promise<VisitDetail> {
    await this.prisma.$transaction(async (tx) => {
      const visit = await this.lockOpen(tx, actor.clinicId, id);
      const data: Prisma.VisitUncheckedUpdateInput = {};
      if (dto.reason !== undefined) data.reason = dto.reason;
      if (dto.weightKg !== undefined) data.weightKg = dto.weightKg;
      if (dto.temperatureC !== undefined) data.temperatureC = dto.temperatureC;
      if (dto.notes !== undefined) data.notes = dto.notes;
      for (const key of SOAP_FIELDS)
        if (dto[key] !== undefined)
          (data as Record<string, unknown>)[key] = dto[key];
      if (dto.diagnosisDefinitive !== undefined)
        data.diagnosisDefinitive = dto.diagnosisDefinitive;
      await tx.visit.update({ where: { id }, data });
      if (dto.weightKg != null)
        await tx.pet.update({
          where: { id: visit.pet_id },
          data: { weightKg: dto.weightKg },
        });
    });
    return this.get(actor.clinicId, id);
  }

  async close(actor: AuthUser, id: number, ip?: string): Promise<VisitDetail> {
    await this.prisma.$transaction(async (tx) => {
      const visit = await this.lockOpen(tx, actor.clinicId, id);
      await this.notGrooming(tx, id);
      const now = new Date();
      await tx.visit.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: now, closedById: actor.id },
      });
      if (visit.queue_entry_id)
        await tx.queueEntry.updateMany({
          where: {
            id: visit.queue_entry_id,
            status: { in: OPEN_STATUSES },
          },
          data: { status: 'DONE', finishedAt: now },
        });
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'visit.close',
      entity: 'visit',
      entityId: id,
      ip,
    });
    return this.get(actor.clinicId, id);
  }

  /** Para una atención abierta por error. Primero hay que quitar sus cargos. */
  async cancel(
    actor: AuthUser,
    id: number,
    dto: CancelVisitDto,
    ip?: string,
  ): Promise<VisitDetail> {
    await this.prisma.$transaction(async (tx) => {
      const visit = await this.lockOpen(tx, actor.clinicId, id);
      await this.notGrooming(tx, id);
      const charges = await tx.charge.count({
        where: { visitId: id, status: { not: 'VOID' } },
      });
      if (charges)
        throw new ConflictException(
          'La atención tiene cargos: quítalos antes de cancelarla',
        );
      await tx.visit.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: dto.reason,
          closedAt: new Date(),
          closedById: actor.id,
        },
      });
      // La mascota sigue esperando en la cola
      if (visit.queue_entry_id)
        await tx.queueEntry.updateMany({
          where: { id: visit.queue_entry_id, status: 'IN_PROGRESS' },
          data: { status: 'WAITING', startedAt: null, attendedById: null },
        });
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'visit.cancel',
      entity: 'visit',
      entityId: id,
      ip,
      data: { reason: dto.reason },
    });
    return this.get(actor.clinicId, id);
  }

  /** Corrección de una atención cerrada: se agrega con autor y fecha, nunca se edita lo anterior. */
  async addAddendum(
    actor: AuthUser,
    id: number,
    dto: AddendumDto,
    ip?: string,
  ): Promise<VisitDetail> {
    const visit = await this.prisma.visit.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { status: true },
    });
    if (!visit) throw new NotFoundException('La atención no existe');
    if (visit.status !== 'CLOSED')
      throw new ConflictException(
        visit.status === 'OPEN'
          ? 'La atención sigue abierta: edítala directamente'
          : 'La atención fue cancelada',
      );
    const addendum = await this.prisma.visitAddendum.create({
      data: {
        clinicId: actor.clinicId,
        visitId: id,
        authorId: actor.id,
        text: dto.text,
      },
      select: { id: true },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'visit.addendum',
      entity: 'visit',
      entityId: id,
      ip,
      data: { addendumId: addendum.id },
    });
    return this.get(actor.clinicId, id);
  }

  /** La atención de un grooming se cierra al entregar la mascota (o se cancela) desde el tablero */
  private async notGrooming(tx: Prisma.TransactionClient, visitId: number) {
    const grooming = await tx.groomingSession.findUnique({
      where: { visitId },
      select: { id: true },
    });
    if (grooming)
      throw new ConflictException({
        message:
          'Es un servicio de grooming: se cierra al entregar la mascota desde el tablero',
        groomingId: grooming.id,
      });
  }

  private async lockOpen(
    tx: Prisma.TransactionClient,
    clinicId: number,
    id: number,
  ) {
    const visit = await lockVisit(tx, clinicId, id);
    if (!visit) throw new NotFoundException('La atención no existe');
    if (visit.status !== 'OPEN')
      throw new ConflictException(
        visit.status === 'CLOSED'
          ? 'La atención ya se cerró: para corregirla agrega una adenda'
          : 'La atención fue cancelada',
      );
    return visit;
  }
}
