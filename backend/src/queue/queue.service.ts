import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { fromDbDate, toDbDate } from '../common/time/clinic-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  QueueStatus,
  Species,
  VisitStatus,
  VisitType,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateQueueEntryDto,
  UpdateQueueEntryDto,
} from './dto/queue.dto.js';

/** Estados abiertos: la mascota sigue en la clínica. */
export const OPEN_STATUSES: QueueStatus[] = [
  'ARRIVED',
  'WAITING',
  'IN_PROGRESS',
];

/** A qué estado se puede pasar desde cada uno. Atendido y cancelado son finales. */
export const TRANSITIONS: Record<QueueStatus, QueueStatus[]> = {
  ARRIVED: ['WAITING', 'IN_PROGRESS', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING', 'DONE'],
  DONE: [],
  CANCELLED: [],
};

const STATUS_ORDER: Record<QueueStatus, number> = {
  IN_PROGRESS: 0,
  WAITING: 1,
  ARRIVED: 2,
  DONE: 3,
  CANCELLED: 4,
};

export interface QueueItem {
  id: number;
  day: string;
  type: VisitType;
  status: QueueStatus;
  urgent: boolean;
  reason: string | null;
  arrivedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    aggressive: boolean;
    allergies: string | null;
  };
  client: { id: number; number: number; name: string; phone: string };
  attendedBy: { id: number; fullName: string } | null;
  /** Atención abierta o cerrada que salió de esta entrada */
  visit: { id: number; status: VisitStatus } | null;
}

export const QUEUE_ITEM_SELECT = {
  id: true,
  day: true,
  type: true,
  status: true,
  urgent: true,
  reason: true,
  arrivedAt: true,
  startedAt: true,
  finishedAt: true,
  pet: {
    select: {
      id: true,
      number: true,
      name: true,
      species: true,
      aggressive: true,
      allergies: true,
      client: { select: { id: true, number: true, name: true, phone: true } },
    },
  },
  attendedBy: { select: { id: true, fullName: true } },
  // La atención vigente de esta entrada (abierta o cerrada), para abrirla desde la cola
  visits: {
    where: { status: { not: 'CANCELLED' } },
    select: { id: true, status: true },
    orderBy: { id: 'desc' },
    take: 1,
  },
} satisfies Prisma.QueueEntrySelect;

type ItemRow = Prisma.QueueEntryGetPayload<{
  select: typeof QUEUE_ITEM_SELECT;
}>;

@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cola de un día (hoy por defecto): en atención, en espera y llegados; urgencias primero y luego por hora de llegada. */
  async list(
    clinicId: number,
    day?: string,
  ): Promise<{ day: string; items: QueueItem[] }> {
    const date = day ?? (await clinicToday(this.prisma, clinicId));
    const rows = await this.prisma.queueEntry.findMany({
      where: { clinicId, day: toDbDate(date) },
      select: QUEUE_ITEM_SELECT,
      orderBy: [{ urgent: 'desc' }, { arrivedAt: 'asc' }],
    });
    const items = rows
      .map(toQueueItem)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    return { day: date, items };
  }

  async create(actor: AuthUser, dto: CreateQueueEntryDto): Promise<QueueItem> {
    const pet = await this.prisma.pet.findFirst({
      where: { id: dto.petId, clinicId: actor.clinicId },
      select: {
        name: true,
        active: true,
        deceasedAt: true,
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

    const day = await clinicToday(this.prisma, actor.clinicId);
    const open = await this.prisma.queueEntry.findFirst({
      where: {
        clinicId: actor.clinicId,
        petId: dto.petId,
        day: toDbDate(day),
        status: { in: OPEN_STATUSES },
      },
      select: { id: true },
    });
    if (open)
      throw new ConflictException(`${pet.name} ya está en la cola de hoy`);

    const entry = await this.prisma.queueEntry.create({
      data: {
        clinicId: actor.clinicId,
        petId: dto.petId,
        day: toDbDate(day),
        type: dto.type ?? 'CONSULTATION',
        urgent: dto.urgent ?? false,
        reason: dto.reason ?? null,
        createdById: actor.id,
      },
      select: QUEUE_ITEM_SELECT,
    });
    return toQueueItem(entry);
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateQueueEntryDto,
  ): Promise<QueueItem> {
    const current = await this.prisma.queueEntry.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: {
        status: true,
        visits: {
          where: { status: 'OPEN' },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!current) throw new NotFoundException('La atención no existe');
    if (TRANSITIONS[current.status].length === 0)
      throw new ConflictException('Esta atención ya se cerró');

    const data: Prisma.QueueEntryUpdateInput = {};
    if (dto.urgent !== undefined) data.urgent = dto.urgent;
    if (dto.reason !== undefined) data.reason = dto.reason;

    if (dto.status && dto.status !== current.status) {
      if (!TRANSITIONS[current.status].includes(dto.status))
        throw new BadRequestException('No se puede pasar a ese estado');
      // Con una atención abierta, la cola se mueve desde la atención (cerrarla o cancelarla)
      if (current.visits.length)
        throw new ConflictException({
          message:
            'Tiene una atención abierta: ciérrala o cancélala desde la atención',
          visitId: current.visits[0].id,
        });
      data.status = dto.status;
      const now = new Date();
      if (dto.status === 'IN_PROGRESS') {
        data.startedAt = now;
        data.attendedBy = { connect: { id: actor.id } };
      } else if (dto.status === 'WAITING') {
        // Devuelto a espera: se limpia quién lo atendía
        data.startedAt = null;
        data.attendedBy = { disconnect: true };
      } else if (dto.status === 'DONE' || dto.status === 'CANCELLED') {
        data.finishedAt = now;
      }
    }

    const entry = await this.prisma.queueEntry.update({
      where: { id },
      data,
      select: QUEUE_ITEM_SELECT,
    });
    return toQueueItem(entry);
  }
}

export function toQueueItem(row: ItemRow): QueueItem {
  const { visits, ...entry } = row;
  const { client, ...pet } = row.pet;
  return {
    ...entry,
    day: fromDbDate(row.day) as string,
    pet,
    client,
    visit: visits[0] ?? null,
  };
}
