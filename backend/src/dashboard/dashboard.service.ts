import { Injectable } from '@nestjs/common';
import {
  clinicDay,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Species } from '../generated/prisma/enums.js';
import { CashService } from '../cash/cash.service.js';
import { AppointmentsService } from '../medical/appointments.service.js';
import type { AppointmentView } from '../medical/appointments.service.js';
import { ImmunizationsService } from '../medical/immunizations.service.js';
import type { DueImmunization } from '../medical/immunizations.service.js';
import { HospitalizationService } from '../hospitalization/hospitalization.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import {
  CASH_ROLES,
  CLINICAL_ROLES,
  FRONT_DESK_ROLES,
} from '../common/auth/staff-roles.js';
import { LATE_STATUSES, lateSince } from '../billing/billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LAB_OVERDUE_DAYS } from '../medical/lab.constants.js';
import {
  OPEN_STATUSES,
  QUEUE_ITEM_SELECT,
  queueOrder,
  toQueueItem,
} from '../queue/queue.service.js';
import type { QueueItem } from '../queue/queue.service.js';

export interface DashboardSummary {
  day: string;
  queue: {
    arrived: number;
    waiting: number;
    inProgress: number;
    urgent: number;
    done: number;
    /** Los que siguen en la clínica: en atención, en espera y recién llegados (máx. 6). */
    items: QueueItem[];
  };
  clients: { active: number; newThisMonth: number };
  pets: { active: number };
  /** Lotes vencidos o que vencen en 30 días, y productos con stock bajo */
  inventory: { expiring: number; lowStock: number };
  /** Grooming: en el tablero, listos para entregar y entregados hoy */
  grooming: { active: number; ready: number; delivered: number };
  /** Lo cobrado hoy (menos devoluciones) y cuántos cobros */
  sales: {
    total: number;
    collected: number;
    refunded: number;
    receipts: number;
  };
  recentClients: {
    id: number;
    name: string;
    createdAt: Date;
    pets: { name: string; species: Species }[];
  }[];
  /** Citas de hoy (las mismas de la agenda), sin las canceladas */
  appointments: {
    total: number;
    /** Por confirmar o confirmadas que aún no llegan */
    pending: number;
    arrived: number;
    noShow: number;
    items: AppointmentView[];
  };
  /**
   * Refuerzos (los mismos de Vacunas): los que tocan en 7 días y los vencidos. Solo para quienes
   * atienden y llaman a los dueños (recepción, veterinario y administrador).
   */
  reminders: {
    upcoming: number;
    overdue: number;
    items: DueImmunization[];
  } | null;
  /** Internados y dosis atrasadas (recepción, veterinario y administrador) */
  hospitalization: { active: number; overdue: number } | null;
  /** Avisos de la campana, según el rol */
  alerts: HeaderAlert[];
}

const REMINDER_DAYS = 7;
const REMINDER_ITEMS = 5;
const APPOINTMENT_ITEMS = 8;

/** Aviso de la campana: cada uno lleva a la pantalla donde se resuelve. */
export interface HeaderAlert {
  kind:
    | 'urgent'
    | 'doses'
    | 'expiring'
    | 'lowStock'
    | 'shortage'
    | 'staleCash'
    | 'billing'
    | 'billingLate'
    | 'labReview'
    | 'labOverdue'
    | 'staleVisits'
    | 'staleGrooming';
  count: number;
  link: string;
  query?: Record<string, string>;
}

/** Resumen del día para la pantalla de inicio. Solo cifras reales de módulos ya construidos. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
    private readonly appointments: AppointmentsService,
    private readonly immunizations: ImmunizationsService,
    private readonly hospitalization: HospitalizationService,
  ) {}

  async summary(user: AuthUser): Promise<DashboardSummary> {
    const { clinicId } = user;
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const day = clinicDay(timezone);
    const monthStart = startOfDayIn(timezone, `${day.slice(0, 7)}-01`);
    const today = { clinicId, day: toDbDate(day) };

    const [
      byStatus,
      urgent,
      open,
      activeClients,
      newClients,
      activePets,
      recent,
    ] = await Promise.all([
      this.prisma.queueEntry.groupBy({
        by: ['status'],
        where: today,
        _count: { _all: true },
      }),
      this.prisma.queueEntry.count({
        where: { ...today, urgent: true, status: { in: OPEN_STATUSES } },
      }),
      this.prisma.queueEntry.findMany({
        where: { ...today, status: { in: OPEN_STATUSES } },
        select: QUEUE_ITEM_SELECT,
        orderBy: [{ urgent: 'desc' }, { arrivedAt: 'asc' }],
      }),
      this.prisma.client.count({
        where: { clinicId, active: true, walkIn: false },
      }),
      this.prisma.client.count({
        where: { clinicId, walkIn: false, createdAt: { gte: monthStart } },
      }),
      this.prisma.pet.count({ where: { clinicId, active: true } }),
      this.prisma.client.findMany({
        where: { clinicId, walkIn: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          createdAt: true,
          pets: {
            where: { active: true },
            select: { name: true, species: true },
            orderBy: { name: 'asc' },
          },
        },
      }),
    ]);

    const in30 = new Date(toDbDate(day).getTime() + 30 * 86_400_000);
    const callsOwners = FRONT_DESK_ROLES.includes(user.role);
    const [agenda, upcoming, overdue, alerts, hospitalized] = await Promise.all(
      [
        this.appointments.list(clinicId, { from: day }),
        callsOwners
          ? this.immunizations.due(clinicId, {
              status: 'upcoming',
              days: REMINDER_DAYS,
            })
          : Promise.resolve([]),
        callsOwners
          ? this.immunizations.due(clinicId, { status: 'overdue' })
          : Promise.resolve([]),
        this.alerts(user),
        callsOwners
          ? this.hospitalization.summary(clinicId)
          : Promise.resolve(null),
      ],
    );
    const booked = agenda.filter((a) => a.status !== 'CANCELLED');
    const [expiring, lowRows, sales, groomingRows] = await Promise.all([
      this.prisma.productBatch.count({
        where: {
          clinicId,
          quantity: { gt: 0 },
          expiresAt: { lte: in30 },
          product: { active: true },
        },
      }),
      this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
        SELECT count(*) AS n FROM products
        WHERE clinic_id = ${clinicId} AND active AND min_stock > 0 AND total_stock <= min_stock`),
      this.cash.today(clinicId, timezone),
      this.prisma.groomingSession.groupBy({
        by: ['status'],
        where: {
          clinicId,
          OR: [
            { status: { in: ['WAITING', 'BATHING', 'CUTTING', 'READY'] } },
            { status: 'DELIVERED', day: toDbDate(day) },
          ],
        },
        _count: { _all: true },
      }),
    ]);
    const groomed = (...statuses: string[]) =>
      groomingRows
        .filter((r) => statuses.includes(r.status))
        .reduce((sum, r) => sum + r._count._all, 0);

    const count = (status: string) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const items = open
      .map((r) => toQueueItem(r))
      .sort(queueOrder)
      .slice(0, 6);

    return {
      day,
      queue: {
        arrived: count('ARRIVED'),
        waiting: count('WAITING'),
        inProgress: count('IN_PROGRESS'),
        urgent,
        done: count('DONE'),
        items,
      },
      clients: { active: activeClients, newThisMonth: newClients },
      pets: { active: activePets },
      inventory: { expiring, lowStock: Number(lowRows[0]?.n ?? 0) },
      sales,
      grooming: {
        active: groomed('WAITING', 'BATHING', 'CUTTING', 'READY'),
        ready: groomed('READY'),
        delivered: groomed('DELIVERED'),
      },
      recentClients: recent,
      appointments: {
        total: booked.length,
        pending: booked.filter(
          (a) => a.status === 'SCHEDULED' || a.status === 'CONFIRMED',
        ).length,
        arrived: booked.filter((a) => a.status === 'ARRIVED').length,
        noShow: booked.filter((a) => a.status === 'NO_SHOW').length,
        items: booked.slice(0, APPOINTMENT_ITEMS),
      },
      // Primero lo que toca esta semana (lo más cercano), luego los vencidos más recientes
      reminders: callsOwners
        ? {
            upcoming: upcoming.length,
            overdue: overdue.length,
            items: [...upcoming, ...overdue].slice(0, REMINDER_ITEMS),
          }
        : null,
      hospitalization: hospitalized,
      alerts,
    };
  }

  /**
   * Avisos de la campana, según el rol: urgencias en la cola (todos), vencimientos, stock
   * bajo e insumos usados sin stock (administrador y veterinario), y una caja que quedó
   * abierta desde otro día (quienes manejan la caja). Solo conteos: es liviano.
   */
  async alerts(user: AuthUser): Promise<HeaderAlert[]> {
    const { clinicId, role } = user;
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const day = clinicDay(timezone);
    const pharmacy = role === 'ADMIN' || role === 'VET';
    const cash = CASH_ROLES.includes(role);
    const in30 = new Date(toDbDate(day).getTime() + 30 * 86_400_000);
    const none = Promise.resolve(0);

    const clinical = CLINICAL_ROLES.includes(role);
    const [
      urgent,
      expiring,
      lowRows,
      shortages,
      staleCash,
      billing,
      billingLate,
      doses,
      labReview,
      labOverdue,
      staleVisits,
    ] = await Promise.all([
      this.prisma.queueEntry.count({
        where: {
          clinicId,
          day: toDbDate(day),
          urgent: true,
          status: { in: OPEN_STATUSES },
        },
      }),
      pharmacy
        ? this.prisma.productBatch.count({
            where: {
              clinicId,
              quantity: { gt: 0 },
              expiresAt: { lte: in30 },
              product: { active: true },
            },
          })
        : none,
      pharmacy
        ? this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
            SELECT count(*) AS n FROM products
            WHERE clinic_id = ${clinicId} AND active AND min_stock > 0 AND total_stock <= min_stock`)
        : Promise.resolve([{ n: 0n }]),
      pharmacy
        ? this.prisma.stockShortage.count({
            where: { clinicId, resolvedAt: null },
          })
        : none,
      cash
        ? this.prisma.cashSession.count({
            where: {
              clinicId,
              status: 'OPEN',
              openedAt: { lt: startOfDayIn(timezone, day) },
            },
          })
        : none,
      // Comprobantes que SUNAT rechazó o que no salen después de varios intentos
      cash
        ? this.prisma.electronicDocument.count({
            where: {
              clinicId,
              OR: [
                { status: 'REJECTED', replacedAt: null },
                { status: 'ERROR', attempts: { gte: 3 } },
                // Detenidos (token, servicio cortado o sin intentos): esperan a que se arregle
                { status: 'ERROR', nextAttemptAt: null },
              ],
            },
          })
        : none,
      // Comprobantes que SUNAT aún no acepta pasado un día: el administrador (no se borra a medianoche)
      role === 'ADMIN'
        ? this.prisma.electronicDocument.count({
            where: {
              clinicId,
              status: { in: LATE_STATUSES },
              createdAt: { lt: lateSince() },
            },
          })
        : none,
      // Dosis atrasadas de los internados
      pharmacy
        ? this.hospitalization.summary(clinicId).then((h) => h.overdue)
        : none,
      // Resultados de exámenes que esperan la revisión del veterinario
      pharmacy
        ? this.prisma.labOrder.count({
            where: { clinicId, status: 'RESULT_READY' },
          })
        : none,
      // Exámenes que llevan días sin resultado (hay que llamar al laboratorio)
      clinical
        ? this.prisma.labOrder.count({
            where: {
              clinicId,
              status: { in: ['REQUESTED', 'SAMPLE_TAKEN'] },
              requestedAt: {
                lt: new Date(Date.now() - LAB_OVERDUE_DAYS * 86_400_000),
              },
            },
          })
        : none,
      // Atenciones que quedaron abiertas desde otro día: plata sin cobrar. Los internados siguen
      // abiertos hasta el alta; las de grooming se avisan aparte (se cierran al entregar).
      clinical || role === 'GROOMER'
        ? this.prisma.visit.groupBy({
            by: ['type'],
            where: {
              clinicId,
              status: 'OPEN',
              openedAt: { lt: startOfDayIn(timezone, day) },
              type: { in: ['CONSULTATION', 'GROOMING'] },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const staleOf = (type: 'CONSULTATION' | 'GROOMING') =>
      staleVisits.find((g) => g.type === type)?._count._all ?? 0;
    const alerts: HeaderAlert[] = [
      { kind: 'urgent', count: urgent, link: '/cola' },
      { kind: 'doses', count: doses, link: '/hospitalizacion' },
      {
        kind: 'expiring',
        count: expiring,
        link: '/inventario',
        query: { filtro: 'expiring' },
      },
      {
        kind: 'lowStock',
        count: Number(lowRows[0]?.n ?? 0),
        link: '/inventario',
        query: { filtro: 'low' },
      },
      {
        kind: 'shortage',
        count: shortages,
        link: '/inventario',
        query: { filtro: 'faltantes' },
      },
      { kind: 'staleCash', count: staleCash, link: '/caja' },
      {
        kind: 'labReview',
        count: labReview,
        link: '/examenes',
        query: { ver: 'ready' },
      },
      { kind: 'labOverdue', count: labOverdue, link: '/examenes' },
      {
        kind: 'staleVisits',
        count: clinical ? staleOf('CONSULTATION') : 0,
        link: '/atenciones',
        query: { ver: 'antiguas' },
      },
      {
        // Grooming sin entregar de días anteriores: se resuelve en el tablero
        kind: 'staleGrooming',
        count: role === 'VET' ? 0 : staleOf('GROOMING'),
        link: '/grooming',
      },
      {
        kind: 'billing',
        count: billing,
        link: '/comprobantes',
        query: { estado: 'PROBLEMS' },
      },
      {
        kind: 'billingLate',
        count: billingLate,
        link: '/comprobantes',
        query: { estado: 'LATE' },
      },
    ];
    return alerts.filter((a) => a.count > 0);
  }
}
