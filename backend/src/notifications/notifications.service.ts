import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CASH_ROLES } from '../common/auth/staff-roles.js';
import {
  clinicDay,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import type { HeaderAlert } from '../dashboard/dashboard.service.js';
import type { Species } from '../generated/prisma/enums.js';
import { RECOVERABLE_KINDS } from '../billing/billing-health.js';
import { documentsThisMonth, isoDay } from '../billing/billing-usage.js';
import { serviceNotices } from './service-notices.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type NotificationKind =
  | 'arrival'
  | 'groomingArrival'
  | 'readyToCharge'
  | 'groomingReady'
  | 'appointmentNew'
  | 'billingRejected'
  | 'billingConfig'
  | 'billingStopped'
  | 'labResult';

/** Algo que pasó hoy y le importa a este rol (no lo que hizo el mismo usuario) */
export interface NotificationEvent {
  /** Estable entre consultas: "arrival:123" */
  id: string;
  kind: NotificationKind;
  urgent: boolean;
  at: Date;
  petName: string | null;
  species: Species | null;
  /** Detalle corto ya armado: "Consulta · Vómitos · lo registró Ana" */
  detail: string;
  link: string;
  query?: Record<string, string>;
  /** Para "lista para cobrar": monto pendiente */
  amount?: number;
  /** Para citas nuevas: cuándo es */
  startsAt?: Date;
  /** Para comprobantes: B001-00000123 */
  code?: string;
}

/** Aviso fijo arriba de todas las pantallas mientras dure el problema */
export interface SystemBanner {
  /** Cambia si cambia el problema (para no recordar un "ocultar" viejo) */
  id: string;
  tone: 'danger' | 'warning';
  title: string;
  detail: string;
  action?: { label: string; link: string };
  /** Los rojos no se ocultan hasta resolverse; los ámbar, hasta el día siguiente */
  dismissible: boolean;
}

export interface NotificationsView {
  alerts: HeaderAlert[];
  events: NotificationEvent[];
  banners: SystemBanner[];
  /** Hasta cuándo las vio (las posteriores son "nuevas") */
  seenAt: Date | null;
  serverTime: Date;
}

const LIMIT = 20;

interface BillingProblem {
  health: 'TOKEN' | 'SUSPENDED' | 'UNREACHABLE';
  since: Date;
  provider: string;
  timezone: string;
}

const PROVIDER_NAMES: Record<string, string> = {
  MIFACT: 'Mifact',
  NUBEFACT: 'Nubefact',
  LUCODE: 'el PSE',
};

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "desde las 08:10" (hoy) o "desde el 17 nov. 08:10" */
function sinceLabel(at: Date, timezone: string): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
  const time = new Intl.DateTimeFormat('es-PE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  if (day(at) === day(new Date())) return `desde las ${time}`;
  const date = new Intl.DateTimeFormat('es-PE', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  }).format(at);
  return `desde el ${date} ${time}`;
}
const firstName = (name: string | null | undefined) =>
  name?.trim().split(/\s+/)[0] ?? '';

/**
 * Centro de notificaciones: los pendientes de siempre (conteos de la campana) y lo que pasó hoy
 * en la clínica según el rol: llegadas para veterinarios, ingresos para groomers, "lista para
 * cobrar" y baños listos para caja y recepción, citas nuevas para su veterinario y comprobantes
 * rechazados para el administrador. Se arma de las tablas de cada módulo: no hay que registrar nada aparte.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
  ) {}

  async view(user: AuthUser): Promise<NotificationsView> {
    const problem = await this.billingProblem(user);
    const [alerts, events, me, notices] = await Promise.all([
      this.dashboard.alerts(user),
      this.events(user, problem),
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { notificationsSeenAt: true },
      }),
      this.serviceBanners(user),
    ]);
    return {
      alerts,
      events,
      // Lo que ya se detuvo va primero; después, lo que está por vencer
      banners: [
        ...(problem ? [this.billingBanner(user, problem)] : []),
        ...notices,
      ],
      seenAt: me.notificationsSeenAt,
      serverTime: new Date(),
    };
  }

  /** Marca como vistas las que hay hasta ahora */
  async markSeen(user: AuthUser): Promise<{ seenAt: Date }> {
    const seenAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { notificationsSeenAt: seenAt },
    });
    return { seenAt };
  }

  /**
   * Facturación detenida o sin conexión, para quienes cobran (administrador, caja, recepción).
   * Nunca en simulación ni con la facturación apagada.
   */
  private async billingProblem(user: AuthUser): Promise<BillingProblem | null> {
    if (!CASH_ROLES.includes(user.role)) return null;
    const s = await this.prisma.billingSettings.findUnique({
      where: { clinicId: user.clinicId },
      select: {
        enabled: true,
        provider: true,
        health: true,
        healthSince: true,
        clinic: { select: { timezone: true } },
      },
    });
    if (!s?.enabled || s.provider === 'SIMULATED') return null;
    if (
      s.health !== 'TOKEN' &&
      s.health !== 'SUSPENDED' &&
      s.health !== 'UNREACHABLE'
    )
      return null;
    return {
      health: s.health,
      since: s.healthSince ?? new Date(),
      provider: PROVIDER_NAMES[s.provider] ?? 'el PSE',
      timezone: s.clinic.timezone,
    };
  }

  /**
   * Solo soporte técnico: token del PSE viejo, cupo del mes por acabarse y vencimientos del
   * plan del PSE, del dominio y del servidor (los fija en Facturación).
   */
  private async serviceBanners(user: AuthUser): Promise<SystemBanner[]> {
    if (!user.support) return [];
    const s = await this.prisma.billingSettings.findUnique({
      where: { clinicId: user.clinicId },
      select: {
        enabled: true,
        provider: true,
        tokenUpdatedAt: true,
        monthlyQuota: true,
        planExpiresOn: true,
        domainExpiresOn: true,
        serverExpiresOn: true,
        clinic: { select: { timezone: true } },
      },
    });
    if (!s) return [];
    const active = s.enabled && s.provider !== 'SIMULATED';
    const { timezone } = s.clinic;
    return serviceNotices({
      today: clinicDay(timezone),
      provider: active ? s.provider : null,
      tokenUpdatedAt: s.tokenUpdatedAt,
      monthlyQuota: s.monthlyQuota,
      usedThisMonth:
        active && s.monthlyQuota
          ? await documentsThisMonth(this.prisma, user.clinicId, timezone)
          : 0,
      planExpiresOn: isoDay(s.planExpiresOn),
      domainExpiresOn: isoDay(s.domainExpiresOn),
      serverExpiresOn: isoDay(s.serverExpiresOn),
    });
  }

  private billingBanner(user: AuthUser, p: BillingProblem): SystemBanner {
    // Solo soporte técnico arregla el PSE (el dueño no maneja tokens); el resto sigue cobrando y avisa
    const support = !!user.support;
    const admin = user.role === 'ADMIN';
    const since = sinceLabel(p.since, p.timezone);
    const id = `billing:${p.health}:${p.since.toISOString()}`;
    const queued =
      'Puedes seguir cobrando: los comprobantes quedan en cola y salen solos cuando se arregle.';
    const tell = support
      ? ''
      : admin
        ? ' Avisa a soporte técnico.'
        : ' Avisa al administrador.';
    if (p.health === 'UNREACHABLE')
      return {
        id,
        tone: 'warning',
        title: `Sin conexión con ${p.provider}`,
        detail: `No responde ${since}. Los comprobantes se reintentan solos. ${
          support
            ? 'Si sigue así, revisa el internet del servidor.'
            : admin
              ? 'Si sigue así, avisa a soporte técnico.'
              : 'Puedes seguir cobrando.'
        }`,
        dismissible: true,
      };
    return {
      id,
      tone: 'danger',
      title: 'La facturación está detenida',
      detail: `${
        p.health === 'TOKEN'
          ? support
            ? `El token de ${p.provider} no funciona ${since}.`
            : `La conexión con ${p.provider} no funciona ${since}.`
          : `${capitalize(p.provider)} suspendió el servicio ${since}: revisa el pago de la suscripción.`
      } ${queued}${tell}`,
      action: support
        ? p.health === 'TOKEN'
          ? { label: 'Actualizar token', link: '/comprobantes/configuracion' }
          : { label: 'Ver comprobantes', link: '/comprobantes' }
        : admin
          ? { label: 'Ver comprobantes', link: '/comprobantes' }
          : undefined,
      dismissible: false,
    };
  }

  private async events(
    user: AuthUser,
    problem: BillingProblem | null = null,
  ): Promise<NotificationEvent[]> {
    const { clinicId, role, id: me } = user;
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const day = clinicDay(timezone);
    const since = startOfDayIn(timezone, day);
    const vet = role === 'ADMIN' || role === 'VET';
    const cash = CASH_ROLES.includes(role);
    const groomer = role === 'GROOMER';
    const none = Promise.resolve([] as NotificationEvent[]);

    const stopped: NotificationEvent[] =
      problem && problem.health !== 'UNREACHABLE'
        ? [
            {
              id: `billingStopped:${problem.health}:${problem.since.toISOString()}`,
              kind: 'billingStopped',
              urgent: true,
              at: problem.since,
              petName: null,
              species: null,
              detail:
                problem.health === 'TOKEN'
                  ? user.support
                    ? `El token de ${problem.provider} no funciona: los comprobantes esperan en cola`
                    : `La conexión con ${problem.provider} no funciona: los comprobantes esperan en cola`
                  : `${capitalize(problem.provider)} suspendió el servicio: los comprobantes esperan en cola`,
              link: user.support
                ? '/comprobantes/configuracion'
                : '/comprobantes',
            },
          ]
        : [];

    const lists = await Promise.all([
      // Llegadas a la cola de consultas: los veterinarios
      vet
        ? this.prisma.queueEntry
            .findMany({
              where: {
                clinicId,
                day: toDbDate(day),
                type: { not: 'GROOMING' },
                createdById: { not: me },
              },
              orderBy: { arrivedAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                urgent: true,
                reason: true,
                arrivedAt: true,
                pet: { select: { name: true, species: true } },
                createdBy: { select: { fullName: true } },
              },
            })
            .then((rows) =>
              rows.map<NotificationEvent>((q) => ({
                id: `arrival:${q.id}`,
                kind: 'arrival',
                urgent: q.urgent,
                at: q.arrivedAt,
                petName: q.pet.name,
                species: q.pet.species,
                detail: [
                  q.reason,
                  `lo registró ${firstName(q.createdBy.fullName)}`,
                ]
                  .filter(Boolean)
                  .join(' · '),
                link: '/cola',
              })),
            )
        : none,
      // Ingresos a grooming: los groomers
      groomer
        ? this.prisma.groomingSession
            .findMany({
              where: { clinicId, day: toDbDate(day), createdById: { not: me } },
              orderBy: { checkInAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                checkInAt: true,
                aggressive: true,
                instructions: true,
                groomerId: true,
                pet: { select: { name: true, species: true } },
              },
            })
            .then((rows) =>
              rows
                // El suyo o sin asignar
                .filter((g) => g.groomerId === null || g.groomerId === me)
                .map<NotificationEvent>((g) => ({
                  id: `groomingArrival:${g.id}`,
                  kind: 'groomingArrival',
                  urgent: false,
                  at: g.checkInAt,
                  petName: g.pet.name,
                  species: g.pet.species,
                  detail: [
                    g.groomerId === me
                      ? 'Asignado a ti'
                      : 'Sin groomer asignado',
                    g.aggressive ? 'cuidado: agresivo' : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  link: '/grooming',
                })),
            )
        : none,
      // Atenciones cerradas con algo por cobrar: caja y recepción
      cash
        ? this.prisma.visit
            .findMany({
              where: {
                clinicId,
                status: 'CLOSED',
                closedAt: { gte: since },
                closedById: { not: me },
                charges: { some: { status: 'PENDING' } },
              },
              orderBy: { closedAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                closedAt: true,
                clientId: true,
                pet: { select: { name: true, species: true } },
                attendedBy: { select: { fullName: true } },
                charges: {
                  where: { status: 'PENDING' },
                  select: { total: true, paidAmount: true },
                },
              },
            })
            .then((rows) =>
              rows.map<NotificationEvent>((v) => ({
                id: `readyToCharge:${v.id}`,
                kind: 'readyToCharge',
                urgent: false,
                at: v.closedAt!,
                petName: v.pet.name,
                species: v.pet.species,
                amount:
                  Math.round(
                    v.charges.reduce(
                      (s, c) => s + Number(c.total) - Number(c.paidAmount),
                      0,
                    ) * 100,
                  ) / 100,
                detail: `atendió ${v.attendedBy.fullName}`,
                link: '/caja',
                query: { cobrar: String(v.clientId) },
              })),
            )
        : none,
      // Baños listos para entregar: recepción y caja
      cash
        ? this.prisma.groomingSession
            .findMany({
              where: { clinicId, status: 'READY', readyAt: { gte: since } },
              orderBy: { readyAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                readyAt: true,
                pet: { select: { name: true, species: true } },
                groomer: { select: { fullName: true } },
                client: { select: { name: true } },
              },
            })
            .then((rows) =>
              rows.map<NotificationEvent>((g) => ({
                id: `groomingReady:${g.id}`,
                kind: 'groomingReady',
                urgent: false,
                at: g.readyAt!,
                petName: g.pet.name,
                species: g.pet.species,
                detail: [
                  g.groomer ? `lo bañó ${firstName(g.groomer.fullName)}` : null,
                  `avisa a ${firstName(g.client.name)}`,
                ]
                  .filter(Boolean)
                  .join(' · '),
                link: '/grooming',
              })),
            )
        : none,
      // Citas nuevas para este veterinario (las agendó otra persona)
      role === 'VET' || role === 'ADMIN'
        ? this.prisma.appointment
            .findMany({
              where: {
                clinicId,
                vetId: me,
                createdAt: { gte: since },
                createdById: { not: me },
                status: { in: ['SCHEDULED', 'CONFIRMED'] },
                startsAt: { gte: new Date() },
              },
              orderBy: { createdAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                createdAt: true,
                startsAt: true,
                reason: true,
                pet: { select: { name: true, species: true } },
                createdBy: { select: { fullName: true } },
              },
            })
            .then((rows) =>
              rows.map<NotificationEvent>((a) => ({
                id: `appointmentNew:${a.id}`,
                kind: 'appointmentNew',
                urgent: false,
                at: a.createdAt,
                startsAt: a.startsAt,
                petName: a.pet.name,
                species: a.pet.species,
                detail: [
                  a.reason,
                  `la agendó ${firstName(a.createdBy.fullName)}`,
                ]
                  .filter(Boolean)
                  .join(' · '),
                link: '/citas',
              })),
            )
        : none,
      // Comprobantes rechazados o con error de datos: el administrador. Los detenidos por el
      // token, el corte o la red van juntos en un solo aviso ("La facturación está detenida")
      role === 'ADMIN'
        ? this.prisma.electronicDocument
            .findMany({
              where: {
                clinicId,
                updatedAt: { gte: since },
                OR: [
                  { status: 'REJECTED', replacedAt: null },
                  {
                    status: 'ERROR',
                    OR: [
                      { errorKind: null },
                      { errorKind: { notIn: RECOVERABLE_KINDS } },
                    ],
                  },
                ],
              },
              orderBy: { updatedAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                series: true,
                number: true,
                status: true,
                updatedAt: true,
                sunatDescription: true,
                lastError: true,
              },
            })
            .then((rows) =>
              rows.map<NotificationEvent>((d) => ({
                id: `billingRejected:${d.id}:${d.status}`,
                kind: 'billingRejected',
                urgent: d.status === 'REJECTED',
                at: d.updatedAt,
                petName: null,
                species: null,
                code: `${d.series}-${String(d.number).padStart(8, '0')}`,
                detail:
                  (d.status === 'REJECTED'
                    ? d.sunatDescription
                    : d.lastError) ??
                  (d.status === 'REJECTED'
                    ? 'SUNAT lo rechazó'
                    : 'No se pudo enviar'),
                link: '/comprobantes',
                query: { estado: 'PROBLEMS', periodo: 'all' },
              })),
            )
        : none,
      // Cambios en la facturación (configuración o token): solo soporte técnico (si hay más
      // de una cuenta de soporte, cada una ve lo que cambió la otra)
      user.support
        ? this.prisma.auditLog
            .findMany({
              where: {
                clinicId,
                action: {
                  in: ['billing.settings_update', 'billing.token_update'],
                },
                createdAt: { gte: since },
                userId: { not: me },
              },
              orderBy: { createdAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                action: true,
                createdAt: true,
                user: { select: { fullName: true } },
              },
            })
            .then((rows) =>
              rows.map<NotificationEvent>((a) => ({
                id: `billingConfig:${a.id}`,
                kind: 'billingConfig',
                urgent: false,
                at: a.createdAt,
                petName: null,
                species: null,
                detail: `${
                  a.action === 'billing.token_update'
                    ? 'Se actualizó el token del PSE'
                    : 'Se cambió la configuración de facturación'
                } · ${a.user?.fullName ?? 'el sistema'}`,
                link: '/comprobantes/configuracion',
              })),
            )
        : none,
      // Resultados de exámenes que llegaron hoy: los veterinarios (los revisan antes de avisar)
      vet
        ? this.prisma.labOrder
            .findMany({
              where: {
                clinicId,
                status: 'RESULT_READY',
                resultAt: { gte: since },
                resultById: { not: me },
              },
              orderBy: { resultAt: 'desc' },
              take: LIMIT,
              select: {
                id: true,
                visitId: true,
                resultAt: true,
                pet: { select: { name: true, species: true } },
                items: { select: { name: true } },
              },
            })
            .then((rows) =>
              rows.map<NotificationEvent>((o) => ({
                id: `labResult:${o.id}`,
                kind: 'labResult',
                urgent: false,
                at: o.resultAt!,
                petName: o.pet.name,
                species: o.pet.species,
                detail: `Resultado listo para revisar · ${o.items.map((i) => i.name).join(', ')}`,
                link: `/atenciones/${o.visitId}`,
              })),
            )
        : none,
    ]);
    return [...stopped, ...lists.flat()]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 30);
  }
}
