import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { normalizeSearch } from '../common/text/search.js';
import {
  clinicDay,
  fromDbDate,
  startOfDayIn,
} from '../common/time/clinic-day.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Role, VisitType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OPEN_STATUSES } from '../queue/queue.service.js';
import { latestDoses } from '../medical/latest-doses.js';
import { clinicLogoUrl } from '../auth/session-user.js';
import { addDays } from '../reports/report-period.js';
import type {
  AddendumDto,
  CancelVisitDto,
  ListVisitsQuery,
  OpenVisitDto,
  UpdateVisitDto,
} from './dto/visit.dto.js';
import {
  VISIT_DETAIL_SELECT,
  VISIT_HISTORY_SELECT,
  VISIT_SUMMARY_SELECT,
  lockVisit,
  toVisitDetail,
  toVisitHistoryItem,
  toVisitSummary,
} from './visit.views.js';
import type {
  PetHistory,
  VisitContext,
  VisitDetail,
  VisitSummary,
} from './visit.views.js';

const clinicalForbidden = () =>
  new ForbiddenException(
    'La historia clínica solo la ven veterinario, recepción y administrador',
  );

const PAGE_SIZE = 20;

/** Campos del SOAP que se guardan tal cual (null borra) */
/** Cuántos diagnósticos se sugieren */
const DIAGNOSIS_SUGGESTIONS = 40;
/** Tope de atenciones en la historia impresa */
const HISTORY_LIMIT = 300;

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

    // Una consulta (o internamiento) y un grooming pueden ir a la vez: el veterinario manda la
    // mascota al baño sin cerrar su consulta. Dos del mismo lado, no.
    const grooming = dto.type === 'GROOMING';
    const open = await tx.visit.findFirst({
      where: {
        clinicId: actor.clinicId,
        petId: dto.petId,
        status: 'OPEN',
        type: grooming ? 'GROOMING' : { not: 'GROOMING' },
      },
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

  /**
   * Historia clínica: caja no la ve (cobra desde la cuenta del cliente) y el groomer solo abre las
   * atenciones de grooming.
   */
  async get(clinicId: number, id: number, role?: Role): Promise<VisitDetail> {
    if (role === 'CASHIER') throw clinicalForbidden();
    const row = await this.prisma.visit.findFirst({
      where: {
        id,
        clinicId,
        ...(role === 'GROOMER' ? { type: 'GROOMING' } : {}),
      },
      select: VISIT_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException('La atención no existe');
    return toVisitDetail(row);
  }

  /**
   * Diagnósticos que la clínica más usó en el último año, para sugerirlos al escribir.
   * Se agrupan sin distinguir mayúsculas; se muestra la forma más usada.
   */
  async diagnoses(clinicId: number, role?: Role): Promise<string[]> {
    if (role === 'CASHIER' || role === 'GROOMER') throw clinicalForbidden();
    const rows = await this.prisma.$queryRaw<
      { diagnosis: string }[]
    >(Prisma.sql`
      SELECT mode() WITHIN GROUP (ORDER BY trim(diagnosis)) AS diagnosis
      FROM visits
      WHERE clinic_id = ${clinicId}
        AND diagnosis IS NOT NULL AND trim(diagnosis) <> ''
        AND status <> 'CANCELLED' AND type <> 'GROOMING'
        AND opened_at > now() - interval '365 days'
      GROUP BY lower(trim(diagnosis))
      ORDER BY count(*) DESC, 1
      LIMIT ${DIAGNOSIS_SUGGESTIONS}`);
    return rows.map((r) => r.diagnosis);
  }

  /** Historia completa de la mascota para imprimir o derivar a otro veterinario. */
  async history(
    clinicId: number,
    petId: number,
    role?: Role,
  ): Promise<PetHistory> {
    if (role === 'CASHIER' || role === 'GROOMER') throw clinicalForbidden();
    const pet = await this.prisma.pet.findFirst({
      where: { id: petId, clinicId },
      select: {
        id: true,
        number: true,
        name: true,
        species: true,
        breed: true,
        sex: true,
        birthDate: true,
        allergies: true,
        client: { select: { id: true, name: true, phone: true } },
        clinic: {
          select: {
            name: true,
            address: true,
            phone: true,
            logoMime: true,
            logoUpdatedAt: true,
          },
        },
      },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    const [visits, weighed] = await Promise.all([
      this.prisma.visit.findMany({
        where: {
          clinicId,
          petId,
          status: { not: 'CANCELLED' },
          type: { not: 'GROOMING' },
        },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        select: VISIT_HISTORY_SELECT,
        take: HISTORY_LIMIT,
      }),
      this.weightsOf(clinicId, petId),
    ]);
    const { client, clinic, birthDate, ...rest } = pet;
    return {
      clinic: {
        name: clinic.name,
        address: clinic.address,
        phone: clinic.phone,
        logoUrl: clinicLogoUrl(clinic),
      },
      pet: { ...rest, birthDate: fromDbDate(birthDate) },
      client,
      weights: weighed,
      visits: visits.map(toVisitHistoryItem),
    };
  }

  /** Curva de peso de la mascota (lo pesado en cada atención, también en grooming). */
  async weights(
    clinicId: number,
    petId: number,
    role?: Role,
  ): Promise<{ at: Date; kg: number }[]> {
    if (role === 'CASHIER') throw clinicalForbidden();
    const pet = await this.prisma.pet.findFirst({
      where: { id: petId, clinicId },
      select: { id: true },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    return this.weightsOf(clinicId, petId);
  }

  private async weightsOf(clinicId: number, petId: number) {
    const rows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        petId,
        status: { not: 'CANCELLED' },
        weightKg: { not: null },
      },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      select: { openedAt: true, weightKg: true },
      take: HISTORY_LIMIT,
    });
    return rows.map((w) => ({ at: w.openedAt, kg: Number(w.weightKg) }));
  }

  /** Contexto del paciente: atención anterior, peso anterior y refuerzos vencidos. */
  async context(
    clinicId: number,
    id: number,
    role?: Role,
  ): Promise<VisitContext> {
    if (role === 'CASHIER') throw clinicalForbidden();
    const visit = await this.prisma.visit.findFirst({
      where: {
        id,
        clinicId,
        ...(role === 'GROOMER' ? { type: 'GROOMING' } : {}),
      },
      select: { petId: true, openedAt: true },
    });
    if (!visit) throw new NotFoundException('La atención no existe');
    const before: Prisma.VisitWhereInput = {
      clinicId,
      petId: visit.petId,
      id: { not: id },
      status: { not: 'CANCELLED' },
      openedAt: { lt: visit.openedAt },
      // El groomer no ve diagnósticos: solo sus servicios anteriores
      ...(role === 'GROOMER' ? { type: 'GROOMING' as const } : {}),
    };
    // Al veterinario le sirve la última consulta (no el último baño)
    const lastVisit: Prisma.VisitWhereInput = {
      ...before,
      ...(role === 'GROOMER'
        ? {}
        : { type: { in: ['CONSULTATION', 'HOSPITALIZATION'] as VisitType[] } }),
    };
    const [{ timezone }, previous, weighed, doses] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { timezone: true },
      }),
      this.prisma.visit.findFirst({
        where: lastVisit,
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          type: true,
          openedAt: true,
          reason: true,
          diagnosis: true,
          attendedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.visit.findFirst({
        where: { ...before, weightKg: { not: null } },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        select: { weightKg: true, openedAt: true },
      }),
      // Vacunas: historia clínica, el groomer no las ve
      role === 'GROOMER'
        ? Promise.resolve([])
        : this.prisma.immunization.findMany({
            where: { clinicId, petId: visit.petId, voidedAt: null },
            orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
            select: { name: true, kind: true, nextDueAt: true },
            take: 200,
          }),
    ]);
    const today = clinicDay(timezone);
    const overdue = latestDoses(doses)
      .map((d) => ({ ...d, due: fromDbDate(d.nextDueAt) }))
      .filter((d): d is typeof d & { due: string } => !!d.due && d.due < today)
      .slice(0, 5)
      .map((d) => ({ name: d.name, kind: d.kind, nextDueAt: d.due }));
    return {
      previous: previous
        ? {
            id: previous.id,
            type: previous.type,
            openedAt: previous.openedAt,
            reason: previous.reason,
            diagnosis: previous.diagnosis,
            attendedBy: previous.attendedBy.fullName,
          }
        : null,
      previousWeight: weighed?.weightKg
        ? { kg: Number(weighed.weightKg), at: weighed.openedAt }
        : null,
      overdue,
    };
  }

  async list(
    clinicId: number,
    query: ListVisitsQuery,
    role?: Role,
  ): Promise<{
    items: VisitSummary[];
    total: number;
    page: number;
    pageSize: number;
    /** Abiertas desde un día anterior (mismo tipo que se mira) */
    stale: number;
    /** Las mismas, por tipo: para avisar en la otra pestaña */
    staleByType: { CONSULTATION: number; GROOMING: number };
    /** Abiertas en total (sin los filtros de búsqueda), para la pestaña "Abiertas" */
    open: number;
  }> {
    const page = query.page ?? 1;
    if (role === 'CASHIER') throw clinicalForbidden();
    if (query.day && Number.isNaN(Date.parse(`${query.day}T00:00:00Z`)))
      throw new BadRequestException('La fecha no es válida');
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const todayStart = startOfDayIn(timezone, clinicDay(timezone));
    // El groomer solo ve grooming, pida lo que pida. "Consultas" incluye los internamientos.
    const asked = role === 'GROOMER' ? 'GROOMING' : query.type;
    const type: Prisma.VisitWhereInput['type'] =
      asked === 'GROOMING'
        ? 'GROOMING'
        : asked === 'CONSULTATION'
          ? { in: ['CONSULTATION', 'HOSPITALIZATION'] }
          : undefined;

    const where: Prisma.VisitWhereInput = { clinicId };
    if (type) where.type = type;
    if (query.status) where.status = query.status;
    if (query.petId) where.petId = query.petId;
    if (query.clientId) where.clientId = query.clientId;
    if (query.vetId) where.attendedById = query.vetId;
    if (query.day)
      where.openedAt = {
        gte: startOfDayIn(timezone, query.day),
        lt: startOfDayIn(timezone, addDays(query.day, 1)),
      };
    // Un internado sigue abierto hasta el alta: eso no es "olvidada"
    const staleFilter: Prisma.VisitWhereInput = {
      status: 'OPEN',
      openedAt: { lt: todayStart },
      NOT: { type: 'HOSPITALIZATION' },
    };
    if (query.stale) Object.assign(where, staleFilter);
    const q = query.q ? normalizeSearch(query.q) : '';
    if (q)
      where.OR = [
        { pet: { nameSearch: { contains: q } } },
        { client: { searchText: { contains: q } } },
      ];
    const staleWhere: Prisma.VisitWhereInput = {
      clinicId,
      ...staleFilter,
      ...(role === 'GROOMER' ? { type: 'GROOMING' } : {}),
    };

    // Cuántas siguen abiertas (para el número de la pestaña "Abiertas"), sin los filtros de búsqueda
    const openWhere: Prisma.VisitWhereInput = {
      clinicId,
      status: 'OPEN',
      ...(role === 'GROOMER' ? { type: 'GROOMING' } : type ? { type } : {}),
    };
    const [rows, total, staleGroups, open] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
        select: VISIT_SUMMARY_SELECT,
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.visit.count({ where }),
      this.prisma.visit.groupBy({
        by: ['type'],
        where: staleWhere,
        _count: { _all: true },
        orderBy: { type: 'asc' },
      }),
      this.prisma.visit.count({ where: openWhere }),
    ]);
    const staleByType = { CONSULTATION: 0, GROOMING: 0 };
    for (const g of staleGroups)
      if (g.type === 'GROOMING') staleByType.GROOMING += g._count._all;
      else staleByType.CONSULTATION += g._count._all;
    const stale =
      asked === 'GROOMING'
        ? staleByType.GROOMING
        : asked === 'CONSULTATION'
          ? staleByType.CONSULTATION
          : staleByType.CONSULTATION + staleByType.GROOMING;
    const totals = rows.length
      ? await this.prisma.charge.groupBy({
          by: ['visitId'],
          where: {
            clinicId,
            visitId: { in: rows.map((r) => r.id) },
            status: { not: 'VOID' },
          },
          _sum: { total: true, paidAmount: true },
        })
      : [];
    const byVisit = new Map(
      totals.map((t) => [
        t.visitId,
        {
          total: Number(t._sum.total ?? 0),
          pending: Number(t._sum.total ?? 0) - Number(t._sum.paidAmount ?? 0),
        },
      ]),
    );
    return {
      items: rows.map((r) => {
        const sums = byVisit.get(r.id);
        return toVisitSummary(r, sums?.total ?? 0, sums?.pending ?? 0);
      }),
      total,
      page,
      pageSize: PAGE_SIZE,
      stale,
      staleByType,
      open,
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
      // Consulta: recepción solo registra el motivo y el triaje (peso y temperatura)
      if (actor.role === 'RECEPTION' && visit.type === 'CONSULTATION') {
        const clinical = [
          ...SOAP_FIELDS,
          'notes',
          'diagnosisDefinitive',
        ] as const;
        if (clinical.some((k) => dto[k as keyof UpdateVisitDto] !== undefined))
          throw new ForbiddenException(
            'Recepción registra el motivo, el peso y la temperatura; lo demás lo escribe el veterinario',
          );
      }
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
      if (actor.role === 'RECEPTION' && visit.type === 'CONSULTATION')
        throw new ForbiddenException('La consulta la cierra el veterinario');
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

  /** Grooming e internamiento cierran su atención desde su propia pantalla (entrega o alta) */
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
    const hospitalization = await tx.hospitalization.findUnique({
      where: { visitId },
      select: { id: true },
    });
    if (hospitalization)
      throw new ConflictException({
        message:
          'Es un internamiento: se cierra al dar de alta desde Hospitalización',
        hospitalizationId: hospitalization.id,
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
