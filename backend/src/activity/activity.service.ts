import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { startOfDayIn } from '../common/time/clinic-day.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ACTIVITY_AREAS,
  ActivityQuery,
  ActivityReviewQuery,
  REVIEW_KINDS,
  ReviewKind,
} from './activity.dto.js';

export const ACTIVITY_PAGE = 50;
/**
 * La bitácora crece para siempre: contar todo (cientos de miles de filas) costaba ~22 ms con
 * 315 mil registros y crecía con los años. Se cuenta hasta este tope (~2 ms) y la pantalla dice
 * "más de 10 000"; para ver lo anterior se filtra por fecha.
 */
export const ACTIVITY_COUNT_CAP = 10_000;

/**
 * Acciones que el dueño debería revisar: dinero que se devuelve, stock que se ajusta,
 * precios que cambian, accesos que fallan, cambios en facturación. Se marcan en la pantalla.
 * Lo que hace la cuenta de soporte nunca se marca: se ve aparte, en el área Soporte.
 */
export const IMPORTANT_ACTIONS: string[] = Object.values(REVIEW_KINDS).flat();

export interface ActivityItem {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
  ip: string | null;
  important: boolean;
  /** La cuenta de soporte sale como "Soporte Uywa", nunca con el nombre de la persona */
  user: { id: number; fullName: string; support: boolean } | null;
}

export interface ActivityReview {
  from: string;
  to: string;
  total: number;
  kinds: { kind: ReviewKind; count: number }[];
}

/**
 * Lo marcado: acciones delicadas del equipo de la clínica. Lo que hace soporte nunca se marca
 * ni cuenta en "Para revisar": se ve aparte, en el área Soporte.
 */
const MARKED: Prisma.AuditLogWhereInput = {
  action: { in: IMPORTANT_ACTIONS },
  NOT: { user: { isSupport: true } },
};

/**
 * Lo que hace la cuenta de soporte (Uywa) no se muestra en Actividad (decidido 25 nov). Queda
 * guardado en la base: si hay un reclamo, se puede probar qué se hizo y qué no.
 */
const HIDE_SUPPORT: Prisma.AuditLogWhereInput = {
  NOT: { user: { isSupport: true } },
};

function isImportant(action: string, support: boolean): boolean {
  return !support && IMPORTANT_ACTIONS.includes(action);
}

function publicUser(
  user: { id: number; fullName: string; isSupport: boolean } | null,
) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.isSupport ? 'Soporte Uywa' : user.fullName,
    support: user.isSupport,
  };
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
  /** true = hay más de ACTIVITY_COUNT_CAP registros (total quedó en el tope) */
  totalCapped: boolean;
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

    and.push(HIDE_SUPPORT);
    if (query.area) {
      and.push({
        OR: ACTIVITY_AREAS[query.area].map((prefix) => ({
          action: { startsWith: `${prefix}.` },
        })),
      });
    }
    if (query.important) and.push(MARKED);
    if (query.kind)
      and.push({ ...MARKED, action: { in: [...REVIEW_KINDS[query.kind]] } });
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to)
      where.createdAt = await this.range(clinicId, query.from, query.to);
    if (and.length) where.AND = and;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * ACTIVITY_PAGE,
        take: ACTIVITY_PAGE,
        include: {
          user: { select: { id: true, fullName: true, isSupport: true } },
        },
      }),
      this.prisma.auditLog.count({ where, take: ACTIVITY_COUNT_CAP + 1 }),
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
        important: isImportant(r.action, !!r.user?.isSupport),
        user: publicUser(r.user),
      })),
      total: Math.min(total, ACTIVITY_COUNT_CAP),
      totalCapped: total > ACTIVITY_COUNT_CAP,
      page,
      pageSize: ACTIVITY_PAGE,
    };
  }

  /** "Para revisar": cuántos hay de cada grupo en el rango (por defecto, los últimos 7 días) */
  async review(
    clinicId: number,
    query: ActivityReviewQuery,
  ): Promise<ActivityReview> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
    }).format(new Date());
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -6);
    const createdAt = {
      gte: startOfDayIn(timezone, from),
      lt: startOfDayIn(timezone, nextDay(to)),
    };
    const byAction = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { clinicId, createdAt, ...MARKED },
      _count: { _all: true },
    });
    const counts = new Map(byAction.map((r) => [r.action, r._count._all]));
    const kinds = (Object.keys(REVIEW_KINDS) as ReviewKind[])
      .map((kind) => ({
        kind,
        count: REVIEW_KINDS[kind].reduce((s, a) => s + (counts.get(a) ?? 0), 0),
      }))
      .filter((k) => k.count > 0);
    return {
      from,
      to,
      total: kinds.reduce((s, k) => s + k.count, 0),
      kinds,
    };
  }

  private async range(
    clinicId: number,
    from?: string,
    to?: string,
  ): Promise<Prisma.DateTimeFilter> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = startOfDayIn(timezone, from);
    if (to) createdAt.lt = startOfDayIn(timezone, nextDay(to));
    return createdAt;
  }
}

function addDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
