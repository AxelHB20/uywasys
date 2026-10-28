import { Injectable } from '@nestjs/common';
import {
  clinicDay,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Species } from '../generated/prisma/enums.js';
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
  recentClients: {
    id: number;
    name: string;
    createdAt: Date;
    pets: { name: string; species: Species }[];
  }[];
}

/** Resumen del día para la pantalla de inicio. Solo cifras reales de módulos ya construidos. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

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
      this.prisma.client.count({ where: { clinicId, active: true } }),
      this.prisma.client.count({
        where: { clinicId, createdAt: { gte: monthStart } },
      }),
      this.prisma.pet.count({ where: { clinicId, active: true } }),
      this.prisma.client.findMany({
        where: { clinicId },
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
    const [expiring, lowRows] = await Promise.all([
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
    ]);

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
      recentClients: recent,
    };
  }
}
