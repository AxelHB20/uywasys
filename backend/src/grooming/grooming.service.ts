import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { reserveNumbers } from '../common/sequence/clinic-sequence.js';
import { clinicDay, toDbDate } from '../common/time/clinic-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { GroomingStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OPEN_STATUSES } from '../queue/queue.service.js';
import { ChargesService } from '../visits/charges.service.js';
import type { CreateChargesDto } from '../visits/dto/charge.dto.js';
import { VisitsService } from '../visits/visits.service.js';
import type {
  AssignDto,
  BoardQuery,
  CancelGroomingDto,
  CheckInDto,
  DeliverDto,
  MoveDto,
} from './dto/grooming.dto.js';
import {
  CARD_SELECT,
  DETAIL_SELECT,
  GROOMING_STATUS_LABELS,
  toCard,
  toDetail,
} from './grooming.views.js';
import type { GroomingCard, GroomingDetail } from './grooming.views.js';

type Tx = Prisma.TransactionClient;

/** Orden del tablero */
const ORDER: GroomingStatus[] = ['WAITING', 'BATHING', 'CUTTING', 'READY'];
/** Hora en que se llegó a cada estado */
const STAMP = {
  BATHING: 'bathingAt',
  CUTTING: 'cuttingAt',
  READY: 'readyAt',
} as const;
type Step = keyof typeof STAMP;
const STAMP_COLUMN = {
  BATHING: 'bathing_at',
  CUTTING: 'cutting_at',
  READY: 'ready_at',
} as const;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Groomer {
  id: number;
  fullName: string;
}

/**
 * Baño y peluquería. El ingreso abre una atención de tipo GROOMING con sus servicios como
 * cargos (al precio del tamaño de la mascota); el tablero avanza los estados y la entrega
 * cierra la atención, que queda por cobrar en caja.
 */
@Injectable()
export class GroomingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visits: VisitsService,
    private readonly charges: ChargesService,
    private readonly audit: AuditService,
  ) {}

  /** Quienes pueden tener servicios asignados: groomers y quien tenga comisión configurada */
  groomers(clinicId: number): Promise<Groomer[]> {
    return this.prisma.user.findMany({
      where: {
        clinicId,
        active: true,
        OR: [{ role: 'GROOMER' }, { commissionPercent: { not: null } }],
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  /** Tablero: lo del día y, si es hoy, lo que sigue en curso de días anteriores */
  async board(clinicId: number, query: BoardQuery): Promise<GroomingCard[]> {
    const today = clinicDay(await this.timezone(clinicId));
    const day = query.day ?? today;
    const rows = await this.prisma.groomingSession.findMany({
      where: {
        clinicId,
        OR:
          day === today
            ? [{ day: toDbDate(day) }, { status: { in: ORDER } }]
            : [{ day: toDbDate(day) }],
      },
      select: CARD_SELECT,
      orderBy: [{ checkInAt: 'asc' }],
    });
    return rows.map(toCard);
  }

  /** Servicios de grooming de una mascota, del más reciente al más antiguo */
  async forPet(clinicId: number, petId: number): Promise<GroomingCard[]> {
    const rows = await this.prisma.groomingSession.findMany({
      where: { clinicId, petId },
      select: CARD_SELECT,
      orderBy: { checkInAt: 'desc' },
      take: 50,
    });
    return rows.map(toCard);
  }

  async get(clinicId: number, id: number): Promise<GroomingDetail> {
    const row = await this.prisma.groomingSession.findFirst({
      where: { id, clinicId },
      select: DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException('El servicio de grooming no existe');
    return toDetail(row);
  }

  async checkIn(
    actor: AuthUser,
    dto: CheckInDto,
    ip?: string,
  ): Promise<GroomingDetail> {
    const signature = dto.signature ? parseSignature(dto.signature) : null;
    if (signature && !dto.signerName)
      throw new BadRequestException('Escribe el nombre de quien firma');
    const services = await this.prisma.careService.findMany({
      where: {
        clinicId: actor.clinicId,
        id: { in: dto.services.map((s) => s.careServiceId) },
        active: true,
      },
      select: { id: true, name: true, category: true },
    });
    for (const item of dto.services) {
      const service = services.find((s) => s.id === item.careServiceId);
      if (!service)
        throw new NotFoundException('Un servicio no existe o está inactivo');
      if (service.category !== 'GROOMING')
        throw new BadRequestException(
          `${service.name} no es un servicio de baño o grooming`,
        );
    }
    if (dto.groomerId) await this.checkGroomer(actor.clinicId, dto.groomerId);

    const tz = await this.timezone(actor.clinicId);
    const prep = await this.charges.prepare(actor);
    const names = dto.services
      .map((i) => services.find((s) => s.id === i.careServiceId)!.name)
      .join(' + ');

    const { id, visitId, created } = await this.prisma.$transaction(
      async (tx) => {
        const visitId = await this.visits.openInTx(tx, actor, {
          petId: dto.petId,
          queueEntryId: dto.queueEntryId,
          type: 'GROOMING',
          reason: names.slice(0, 200),
        });
        const visit = await tx.visit.findUniqueOrThrow({
          where: { id: visitId },
          select: { clientId: true, pet: { select: { aggressive: true } } },
        });
        const number = await reserveNumbers(tx, actor.clinicId, 'grooming');
        const transport = dto.transport ?? 'NONE';
        const session = await tx.groomingSession.create({
          data: {
            clinicId: actor.clinicId,
            number,
            day: toDbDate(clinicDay(tz)),
            petId: dto.petId,
            clientId: visit.clientId,
            visitId,
            size: dto.size,
            groomerId: dto.groomerId ?? null,
            promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : null,
            fleas: dto.fleas ?? false,
            ticks: dto.ticks ?? false,
            matting: dto.matting ?? false,
            aggressive: dto.aggressive ?? visit.pet.aggressive,
            skinNotes: dto.skinNotes ?? null,
            belongings: dto.belongings ?? null,
            instructions: dto.instructions ?? null,
            transport,
            transportAddress:
              transport === 'NONE' ? null : (dto.transportAddress ?? null),
            signerName: signature ? (dto.signerName ?? null) : null,
            signature: signature ? new Uint8Array(signature) : null,
            createdById: actor.id,
          },
          select: { id: true },
        });
        // Los servicios entran a la cuenta al precio del tamaño (la atención ya tiene su grooming)
        const created = await this.charges.createInTx(
          tx,
          actor,
          {
            visitId,
            items: dto.services.map((s) => ({
              careServiceId: s.careServiceId,
              quantity: s.quantity ?? 1,
            })),
          } as CreateChargesDto,
          prep,
        );
        return { id: session.id, visitId, created };
      },
      { timeout: 20_000 },
    );

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'grooming.check_in',
      entity: 'grooming',
      entityId: id,
      ip,
      data: {
        petId: dto.petId,
        visitId,
        size: dto.size,
        services: names,
        signed: Boolean(signature),
      },
    });
    await this.charges.logCreated(actor, visitId, created, ip);
    return this.get(actor.clinicId, id);
  }

  /**
   * Avanza en el tablero. Se puede saltar pasos hacia adelante (un baño sin corte, unas uñas
   * que pasan directo a listo) y volver uno atrás para corregir; nada más.
   */
  async move(
    actor: AuthUser,
    id: number,
    dto: MoveDto,
    ip?: string,
  ): Promise<GroomingCard> {
    const from = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockActive(tx, actor.clinicId, id);
      const current = ORDER.indexOf(row.status);
      const target = ORDER.indexOf(dto.status);
      if (target === current) return row.status;
      if (target < current - 1)
        throw new ConflictException(
          `De ${GROOMING_STATUS_LABELS[row.status]} solo se puede volver a ${GROOMING_STATUS_LABELS[ORDER[current - 1]]}`,
        );

      const now = new Date();
      const data: Prisma.GroomingSessionUncheckedUpdateInput = {
        status: dto.status,
      };
      const to = dto.status as Step | 'WAITING';
      const at = row.status as Step | 'WAITING';
      if (target > current) {
        if (to !== 'WAITING') data[STAMP[to]] = now;
        // Quien empieza el baño sin groomer asignado se lo queda
        if (!row.groomer_id && actor.role === 'GROOMER')
          data.groomerId = actor.id;
      } else {
        if (at !== 'WAITING') data[STAMP[at]] = null;
        if (at === 'READY') data.notifiedAt = null;
        if (to !== 'WAITING' && !row[STAMP_COLUMN[to]]) data[STAMP[to]] = now;
      }
      await tx.groomingSession.update({ where: { id }, data });
      return row.status;
    });
    if (from !== dto.status)
      await this.audit.log({
        clinicId: actor.clinicId,
        userId: actor.id,
        action: 'grooming.status',
        entity: 'grooming',
        entityId: id,
        ip,
        data: { from, to: dto.status },
      });
    return this.card(actor.clinicId, id);
  }

  async assign(
    actor: AuthUser,
    id: number,
    dto: AssignDto,
    ip?: string,
  ): Promise<GroomingCard> {
    if (dto.groomerId) await this.checkGroomer(actor.clinicId, dto.groomerId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockActive(tx, actor.clinicId, id);
      await tx.groomingSession.update({
        where: { id },
        data: { groomerId: dto.groomerId },
      });
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'grooming.assign',
      entity: 'grooming',
      entityId: id,
      ip,
      data: { groomerId: dto.groomerId },
    });
    return this.card(actor.clinicId, id);
  }

  /** Se avisó al dueño por WhatsApp (el enlace lo arma la pantalla) */
  async notify(actor: AuthUser, id: number): Promise<GroomingCard> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockActive(tx, actor.clinicId, id);
      if (row.status !== 'READY')
        throw new ConflictException('Se avisa cuando la mascota está lista');
      await tx.groomingSession.update({
        where: { id },
        data: { notifiedAt: new Date() },
      });
    });
    return this.card(actor.clinicId, id);
  }

  /** Entrega: queda quién recogió, y la atención se cierra (lo pendiente pasa a "Por cobrar") */
  async deliver(
    actor: AuthUser,
    id: number,
    dto: DeliverDto,
    ip?: string,
  ): Promise<GroomingDetail> {
    const visitId = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockActive(tx, actor.clinicId, id);
      if (row.status !== 'READY')
        throw new ConflictException(
          'Primero pasa la mascota a "Listo" en el tablero',
        );
      const now = new Date();
      // La comisión se congela con el porcentaje que el groomer tiene hoy
      const groomer = row.groomer_id
        ? await tx.user.findUnique({
            where: { id: row.groomer_id },
            select: { commissionPercent: true },
          })
        : null;
      await tx.groomingSession.update({
        where: { id },
        data: {
          status: 'DELIVERED',
          commissionPercent: groomer?.commissionPercent ?? null,
          deliveredAt: now,
          deliveredById: actor.id,
          pickedUpBy: dto.pickedUpBy,
          pickedUpDocument: dto.pickedUpDocument ?? null,
          pickedUpRelation: dto.pickedUpRelation,
        },
      });
      const visit = await tx.visit.update({
        where: { id: row.visit_id },
        data: { status: 'CLOSED', closedAt: now, closedById: actor.id },
        select: { queueEntryId: true },
      });
      if (visit.queueEntryId)
        await tx.queueEntry.updateMany({
          where: { id: visit.queueEntryId, status: { in: OPEN_STATUSES } },
          data: { status: 'DONE', finishedAt: now },
        });
      return row.visit_id;
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'grooming.deliver',
      entity: 'grooming',
      entityId: id,
      ip,
      data: {
        visitId,
        pickedUpBy: dto.pickedUpBy,
        relation: dto.pickedUpRelation,
      },
    });
    return this.get(actor.clinicId, id);
  }

  /** El dueño se lo llevó sin el servicio, o se registró por error: se quitan sus cargos */
  async cancel(
    actor: AuthUser,
    id: number,
    dto: CancelGroomingDto,
    ip?: string,
  ): Promise<GroomingDetail> {
    const voided = await this.prisma.$transaction(
      async (tx) => {
        const row = await this.lockActive(tx, actor.clinicId, id);
        const charges = await tx.charge.findMany({
          where: { visitId: row.visit_id, status: { not: 'VOID' } },
          select: { id: true, status: true, paidAmount: true },
        });
        if (
          charges.some((c) => c.status === 'PAID' || Number(c.paidAmount) > 0)
        )
          throw new ConflictException(
            'El servicio tiene pagos: primero anula el cobro en caja',
          );
        for (const charge of charges)
          await this.charges.voidInTx(
            tx,
            actor,
            charge.id,
            `Grooming cancelado: ${dto.reason}`,
            true,
          );
        const now = new Date();
        await tx.groomingSession.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancelledById: actor.id,
            cancelReason: dto.reason,
          },
        });
        const visit = await tx.visit.update({
          where: { id: row.visit_id },
          data: {
            status: 'CANCELLED',
            cancelReason: dto.reason,
            closedAt: now,
            closedById: actor.id,
          },
          select: { queueEntryId: true },
        });
        if (visit.queueEntryId)
          await tx.queueEntry.updateMany({
            where: { id: visit.queueEntryId, status: { in: OPEN_STATUSES } },
            data: { status: 'CANCELLED', finishedAt: now },
          });
        return charges.length;
      },
      { timeout: 20_000 },
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'grooming.cancel',
      entity: 'grooming',
      entityId: id,
      ip,
      data: { reason: dto.reason, voidedCharges: voided },
    });
    return this.get(actor.clinicId, id);
  }

  // ── Ayudas ──

  private async card(clinicId: number, id: number): Promise<GroomingCard> {
    const row = await this.prisma.groomingSession.findFirstOrThrow({
      where: { id, clinicId },
      select: CARD_SELECT,
    });
    return toCard(row);
  }

  /** Bloquea el servicio: dos personas moviendo la misma tarjeta no se pisan */
  private async lockActive(tx: Tx, clinicId: number, id: number) {
    const [row] = await tx.$queryRaw<
      {
        status: GroomingStatus;
        visit_id: number;
        groomer_id: number | null;
        bathing_at: Date | null;
        cutting_at: Date | null;
        ready_at: Date | null;
      }[]
    >`SELECT status::text AS status, visit_id, groomer_id, bathing_at, cutting_at, ready_at
      FROM grooming_sessions WHERE id = ${id} AND clinic_id = ${clinicId} FOR UPDATE`;
    if (!row) throw new NotFoundException('El servicio de grooming no existe');
    if (row.status === 'DELIVERED')
      throw new ConflictException('La mascota ya se entregó');
    if (row.status === 'CANCELLED')
      throw new ConflictException('El servicio fue cancelado');
    return row;
  }

  private async checkGroomer(clinicId: number, groomerId: number) {
    const ok = await this.prisma.user.count({
      where: {
        id: groomerId,
        clinicId,
        active: true,
        OR: [{ role: 'GROOMER' }, { commissionPercent: { not: null } }],
      },
    });
    if (!ok)
      throw new BadRequestException('Esa persona no está como groomer activo');
  }

  private async timezone(clinicId: number) {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    return timezone;
  }
}

function parseSignature(dataUrl: string): Buffer {
  const signature = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (signature.length < 300 || !signature.subarray(0, 8).equals(PNG))
    throw new BadRequestException('Falta la firma');
  return signature;
}
