import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { startOfDayIn } from '../common/time/clinic-day.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACTIVITY_AREAS, ActivityQuery } from './activity.dto.js';

export const ACTIVITY_PAGE = 50;

/**
 * Acciones que el dueño debería revisar: dinero que se devuelve, stock que se ajusta,
 * precios que cambian, accesos que fallan. Se marcan en la pantalla y tienen su filtro.
 */
export const IMPORTANT_ACTIONS = [
  'auth.locked',
  'auth.login_failed',
  'cash.close_difference',
  'cash.receipt_void',
  'cash.expense_void',
  'charge.void',
  'sale.cancel',
  'visit.cancel',
  'immunization.void',
  'prescription.void',
  'consent.void',
  'attachment.void',
  'grooming.cancel',
  'product.price_change',
  'service.price_change',
  'stock.count_adjust',
  'stock.waste',
  'user.deactivate',
  'user.reset_password',
  'client.anonymize',
];

export interface ActivityItem {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
  ip: string | null;
  important: boolean;
  user: { id: number; fullName: string } | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Bitácora de la clínica, para que el administrador vea quién hizo qué y cuándo. */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clinicId: number, query: ActivityQuery): Promise<ActivityPage> {
    const page = query.page ?? 1;
    const where: Prisma.AuditLogWhereInput = { clinicId };
    const and: Prisma.AuditLogWhereInput[] = [];

    if (query.area) {
      and.push({
        OR: ACTIVITY_AREAS[query.area].map((prefix) => ({
          action: { startsWith: `${prefix}.` },
        })),
      });
    }
    if (query.important) and.push({ action: { in: IMPORTANT_ACTIONS } });
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { timezone: true },
      });
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from) createdAt.gte = startOfDayIn(timezone, query.from);
      if (query.to) createdAt.lt = startOfDayIn(timezone, nextDay(query.to));
      where.createdAt = createdAt;
    }
    if (and.length) where.AND = and;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * ACTIVITY_PAGE,
        take: ACTIVITY_PAGE,
        include: { user: { select: { id: true, fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id.toString(),
        at: r.createdAt.toISOString(),
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        data: r.data,
        ip: r.ip,
        important: IMPORTANT_ACTIONS.includes(r.action),
        user: r.user,
      })),
      total,
      page,
      pageSize: ACTIVITY_PAGE,
    };
  }
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
