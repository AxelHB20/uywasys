import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import {
  hospitalizationCode,
  reserveNumbers,
} from '../common/sequence/clinic-sequence.js';
import { clinicDay, toDbDate } from '../common/time/clinic-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { GroomingTransport } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OPEN_STATUSES } from '../queue/queue.service.js';
import { ChargesService } from '../visits/charges.service.js';
import type { CreateChargesDto } from '../visits/dto/charge.dto.js';
import { VisitsService } from '../visits/visits.service.js';
import type {
  AdmitDto,
  DischargeDto,
  EntryDto,
  OrderDto,
  UpdateHospitalizationDto,
} from './dto/hospitalization.dto.js';
import { daysBetween, slotsOf } from './hospitalization-slots.js';
import type { Slot } from './hospitalization-slots.js';

type Tx = Prisma.TransactionClient;
const HOUR = 3_600_000;

const CARD_SELECT = {
  id: true,
  number: true,
  status: true,
  voluntary: true,
  cage: true,
  reason: true,
  diagnosis: true,
  admittedAt: true,
  dischargedAt: true,
  visitId: true,
  pet: {
    select: {
      id: true,
      name: true,
      species: true,
      breed: true,
      weightKg: true,
      allergies: true,
      aggressive: true,
    },
  },
  client: { select: { id: true, name: true, phone: true } },
  vet: { select: { id: true, fullName: true } },
  orders: {
    select: {
      id: true,
      kind: true,
      description: true,
      dose: true,
      route: true,
      everyHours: true,
      startsAt: true,
      endsAt: true,
      stoppedAt: true,
      notes: true,
      createdAt: true,
      createdBy: { select: { id: true, fullName: true } },
      careServiceId: true,
      productId: true,
      presentationId: true,
      careService: { select: { name: true, price: true } },
      product: { select: { name: true } },
      presentation: { select: { name: true, price: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.HospitalizationSelect;

type CardRow = Prisma.HospitalizationGetPayload<{ select: typeof CARD_SELECT }>;

export interface SlotView {
  at: Date;
  state: Slot['state'];
  doneAt: Date | null;
}

export interface VitalsView {
  at: Date;
  temperatureC: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  weightKg: number | null;
  mucosa: string | null;
}

export interface HospitalizationCard {
  id: number;
  number: number;
  code: string;
  status: CardRow['status'];
  /** Alta voluntaria (el dueño lo retiró antes del alta médica) */
  voluntary: boolean;
  cage: string | null;
  reason: string;
  diagnosis: string | null;
  admittedAt: Date;
  dischargedAt: Date | null;
  days: number;
  visitId: number;
  pet: Omit<CardRow['pet'], 'weightKg'> & { weightKg: number | null };
  client: CardRow['client'];
  vet: CardRow['vet'];
  activeOrders: number;
  overdue: number;
  due: number;
  next: { at: Date; description: string } | null;
  lastVitals: VitalsView | null;
}

export interface OrderView {
  id: number;
  kind: CardRow['orders'][number]['kind'];
  description: string;
  dose: string | null;
  route: string | null;
  everyHours: number | null;
  startsAt: Date;
  endsAt: Date | null;
  stoppedAt: Date | null;
  notes: string | null;
  active: boolean;
  createdBy: { id: number; fullName: string };
  slots: SlotView[];
  /** Cobrar aparte: qué se cobra y cuánto ya está en la cuenta de la atención */
  bill: {
    careServiceId: number | null;
    productId: number | null;
    presentationId: number | null;
    description: string;
    unitPrice: number;
    alreadyCharged: number;
  } | null;
}

export interface EntryView {
  id: number;
  kind: 'DOSE' | 'VITALS' | 'NOTE';
  at: Date;
  order: { id: number; description: string } | null;
  scheduledAt: Date | null;
  skipped: boolean;
  temperatureC: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  weightKg: number | null;
  mucosa: string | null;
  notes: string | null;
  by: { id: number; fullName: string };
}

export interface HospitalizationDetail extends HospitalizationCard {
  window: { from: Date; to: Date };
  orders: OrderView[];
  entries: EntryView[];
  vitals: VitalsView[];
  account: { total: number; pending: number; lines: number };
  /** Recetas vigentes de la atención (al dar de alta: "¿receta para casa?") */
  prescriptions: number;
  dischargeNotes: string | null;
  daysCharged: number | null;
  dischargedBy: { id: number; fullName: string } | null;
  /** Llegó a consulta con entrega a casa: al darle de alta se lo llevan (cola de ese día) */
  homeDelivery: {
    queueEntryId: number;
    transport: GroomingTransport;
    address: string | null;
    deliveredAt: Date | null;
  } | null;
}

interface DoseRow {
  orderId: number | null;
  scheduledAt: Date | null;
  skipped: boolean;
  at: Date;
}

const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

/** Ventana de la hoja: 24 h atrás y 24 h adelante (sin empezar antes del ingreso) */
function windowOf(admittedAt: Date, now: Date) {
  const from = new Date(
    Math.max(admittedAt.getTime() - HOUR, now.getTime() - 24 * HOUR),
  );
  return { from, to: new Date(now.getTime() + 24 * HOUR) };
}

/**
 * Hospitalización: el paciente internado tiene su propia atención (tipo HOSPITALIZATION) donde
 * se cargan medicamentos y procedimientos; la hoja de tratamiento dice qué toca a cada hora y
 * el alta cobra los días de estancia y cierra la atención (lo pendiente pasa a "Por cobrar").
 */
@Injectable()
export class HospitalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visits: VisitsService,
    private readonly charges: ChargesService,
    private readonly audit: AuditService,
  ) {}

  async board(
    clinicId: number,
    recentDays = 3,
  ): Promise<HospitalizationCard[]> {
    const since = new Date(Date.now() - recentDays * 24 * HOUR);
    const rows = await this.prisma.hospitalization.findMany({
      where: {
        clinicId,
        OR: [{ status: 'ACTIVE' }, { dischargedAt: { gte: since } }],
      },
      select: CARD_SELECT,
      orderBy: [{ status: 'asc' }, { admittedAt: 'asc' }],
    });
    const { doses, vitals } = await this.marks(rows.map((r) => r.id));
    const now = new Date();
    return rows.map((row) =>
      this.toCard(
        row,
        doses.get(row.id) ?? [],
        vitals.get(row.id) ?? null,
        now,
      ),
    );
  }

  /** Para el inicio: internados y dosis atrasadas */
  async summary(
    clinicId: number,
  ): Promise<{ active: number; overdue: number }> {
    const cards = (await this.board(clinicId, 0)).filter(
      (c) => c.status === 'ACTIVE',
    );
    return {
      active: cards.length,
      overdue: cards.reduce((s, c) => s + c.overdue, 0),
    };
  }

  async get(clinicId: number, id: number): Promise<HospitalizationDetail> {
    const row = await this.prisma.hospitalization.findFirst({
      where: { id, clinicId },
      select: {
        ...CARD_SELECT,
        dischargeNotes: true,
        daysCharged: true,
        dischargedBy: { select: { id: true, fullName: true } },
        entries: {
          select: {
            id: true,
            kind: true,
            at: true,
            scheduledAt: true,
            skipped: true,
            temperatureC: true,
            heartRate: true,
            respiratoryRate: true,
            weightKg: true,
            mucosa: true,
            notes: true,
            orderId: true,
            order: { select: { id: true, description: true } },
            by: { select: { id: true, fullName: true } },
          },
          orderBy: { at: 'desc' },
          take: 300,
        },
        visit: {
          select: {
            charges: {
              where: { status: { not: 'VOID' } },
              select: {
                total: true,
                paidAmount: true,
                quantity: true,
                careServiceId: true,
                productId: true,
              },
            },
            _count: {
              select: { prescriptions: { where: { voidedAt: null } } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Internamiento no encontrado');
    const now = new Date();
    const doses: DoseRow[] = row.entries.filter((e) => e.kind === 'DOSE');
    const vitals = row.entries
      .filter((e) => e.kind === 'VITALS')
      .map((e) => this.vitalsOf(e));
    const card = this.toCard(row, doses, vitals[0] ?? null, now);
    const window = windowOf(row.admittedAt, this.endOf(row, now));
    const charges = row.visit.charges;
    // La consulta de la que vino (ese día o el anterior) tenía "lo llevamos" o "recojo y entrega"
    const home = await this.prisma.queueEntry.findFirst({
      where: {
        clinicId,
        petId: row.pet.id,
        transport: { in: ['DROPOFF', 'ROUND_TRIP'] },
        arrivedAt: {
          gte: new Date(row.admittedAt.getTime() - 24 * HOUR),
          lte: row.admittedAt,
        },
      },
      orderBy: { arrivedAt: 'desc' },
      select: {
        id: true,
        transport: true,
        transportAddress: true,
        deliveredHomeAt: true,
      },
    });
    return {
      ...card,
      window,
      orders: row.orders.map((o) => ({
        id: o.id,
        kind: o.kind,
        description: o.description,
        dose: o.dose,
        route: o.route,
        everyHours: o.everyHours,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        stoppedAt: o.stoppedAt,
        notes: o.notes,
        createdBy: o.createdBy,
        bill: billOf(o, charges),
        active: row.status === 'ACTIVE' && this.isActive(o, now),
        slots: slotsOf(
          o,
          doses.filter((d) => d.orderId === o.id),
          window.from,
          row.status === 'ACTIVE' ? window.to : (row.dischargedAt ?? now),
          now,
        ),
      })),
      entries: row.entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        at: e.at,
        order: e.order,
        scheduledAt: e.scheduledAt,
        skipped: e.skipped,
        temperatureC: num(e.temperatureC),
        heartRate: e.heartRate,
        respiratoryRate: e.respiratoryRate,
        weightKg: num(e.weightKg),
        mucosa: e.mucosa,
        notes: e.notes,
        by: e.by,
      })),
      vitals,
      account: {
        total: round2(charges.reduce((s, c) => s + Number(c.total), 0)),
        pending: round2(
          charges.reduce(
            (s, c) => s + Number(c.total) - Number(c.paidAmount),
            0,
          ),
        ),
        lines: charges.length,
      },
      prescriptions: row.visit._count.prescriptions,
      dischargeNotes: row.dischargeNotes,
      daysCharged: row.daysCharged,
      dischargedBy: row.dischargedBy,
      homeDelivery: home
        ? {
            queueEntryId: home.id,
            transport: home.transport,
            address: home.transportAddress,
            deliveredAt: home.deliveredHomeAt,
          }
        : null,
    };
  }

  async admit(
    actor: AuthUser,
    dto: AdmitDto,
    ip?: string,
  ): Promise<HospitalizationDetail> {
    const vetId = dto.vetId ?? (actor.role === 'VET' ? actor.id : null);
    if (!vetId)
      throw new BadRequestException('Elige el veterinario responsable');
    await this.checkVet(actor.clinicId, vetId);

    const { id, visitId } = await this.prisma.$transaction(async (tx) => {
      // Desde una consulta: se cierra (lo pendiente queda por cobrar) y el internamiento sigue
      if (dto.fromVisitId) await this.closeConsultation(tx, actor, dto);
      const visitId = await this.visits.openInTx(tx, actor, {
        petId: dto.petId,
        type: 'HOSPITALIZATION',
        reason: dto.reason,
      });
      await tx.visit.update({
        where: { id: visitId },
        data: { diagnosis: dto.diagnosis ?? null },
      });
      const visit = await tx.visit.findUniqueOrThrow({
        where: { id: visitId },
        select: { clientId: true },
      });
      const number = await reserveNumbers(
        tx,
        actor.clinicId,
        'hospitalization',
      );
      const row = await tx.hospitalization.create({
        data: {
          clinicId: actor.clinicId,
          number,
          petId: dto.petId,
          clientId: visit.clientId,
          visitId,
          vetId,
          cage: dto.cage ?? null,
          reason: dto.reason,
          diagnosis: dto.diagnosis ?? null,
          admittedById: actor.id,
        },
        select: { id: true },
      });
      return { id: row.id, visitId };
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'hospitalization.admit',
      entity: 'hospitalization',
      entityId: id,
      ip,
      data: { petId: dto.petId, visitId, fromVisitId: dto.fromVisitId ?? null },
    });
    return this.get(actor.clinicId, id);
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateHospitalizationDto,
  ): Promise<HospitalizationDetail> {
    const row = await this.active(actor.clinicId, id);
    if (dto.vetId) await this.checkVet(actor.clinicId, dto.vetId);
    await this.prisma.$transaction(async (tx) => {
      await tx.hospitalization.update({
        where: { id },
        data: {
          ...(dto.vetId ? { vetId: dto.vetId } : {}),
          ...(dto.cage !== undefined ? { cage: dto.cage } : {}),
          ...(dto.reason ? { reason: dto.reason } : {}),
          ...(dto.diagnosis !== undefined ? { diagnosis: dto.diagnosis } : {}),
        },
      });
      if (dto.diagnosis !== undefined)
        await tx.visit.update({
          where: { id: row.visitId },
          data: { diagnosis: dto.diagnosis },
        });
    });
    return this.get(actor.clinicId, id);
  }

  async addOrder(
    actor: AuthUser,
    id: number,
    dto: OrderDto,
    ip?: string,
  ): Promise<HospitalizationDetail> {
    await this.active(actor.clinicId, id);
    const bill = await this.checkBill(actor.clinicId, dto);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    if (startsAt.getTime() < Date.now() - 24 * HOUR)
      throw new BadRequestException(
        'La primera dosis no puede ser de hace más de un día',
      );
    const order = await this.prisma.hospitalizationOrder.create({
      data: {
        clinicId: actor.clinicId,
        hospitalizationId: id,
        kind: dto.kind,
        description: dto.description,
        dose: dto.dose ?? null,
        route: dto.route ?? null,
        everyHours: dto.everyHours ?? null,
        startsAt,
        endsAt: dto.durationDays
          ? new Date(startsAt.getTime() + dto.durationDays * 24 * HOUR)
          : null,
        notes: dto.notes ?? null,
        ...bill,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'hospitalization.order',
      entity: 'hospitalization',
      entityId: id,
      ip,
      data: {
        orderId: order.id,
        description: dto.description,
        everyHours: dto.everyHours ?? null,
        ...bill,
      },
    });
    return this.get(actor.clinicId, id);
  }

  async stopOrder(
    actor: AuthUser,
    id: number,
    orderId: number,
    ip?: string,
  ): Promise<HospitalizationDetail> {
    await this.active(actor.clinicId, id);
    const order = await this.prisma.hospitalizationOrder.findFirst({
      where: { id: orderId, hospitalizationId: id },
      select: { stoppedAt: true },
    });
    if (!order) throw new NotFoundException('Indicación no encontrada');
    if (order.stoppedAt)
      throw new ConflictException('La indicación ya estaba suspendida');
    await this.prisma.hospitalizationOrder.update({
      where: { id: orderId },
      data: { stoppedAt: new Date(), stoppedById: actor.id },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'hospitalization.order_stop',
      entity: 'hospitalization',
      entityId: id,
      ip,
      data: { orderId },
    });
    return this.get(actor.clinicId, id);
  }

  async addEntry(
    actor: AuthUser,
    id: number,
    dto: EntryDto,
  ): Promise<HospitalizationDetail> {
    const current = await this.active(actor.clinicId, id);
    let scheduledAt: Date | null = null;
    let at: Date | undefined;
    if (dto.kind === 'DOSE' && dto.givenAt) {
      at = new Date(dto.givenAt);
      const now = Date.now();
      if (at.getTime() > now + 2 * 60_000)
        throw new BadRequestException(
          'La hora en que se dio no puede ser futura',
        );
      if (
        at.getTime() < now - 24 * HOUR ||
        at.getTime() < current.admittedAt.getTime() - 60_000
      )
        throw new BadRequestException(
          'La hora en que se dio debe ser de las últimas 24 horas',
        );
    }
    if (dto.kind === 'DOSE') {
      const order = await this.prisma.hospitalizationOrder.findFirst({
        where: { id: dto.orderId, hospitalizationId: id },
        select: { stoppedAt: true },
      });
      if (!order) throw new NotFoundException('Indicación no encontrada');
      if (order.stoppedAt)
        throw new ConflictException('La indicación está suspendida');
      if (dto.scheduledAt) {
        scheduledAt = new Date(dto.scheduledAt);
        const taken = await this.prisma.hospitalizationEntry.findFirst({
          where: {
            orderId: dto.orderId,
            scheduledAt: {
              gte: new Date(scheduledAt.getTime() - 60_000),
              lte: new Date(scheduledAt.getTime() + 60_000),
            },
          },
          select: { by: { select: { fullName: true } } },
        });
        if (taken)
          throw new ConflictException(
            `Esa dosis ya la registró ${taken.by.fullName}`,
          );
      }
    }
    if (
      dto.kind === 'VITALS' &&
      [
        dto.temperatureC,
        dto.heartRate,
        dto.respiratoryRate,
        dto.weightKg,
        dto.mucosa,
      ].every((v) => v === null || v === undefined)
    )
      throw new BadRequestException('Registra al menos un signo vital');

    await this.prisma.hospitalizationEntry.create({
      data: {
        clinicId: actor.clinicId,
        hospitalizationId: id,
        kind: dto.kind,
        orderId: dto.kind === 'DOSE' ? dto.orderId : null,
        scheduledAt,
        skipped: dto.kind === 'DOSE' ? (dto.skipped ?? false) : false,
        temperatureC: dto.kind === 'VITALS' ? (dto.temperatureC ?? null) : null,
        heartRate: dto.kind === 'VITALS' ? (dto.heartRate ?? null) : null,
        respiratoryRate:
          dto.kind === 'VITALS' ? (dto.respiratoryRate ?? null) : null,
        weightKg: dto.kind === 'VITALS' ? (dto.weightKg ?? null) : null,
        mucosa: dto.kind === 'VITALS' ? (dto.mucosa ?? null) : null,
        notes: dto.notes ?? null,
        ...(at ? { at } : {}),
        byId: actor.id,
      },
    });
    return this.get(actor.clinicId, id);
  }

  /**
   * Alta (o fallecimiento): cobra los días de estancia, suspende las indicaciones y cierra la
   * atención. Lo que no se pagó queda en "Por cobrar" como cualquier otra atención.
   */
  async discharge(
    actor: AuthUser,
    id: number,
    dto: DischargeDto,
    ip?: string,
  ): Promise<HospitalizationDetail> {
    const current = await this.active(actor.clinicId, id);
    const now = new Date();
    const days = dto.days ?? daysBetween(current.admittedAt, now);
    if (dto.careServiceId) {
      const service = await this.prisma.careService.findFirst({
        where: {
          id: dto.careServiceId,
          clinicId: actor.clinicId,
          active: true,
        },
        select: { name: true, category: true },
      });
      if (!service)
        throw new NotFoundException('El servicio no existe o está inactivo');
      if (service.category !== 'HOSPITALIZATION')
        throw new BadRequestException(
          `${service.name} no es un servicio de hospitalización`,
        );
    }
    // Lo que se cobra aparte: solo indicaciones de este internamiento con su cobro elegido
    const extras = await this.extrasOf(id, dto.extras ?? []);
    const items: CreateChargesDto['items'] = [
      ...(dto.careServiceId
        ? [{ careServiceId: dto.careServiceId, quantity: days }]
        : []),
      ...extras,
    ];
    const prep = items.length ? await this.charges.prepare(actor) : null;
    const status = dto.outcome === 'DECEASED' ? 'DECEASED' : 'DISCHARGED';
    const tz =
      dto.outcome === 'DECEASED' ? await this.timezone(actor.clinicId) : null;

    const created = await this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string }[]>`
          SELECT status FROM hospitalizations WHERE id = ${id} FOR UPDATE`;
        if (locked?.status !== 'ACTIVE')
          throw new ConflictException('El paciente ya fue dado de alta');
        const created =
          items.length && prep
            ? await this.charges.createInTx(
                tx,
                actor,
                { visitId: current.visitId, items } as CreateChargesDto,
                prep,
              )
            : null;
        await tx.hospitalizationOrder.updateMany({
          where: { hospitalizationId: id, stoppedAt: null },
          data: { stoppedAt: now, stoppedById: actor.id },
        });
        await tx.hospitalization.update({
          where: { id },
          data: {
            status,
            voluntary: dto.outcome === 'VOLUNTARY',
            dischargedAt: now,
            dischargedById: actor.id,
            dischargeNotes: dto.notes ?? null,
            daysCharged: dto.careServiceId ? days : null,
          },
        });
        const visit = await tx.visit.update({
          where: { id: current.visitId },
          data: {
            status: 'CLOSED',
            closedAt: now,
            closedById: actor.id,
            ...(dto.notes ? { notes: dto.notes } : {}),
          },
          select: { queueEntryId: true },
        });
        if (visit.queueEntryId)
          await tx.queueEntry.updateMany({
            where: { id: visit.queueEntryId, status: { in: OPEN_STATUSES } },
            data: { status: 'DONE', finishedAt: now },
          });
        if (tz)
          await tx.pet.update({
            where: { id: current.petId },
            data: { deceasedAt: toDbDate(clinicDay(tz, now)), active: false },
          });
        return created;
      },
      { timeout: 20_000 },
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'hospitalization.discharge',
      entity: 'hospitalization',
      entityId: id,
      ip,
      data: {
        outcome: dto.outcome,
        days,
        careServiceId: dto.careServiceId ?? null,
        extras: extras.length,
      },
    });
    if (created)
      await this.charges.logCreated(actor, current.visitId, created, ip);
    return this.get(actor.clinicId, id);
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  /** Cobrar aparte: el servicio o la presentación existen, se pueden cobrar y no son controlados */
  private async checkBill(
    clinicId: number,
    dto: OrderDto,
  ): Promise<{
    careServiceId: number | null;
    productId: number | null;
    presentationId: number | null;
  }> {
    const none = { careServiceId: null, productId: null, presentationId: null };
    if (dto.careServiceId && dto.productId)
      throw new BadRequestException(
        'Elige un servicio o un producto, no ambos',
      );
    if (dto.careServiceId) {
      const service = await this.prisma.careService.findFirst({
        where: { id: dto.careServiceId, clinicId, active: true },
        select: {
          name: true,
          category: true,
          supplies: { select: { product: { select: { controlled: true } } } },
        },
      });
      if (!service)
        throw new NotFoundException('El servicio no existe o está inactivo');
      if (
        service.category === 'GROOMING' ||
        service.category === 'HOSPITALIZATION'
      )
        throw new BadRequestException(
          `${service.name} no se cobra por dosis (la estancia se elige al dar de alta)`,
        );
      if (service.supplies.some((x) => x.product.controlled))
        throw new BadRequestException(
          `${service.name} usa un controlado: cárgalo en Atención y cuenta con su receta`,
        );
      return { ...none, careServiceId: dto.careServiceId };
    }
    if (dto.productId) {
      const presentation = await this.prisma.productPresentation.findFirst({
        where: {
          id: dto.presentationId ?? 0,
          productId: dto.productId,
          clinicId,
          active: true,
          price: { not: null },
        },
        select: {
          product: {
            select: {
              name: true,
              active: true,
              chargeable: true,
              controlled: true,
            },
          },
        },
      });
      if (
        !presentation ||
        !presentation.product.active ||
        !presentation.product.chargeable
      )
        throw new NotFoundException('El producto no existe o no se vende');
      if (presentation.product.controlled)
        throw new BadRequestException(
          `${presentation.product.name} es controlado: cárgalo en Atención y cuenta con su receta`,
        );
      return {
        careServiceId: null,
        productId: dto.productId,
        presentationId: dto.presentationId ?? null,
      };
    }
    return none;
  }

  /** Líneas de cobro de lo dado en la hoja (solo indicaciones de este internamiento con cobro) */
  private async extrasOf(
    hospitalizationId: number,
    extras: { orderId: number; quantity: number }[],
  ): Promise<CreateChargesDto['items']> {
    if (!extras.length) return [];
    const ids = [...new Set(extras.map((e) => e.orderId))];
    if (ids.length !== extras.length)
      throw new BadRequestException('Una indicación se repite en el cobro');
    const orders = await this.prisma.hospitalizationOrder.findMany({
      where: { id: { in: ids }, hospitalizationId },
      select: {
        id: true,
        description: true,
        careServiceId: true,
        productId: true,
        presentationId: true,
      },
    });
    return extras.map((e) => {
      const o = orders.find((x) => x.id === e.orderId);
      if (!o) throw new NotFoundException('Indicación no encontrada');
      if (o.careServiceId)
        return { careServiceId: o.careServiceId, quantity: e.quantity };
      if (o.productId && o.presentationId)
        return {
          productId: o.productId,
          presentationId: o.presentationId,
          quantity: e.quantity,
        };
      throw new BadRequestException(`«${o.description}» no tiene cobro aparte`);
    });
  }

  private toCard(
    row: CardRow,
    doses: DoseRow[],
    lastVitals: VitalsView | null,
    now: Date,
  ): HospitalizationCard {
    const active = row.status === 'ACTIVE';
    const window = windowOf(row.admittedAt, now);
    let overdue = 0;
    let due = 0;
    let next: HospitalizationCard['next'] = null;
    if (active)
      for (const order of row.orders) {
        const slots = slotsOf(
          order,
          doses.filter((d) => d.orderId === order.id),
          window.from,
          window.to,
          now,
        );
        for (const slot of slots) {
          if (slot.state === 'OVERDUE') overdue++;
          if (slot.state === 'DUE') due++;
          if (
            (slot.state === 'DUE' || slot.state === 'PENDING') &&
            (!next || slot.at < next.at)
          )
            next = { at: slot.at, description: order.description };
        }
      }
    return {
      id: row.id,
      number: row.number,
      code: hospitalizationCode(row.number),
      status: row.status,
      voluntary: row.voluntary,
      cage: row.cage,
      reason: row.reason,
      diagnosis: row.diagnosis,
      admittedAt: row.admittedAt,
      dischargedAt: row.dischargedAt,
      days: daysBetween(row.admittedAt, row.dischargedAt ?? now),
      visitId: row.visitId,
      pet: { ...row.pet, weightKg: num(row.pet.weightKg) },
      client: row.client,
      vet: row.vet,
      activeOrders: active
        ? row.orders.filter((o) => this.isActive(o, now)).length
        : 0,
      overdue,
      due,
      next,
      lastVitals,
    };
  }

  private isActive(
    order: { stoppedAt: Date | null; endsAt: Date | null },
    now: Date,
  ): boolean {
    return !order.stoppedAt && (!order.endsAt || order.endsAt > now);
  }

  private endOf(row: { status: string; dischargedAt: Date | null }, now: Date) {
    return row.status === 'ACTIVE' ? now : (row.dischargedAt ?? now);
  }

  private vitalsOf(e: {
    at: Date;
    temperatureC: Prisma.Decimal | null;
    heartRate: number | null;
    respiratoryRate: number | null;
    weightKg: Prisma.Decimal | null;
    mucosa: string | null;
  }): VitalsView {
    return {
      at: e.at,
      temperatureC: num(e.temperatureC),
      heartRate: e.heartRate,
      respiratoryRate: e.respiratoryRate,
      weightKg: num(e.weightKg),
      mucosa: e.mucosa,
    };
  }

  /** Dosis de las últimas 48 h y los últimos signos vitales de cada internamiento */
  private async marks(ids: number[]) {
    const doses = new Map<number, DoseRow[]>();
    const vitals = new Map<number, VitalsView>();
    if (!ids.length) return { doses, vitals };
    const since = new Date(Date.now() - 48 * HOUR);
    const rows = await this.prisma.hospitalizationEntry.findMany({
      where: {
        hospitalizationId: { in: ids },
        OR: [{ kind: 'DOSE', at: { gte: since } }, { kind: 'VITALS' }],
      },
      select: {
        hospitalizationId: true,
        kind: true,
        orderId: true,
        scheduledAt: true,
        skipped: true,
        at: true,
        temperatureC: true,
        heartRate: true,
        respiratoryRate: true,
        weightKg: true,
        mucosa: true,
      },
      orderBy: { at: 'desc' },
    });
    for (const r of rows) {
      if (r.kind === 'DOSE') {
        const list = doses.get(r.hospitalizationId) ?? [];
        list.push(r);
        doses.set(r.hospitalizationId, list);
      } else if (!vitals.has(r.hospitalizationId)) {
        vitals.set(r.hospitalizationId, this.vitalsOf(r));
      }
    }
    return { doses, vitals };
  }

  private async active(clinicId: number, id: number) {
    const row = await this.prisma.hospitalization.findFirst({
      where: { id, clinicId },
      select: { status: true, visitId: true, petId: true, admittedAt: true },
    });
    if (!row) throw new NotFoundException('Internamiento no encontrado');
    if (row.status !== 'ACTIVE')
      throw new ConflictException('El paciente ya fue dado de alta');
    return row;
  }

  private async closeConsultation(tx: Tx, actor: AuthUser, dto: AdmitDto) {
    const [visit] = await tx.$queryRaw<
      { pet_id: number; status: string; queue_entry_id: number | null }[]
    >`SELECT pet_id, status, queue_entry_id FROM visits
      WHERE id = ${dto.fromVisitId} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
    if (!visit) throw new NotFoundException('La atención no existe');
    if (visit.pet_id !== dto.petId)
      throw new BadRequestException('La atención es de otra mascota');
    if (visit.status !== 'OPEN') return;
    const special = await tx.visit.findUniqueOrThrow({
      where: { id: dto.fromVisitId },
      select: {
        grooming: { select: { id: true } },
        hospitalization: { select: { id: true } },
      },
    });
    if (special.grooming || special.hospitalization)
      throw new ConflictException(
        'Esa atención no se puede convertir en internamiento',
      );
    const now = new Date();
    await tx.visit.update({
      where: { id: dto.fromVisitId },
      data: { status: 'CLOSED', closedAt: now, closedById: actor.id },
    });
    if (visit.queue_entry_id)
      await tx.queueEntry.updateMany({
        where: { id: visit.queue_entry_id, status: { in: OPEN_STATUSES } },
        data: { status: 'DONE', finishedAt: now },
      });
  }

  private async checkVet(clinicId: number, id: number) {
    const ok = await this.prisma.user.count({
      where: { id, clinicId, active: true, role: { in: ['VET', 'ADMIN'] } },
    });
    if (!ok) throw new BadRequestException('Elige un veterinario activo');
  }

  private async timezone(clinicId: number) {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    return timezone;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cobro aparte de una indicación, con lo que ya está en la cuenta (cargado a mano) */
function billOf(
  o: CardRow['orders'][number],
  charges: {
    quantity: Prisma.Decimal;
    careServiceId: number | null;
    productId: number | null;
  }[],
): OrderView['bill'] {
  if (o.careServiceId && o.careService)
    return {
      careServiceId: o.careServiceId,
      productId: null,
      presentationId: null,
      description: o.careService.name,
      unitPrice: Number(o.careService.price),
      alreadyCharged: sumQty(
        charges.filter((c) => c.careServiceId === o.careServiceId),
      ),
    };
  if (o.productId && o.product && o.presentation)
    return {
      careServiceId: null,
      productId: o.productId,
      presentationId: o.presentationId,
      description: `${o.product.name} · ${o.presentation.name}`,
      unitPrice: Number(o.presentation.price ?? 0),
      alreadyCharged: sumQty(
        charges.filter((c) => c.productId === o.productId),
      ),
    };
  return null;
}

function sumQty(rows: { quantity: Prisma.Decimal }[]): number {
  return (
    Math.round(rows.reduce((s, r) => s + Number(r.quantity), 0) * 1000) / 1000
  );
}
