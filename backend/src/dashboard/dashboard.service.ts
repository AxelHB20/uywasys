import { Injectable } from '@nestjs/common';
import {
  clinicDay,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Species } from '../generated/prisma/enums.js';
import { CashService } from '../cash/cash.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CASH_ROLES } from '../common/auth/staff-roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  OPEN_STATUSES,
  QUEUE_ITEM_SELECT,
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
  sales: { total: number; receipts: number };
  recentClients: {
    id: number;
    name: string;
    createdAt: Date;
    pets: { name: string; species: Species }[];
  }[];
}

/** Aviso de la campana: cada uno lleva a la pantalla donde se resuelve. */
export interface HeaderAlert {
  kind:
    'urgent' | 'expiring' | 'lowStock' | 'shortage' | 'staleCash' | 'billing';
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
  ) {}

  async summary(clinicId: number): Promise<DashboardSummary> {
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
    const order = { IN_PROGRESS: 0, WAITING: 1, ARRIVED: 2 } as Record<
      string,
      number
    >;
    const items = open
      .map(toQueueItem)
      .sort((a, b) => order[a.status] - order[b.status])
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

    const [urgent, expiring, lowRows, shortages, staleCash, billing] =
      await Promise.all([
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
                  { status: 'REJECTED' },
                  { status: 'ERROR', attempts: { gte: 3 } },
                ],
              },
            })
          : none,
      ]);

    const alerts: HeaderAlert[] = [
      { kind: 'urgent', count: urgent, link: '/cola' },
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
        kind: 'billing',
        count: billing,
        link: '/comprobantes',
        query: { estado: 'PROBLEMS' },
      },
    ];
    return alerts.filter((a) => a.count > 0);
  }
}
