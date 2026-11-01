import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clinicDay, startOfDayIn } from '../common/time/clinic-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  AppointmentStatus,
  Role,
  Species,
  VisitType,
} from '../generated/prisma/enums.js';
import { addDays } from '../inventory/expiry.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OPEN_STATUSES, QueueService } from '../queue/queue.service.js';
import type {
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQuery,
  UpdateAppointmentDto,
} from './dto/appointment.dto.js';

/** Las que ocupan la agenda */
const ACTIVE: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED'];
const EDITABLE: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED'];
const MAX_RANGE_DAYS = 31;
const MAX_DURATION_MS = 120 * 60_000;

const SELECT = {
  id: true,
  startsAt: true,
  durationMin: true,
  type: true,
  reason: true,
  notes: true,
  status: true,
  cancelReason: true,
  queueEntryId: true,
  createdAt: true,
  pet: {
    select: {
      id: true,
      number: true,
      name: true,
      species: true,
      aggressive: true,
    },
  },
  client: { select: { id: true, name: true, phone: true } },
  vet: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AppointmentSelect;

export interface AppointmentView {
  id: number;
  startsAt: Date;
  durationMin: number;
  type: VisitType;
  reason: string | null;
  notes: string | null;
  status: AppointmentStatus;
  cancelReason: string | null;
  queueEntryId: number | null;
  createdAt: Date;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    aggressive: boolean;
  };
  client: { id: number; name: string; phone: string };
  vet: { id: number; fullName: string } | null;
  createdBy: { id: number; fullName: string };
}

export interface AgendaStaff {
  id: number;
  fullName: string;
  role: Role;
}

/**
 * Agenda de citas. Una cita no reemplaza a la cola: cuando el paciente llega, "Llegó" lo pone
 * en la cola de hoy y desde ahí se atiende como siempre.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /** Quiénes pueden tener citas: veterinarios, groomers y el administrador con colegiatura */
  async staff(clinicId: number): Promise<AgendaStaff[]> {
    return this.prisma.user.findMany({
      where: {
        clinicId,
        active: true,
        OR: [
          { role: { in: ['VET', 'GROOMER'] } },
          { role: 'ADMIN', licenseNumber: { not: null } },
        ],
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async list(
    clinicId: number,
    query: ListAppointmentsQuery,
  ): Promise<AppointmentView[]> {
    const tz = await this.timezone(clinicId);
    const to = query.to ?? query.from;
    if (to < query.from)
      throw new BadRequestException('El rango de fechas está al revés');
    if (to > addDays(query.from, MAX_RANGE_DAYS))
      throw new BadRequestException(
        `Consulta hasta ${MAX_RANGE_DAYS} días a la vez`,
      );
    return this.prisma.appointment.findMany({
      where: {
        clinicId,
        startsAt: {
          gte: startOfDayIn(tz, query.from),
          lt: startOfDayIn(tz, addDays(to, 1)),
        },
        ...(query.vetId ? { vetId: query.vetId } : {}),
        ...(query.petId ? { petId: query.petId } : {}),
      },
      select: SELECT,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
  }

  async create(
    actor: AuthUser,
    dto: CreateAppointmentDto,
    ip?: string,
  ): Promise<AppointmentView> {
    const pet = await this.prisma.pet.findFirst({
      where: { id: dto.petId, clinicId: actor.clinicId },
      select: {
        name: true,
        active: true,
        deceasedAt: true,
        clientId: true,
        client: { select: { active: true } },
      },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    if (pet.deceasedAt)
      throw new BadRequestException(
        `${pet.name} está registrada como fallecida`,
      );
    if (!pet.active || !pet.client.active)
      throw new BadRequestException(
        `${pet.name} está inactiva: actívala en la ficha del cliente`,
      );
    const startsAt = new Date(dto.startsAt);
    if (startsAt.getTime() < Date.now() - 15 * 60_000)
      throw new BadRequestException('La cita no puede quedar en el pasado');
    await this.checkVet(actor.clinicId, dto.vetId ?? null);
    await this.checkOverlap(actor.clinicId, {
      petId: dto.petId,
      petName: pet.name,
      vetId: dto.vetId ?? null,
      startsAt,
      durationMin: dto.durationMin,
      allowOverlap: dto.allowOverlap ?? false,
    });

    const row = await this.prisma.appointment.create({
      data: {
        clinicId: actor.clinicId,
        petId: dto.petId,
        clientId: pet.clientId,
        vetId: dto.vetId ?? null,
        startsAt,
        durationMin: dto.durationMin,
        type: dto.type ?? 'CONSULTATION',
        reason: dto.reason ?? null,
        notes: dto.notes ?? null,
        createdById: actor.id,
      },
      select: SELECT,
    });
    await this.log(actor, 'appointment.create', row.id, ip, {
      petId: dto.petId,
      startsAt: row.startsAt,
      vetId: row.vet?.id ?? null,
    });
    return row;
  }

  /** Reprogramar o corregir. Si cambia la hora, la cita vuelve a "por confirmar". */
  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateAppointmentDto,
    ip?: string,
  ): Promise<AppointmentView> {
    const current = await this.find(actor.clinicId, id);
    if (!EDITABLE.includes(current.status))
      throw new ConflictException('Esta cita ya no se puede cambiar');
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const moved = startsAt.getTime() !== current.startsAt.getTime();
    if (moved && startsAt.getTime() < Date.now() - 15 * 60_000)
      throw new BadRequestException('La cita no puede quedar en el pasado');
    const vetId = dto.vetId === undefined ? current.vetId : dto.vetId;
    const durationMin = dto.durationMin ?? current.durationMin;
    if (dto.vetId !== undefined) await this.checkVet(actor.clinicId, vetId);
    await this.checkOverlap(actor.clinicId, {
      id,
      petId: current.petId,
      petName: current.pet.name,
      vetId,
      startsAt,
      durationMin,
      allowOverlap: dto.allowOverlap ?? false,
    });

    const row = await this.prisma.appointment.update({
      where: { id },
      data: {
        vetId,
        startsAt,
        durationMin,
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(moved ? { status: 'SCHEDULED' as const } : {}),
      },
      select: SELECT,
    });
    await this.log(
      actor,
      moved ? 'appointment.reschedule' : 'appointment.update',
      id,
      ip,
      moved ? { from: current.startsAt, to: startsAt } : undefined,
    );
    return row;
  }

  async confirm(actor: AuthUser, id: number): Promise<AppointmentView> {
    const current = await this.find(actor.clinicId, id);
    if (current.status !== 'SCHEDULED')
      throw new ConflictException('Solo se confirma una cita por confirmar');
    return this.setStatus(id, 'CONFIRMED');
  }

  /** Llegó: entra a la cola de hoy (si ya estaba, se enlaza con esa entrada) */
  async arrive(
    actor: AuthUser,
    id: number,
    ip?: string,
  ): Promise<AppointmentView> {
    const current = await this.find(actor.clinicId, id);
    if (!EDITABLE.includes(current.status))
      throw new ConflictException('Esta cita ya no está pendiente');
    const tz = await this.timezone(actor.clinicId);
    const today = clinicDay(tz);
    if (clinicDay(tz, current.startsAt) !== today)
      throw new BadRequestException(
        'La cita es de otro día: reprográmala para hoy o agrégala a la cola',
      );

    let queueEntryId: number;
    try {
      const entry = await this.queue.create(actor, {
        petId: current.petId,
        type: current.type,
        reason: current.reason ?? 'Cita',
      });
      queueEntryId = entry.id;
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const open = await this.prisma.queueEntry.findFirst({
        where: {
          clinicId: actor.clinicId,
          petId: current.petId,
          status: { in: OPEN_STATUSES },
          appointment: null,
        },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      if (!open) throw error;
      queueEntryId = open.id;
    }
    const row = await this.prisma.appointment.update({
      where: { id },
      data: { status: 'ARRIVED', queueEntryId },
      select: SELECT,
    });
    await this.log(actor, 'appointment.arrive', id, ip, { queueEntryId });
    return row;
  }

  async noShow(
    actor: AuthUser,
    id: number,
    ip?: string,
  ): Promise<AppointmentView> {
    const current = await this.find(actor.clinicId, id);
    if (!EDITABLE.includes(current.status))
      throw new ConflictException('Esta cita ya no está pendiente');
    if (current.startsAt.getTime() > Date.now())
      throw new BadRequestException('Todavía no es la hora de la cita');
    const row = await this.setStatus(id, 'NO_SHOW');
    await this.log(actor, 'appointment.no_show', id, ip);
    return row;
  }

  async cancel(
    actor: AuthUser,
    id: number,
    dto: CancelAppointmentDto,
    ip?: string,
  ): Promise<AppointmentView> {
    const current = await this.find(actor.clinicId, id);
    if (!EDITABLE.includes(current.status))
      throw new ConflictException('Esta cita ya no está pendiente');
    const row = await this.prisma.appointment.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: dto.reason },
      select: SELECT,
    });
    await this.log(actor, 'appointment.cancel', id, ip, {
      reason: dto.reason,
    });
    return row;
  }

  private async find(clinicId: number, id: number) {
    const row = await this.prisma.appointment.findFirst({
      where: { id, clinicId },
      select: {
        status: true,
        startsAt: true,
        durationMin: true,
        petId: true,
        vetId: true,
        type: true,
        reason: true,
        pet: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException('La cita no existe');
    return row;
  }

  private setStatus(id: number, status: AppointmentStatus) {
    return this.prisma.appointment.update({
      where: { id },
      data: { status },
      select: SELECT,
    });
  }

  private async checkVet(clinicId: number, vetId: number | null) {
    if (!vetId) return;
    const staff = await this.staff(clinicId);
    if (!staff.some((s) => s.id === vetId))
      throw new BadRequestException('Esa persona no atiende citas');
  }

  /**
   * La mascota no puede tener dos citas a la vez. El veterinario sí, si se confirma a propósito
   * (sobrecupo), porque en la práctica pasa.
   */
  private async checkOverlap(
    clinicId: number,
    a: {
      id?: number;
      petId: number;
      petName: string;
      vetId: number | null;
      startsAt: Date;
      durationMin: number;
      allowOverlap: boolean;
    },
  ) {
    const end = new Date(a.startsAt.getTime() + a.durationMin * 60_000);
    const near = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: ACTIVE },
        ...(a.id ? { id: { not: a.id } } : {}),
        startsAt: {
          lt: end,
          gt: new Date(a.startsAt.getTime() - MAX_DURATION_MS),
        },
        OR: [{ petId: a.petId }, ...(a.vetId ? [{ vetId: a.vetId }] : [])],
      },
      select: {
        startsAt: true,
        durationMin: true,
        petId: true,
        vet: { select: { fullName: true } },
        pet: { select: { name: true } },
      },
    });
    const clashes = near.filter(
      (n) =>
        n.startsAt.getTime() + n.durationMin * 60_000 > a.startsAt.getTime(),
    );
    const tz = await this.timezone(clinicId);
    const pet = clashes.find((c) => c.petId === a.petId);
    if (pet)
      throw new ConflictException(
        `${a.petName} ya tiene una cita a las ${hour(pet.startsAt, tz)}`,
      );
    const vet = clashes[0];
    if (vet && !a.allowOverlap)
      throw new ConflictException({
        message: `${vet.vet?.fullName ?? 'Ese veterinario'} ya tiene una cita a las ${hour(vet.startsAt, tz)} (${vet.pet.name})`,
        code: 'OVERLAP',
      });
  }

  private async timezone(clinicId: number) {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    return timezone;
  }

  private log(
    actor: AuthUser,
    action: string,
    id: number,
    ip?: string,
    data?: Prisma.InputJsonObject,
  ) {
    return this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action,
      entity: 'appointment',
      entityId: id,
      ip,
      data,
    });
  }
}

function hour(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}
