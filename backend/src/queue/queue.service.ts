import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AuditService } from '../common/audit/audit.service.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { fromDbDate, toDbDate } from '../common/time/clinic-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  GroomingTransport,
  QueueStatus,
  Species,
  VisitStatus,
  VisitType,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deliversHome, TransportService } from '../visits/transport.service.js';
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

/**
 * Orden de la cola: primero lo que está en consultorio; después las urgencias, lleguen cuando
 * lleguen; luego en espera y recién llegados, por hora de llegada (el orden de la consulta).
 */
export function queueOrder(
  a: { status: QueueStatus; urgent: boolean },
  b: { status: QueueStatus; urgent: boolean },
): number {
  const inRoom = (x: typeof a) => (x.status === 'IN_PROGRESS' ? 0 : 1);
  const open = (x: typeof a) =>
    x.status === 'DONE' || x.status === 'CANCELLED' ? 1 : 0;
  return (
    open(a) - open(b) ||
    inRoom(a) - inRoom(b) ||
    (inRoom(a) === 1 ? Number(b.urgent) - Number(a.urgent) : 0) ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );
}

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
  transport: GroomingTransport;
  transportAddress: string | null;
  transportPrice: number | null;
  deliveredHomeAt: Date | null;
  deliveredHomeBy: { id: number; fullName: string } | null;
  /** Atendido y falta llevarlo a su casa (lo llevamos / recojo y entrega) */
  homePending: boolean;
  /** Quedó internado: se lleva a casa al darle de alta */
  hospitalized: boolean;
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
  transport: true,
  transportAddress: true,
  transportPrice: true,
  deliveredHomeAt: true,
  deliveredHomeBy: { select: { id: true, fullName: true } },
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport?: TransportService,
    private readonly audit?: AuditService,
  ) {}

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
    // Atendido con entrega a casa que terminó internado: se lleva al darle de alta
    const homeIds = rows
      .filter((r) => r.status === 'DONE' && needsHome(r))
      .map((r) => r.pet.id);
    const admitted = homeIds.length
      ? await this.prisma.hospitalization.findMany({
          where: { clinicId, petId: { in: homeIds }, status: 'ACTIVE' },
          select: { petId: true },
        })
      : [];
    const inside = new Set(admitted.map((h) => h.petId));
    const items = rows
      .map((r) => toQueueItem(r, inside.has(r.pet.id)))
      .sort(queueOrder);
    return { day: date, items };
  }

  async create(actor: AuthUser, dto: CreateQueueEntryDto): Promise<QueueItem> {
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

    const type = dto.type ?? 'CONSULTATION';
    const move = transportOf(dto);
    const data = {
      clinicId: actor.clinicId,
      petId: dto.petId,
      day: toDbDate(day),
      type,
      urgent: dto.urgent ?? false,
      reason: dto.reason ?? null,
      createdById: actor.id,
      ...move,
    };
    // Consulta con movilidad cobrada: el cargo entra a la cuenta ya (la atención la abre el
    // veterinario). El grooming la cobra en su ingreso.
    if (!this.charged(type, move)) {
      const entry = await this.prisma.queueEntry.create({
        data,
        select: QUEUE_ITEM_SELECT,
      });
      return toQueueItem(entry);
    }
    const entry = await this.prisma.$transaction(async (tx) => {
      const chargeId = await this.transport!.syncInTx(tx, actor, {
        clientId: pet.clientId,
        petId: dto.petId,
        visitId: null,
        transport: move.transport,
        price: move.transportPrice,
      });
      return tx.queueEntry.create({
        data: { ...data, transportChargeId: chargeId },
        select: QUEUE_ITEM_SELECT,
      });
    });
    await this.logTransport(actor, entry.id, move);
    return toQueueItem(entry);
  }

  /** Consulta atendida con entrega: ya se dejó en su casa */
  async deliveredHome(actor: AuthUser, id: number): Promise<QueueItem> {
    const current = await this.prisma.queueEntry.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { status: true, transport: true, deliveredHomeAt: true },
    });
    if (!current) throw new NotFoundException('La atención no existe');
    if (!deliversHome(current.transport))
      throw new BadRequestException('Esta atención no tiene entrega a casa');
    if (current.status !== 'DONE')
      throw new ConflictException('Primero termina la atención');
    if (current.deliveredHomeAt)
      throw new ConflictException('Ya se marcó como entregado en casa');
    const entry = await this.prisma.queueEntry.update({
      where: { id },
      data: { deliveredHomeAt: new Date(), deliveredHomeById: actor.id },
      select: QUEUE_ITEM_SELECT,
    });
    await this.audit?.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'queue.delivered_home',
      entity: 'queue',
      entityId: id,
    });
    return toQueueItem(entry);
  }

  /** Consulta con movilidad y precio: lleva cargo */
  private charged(
    type: VisitType,
    move: { transport: GroomingTransport; transportPrice: number | null },
  ) {
    return (
      type === 'CONSULTATION' &&
      move.transport !== 'NONE' &&
      (move.transportPrice ?? 0) > 0
    );
  }

  private async logTransport(
    actor: AuthUser,
    id: number,
    move: { transport: GroomingTransport; transportPrice: number | null },
    extra: Record<string, unknown> = {},
  ) {
    await this.audit?.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'queue.transport',
      entity: 'queue',
      entityId: id,
      data: { transport: move.transport, price: move.transportPrice, ...extra },
    });
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
        type: true,
        petId: true,
        transport: true,
        transportAddress: true,
        transportPrice: true,
        transportChargeId: true,
        deliveredHomeAt: true,
        pet: { select: { clientId: true } },
        visits: {
          where: { status: 'OPEN' },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!current) throw new NotFoundException('La atención no existe');
    const onlyMove =
      dto.status === undefined &&
      dto.urgent === undefined &&
      dto.reason === undefined;
    // Atendido y esperando al dueño: la movilidad aún se puede cambiar ("ya no puede volver,
    // llévenlo"). Lo demás de una atención cerrada, no.
    const doneMove =
      current.status === 'DONE' && onlyMove && !current.deliveredHomeAt;
    if (TRANSITIONS[current.status].length === 0 && !doneMove)
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

    const moveChanged =
      dto.transport !== undefined ||
      dto.transportAddress !== undefined ||
      dto.transportPrice !== undefined;
    const move = moveChanged
      ? transportOf({
          transport: dto.transport ?? current.transport,
          transportAddress:
            dto.transportAddress !== undefined
              ? dto.transportAddress
              : current.transportAddress,
          transportPrice:
            dto.transportPrice !== undefined
              ? dto.transportPrice
              : current.transportPrice === null
                ? null
                : Number(current.transportPrice),
        })
      : null;
    if (move) Object.assign(data, move);
    const cancelling = data.status === 'CANCELLED';
    const touchesCharge =
      current.type === 'CONSULTATION' &&
      ((move &&
        (current.transportChargeId || this.charged('CONSULTATION', move))) ||
        (cancelling && current.transportChargeId));

    if (!touchesCharge) {
      const entry = await this.prisma.queueEntry.update({
        where: { id },
        data,
        select: QUEUE_ITEM_SELECT,
      });
      if (move) await this.logTransport(actor, id, move);
      return toQueueItem(entry);
    }

    const entry = await this.prisma.$transaction(async (tx) => {
      let chargeId = current.transportChargeId;
      if (move)
        chargeId = await this.transport!.syncInTx(tx, actor, {
          clientId: current.pet.clientId,
          petId: current.petId,
          visitId: null,
          transport: move.transport,
          price: move.transportPrice,
          chargeId,
        });
      // Cancelada: la movilidad se quita, salvo que ya se hizo el viaje (se cobra igual)
      if (cancelling && chargeId && !dto.chargeTransport) {
        await this.transport!.syncInTx(tx, actor, {
          clientId: current.pet.clientId,
          petId: current.petId,
          visitId: null,
          transport: 'NONE',
          price: 0,
          chargeId,
        });
        chargeId = null;
      }
      return tx.queueEntry.update({
        where: { id },
        data: { ...data, transportChargeId: chargeId },
        select: QUEUE_ITEM_SELECT,
      });
    });
    if (move || cancelling)
      await this.logTransport(
        actor,
        id,
        move ?? {
          transport: current.transport,
          transportPrice:
            current.transportPrice === null
              ? null
              : Number(current.transportPrice),
        },
        cancelling
          ? { cancelled: true, charged: Boolean(dto.chargeTransport) }
          : {},
      );
    return toQueueItem(entry);
  }
}

/** Movilidad normalizada: sin movilidad no guarda dirección ni precio */
function transportOf(dto: {
  transport?: GroomingTransport;
  transportAddress?: string | null;
  transportPrice?: number | null;
}): {
  transport: GroomingTransport;
  transportAddress: string | null;
  transportPrice: number | null;
} {
  const transport = dto.transport ?? 'NONE';
  if (transport === 'NONE')
    return { transport, transportAddress: null, transportPrice: null };
  const address = dto.transportAddress?.trim() ?? '';
  if (address.length < 5)
    throw new BadRequestException('Indica la dirección de recojo o entrega');
  const price = dto.transportPrice ?? null;
  return {
    transport,
    transportAddress: address.slice(0, 200),
    transportPrice: price && price > 0 ? price : null,
  };
}

function needsHome(row: {
  transport: GroomingTransport;
  deliveredHomeAt: Date | null;
}) {
  return deliversHome(row.transport) && !row.deliveredHomeAt;
}

export function toQueueItem(row: ItemRow, hospitalized = false): QueueItem {
  const { visits, ...entry } = row;
  const { client, ...pet } = row.pet;
  const pending = row.status === 'DONE' && needsHome(row);
  return {
    ...entry,
    day: fromDbDate(row.day) as string,
    pet,
    client,
    visit: visits[0] ?? null,
    transportPrice:
      row.transportPrice === null ? null : Number(row.transportPrice),
    homePending: pending && !hospitalized,
    hospitalized: pending && hospitalized,
  };
}
