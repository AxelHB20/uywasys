import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import type { AuthUser } from '../common/auth/auth-user.js';
import {
  clinicDay,
  fromDbDate,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import type {
  AppointmentStatus,
  Species,
  VisitType,
} from '../generated/prisma/enums.js';
import { ImmunizationsService } from '../medical/immunizations.service.js';
import { PortalService } from '../portal/portal.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { clientsWithPush, reminderMarks } from './reminder-marks.js';
import type { ReminderMark } from './reminder-marks.js';
import type { MarkReminderDto, PushSubscribeDto } from './reminders.dto.js';

const DAY_MS = 86_400_000;
/** Días antes del refuerzo en que sale el aviso automático */
export const VACCINE_NOTICE_DAYS = 3;
/** Horario en que se mandan avisos automáticos (hora de la clínica): nadie quiere uno a las 6:00 */
export const NOTICE_HOURS = { from: 9, to: 20 };

export interface TomorrowAppointment {
  id: number;
  startsAt: Date;
  durationMin: number;
  type: VisitType;
  reason: string | null;
  status: AppointmentStatus;
  vet: string | null;
  pet: { id: number; number: number; name: string; species: Species };
  client: { id: number; name: string; phone: string };
  reminded: ReminderMark[];
  autoNotice: boolean;
}

interface PushPayload {
  title: string;
  body: string;
  tag: string;
}

const dayAfter = (day: string) =>
  fromDbDate(new Date(toDbDate(day).getTime() + DAY_MS))!;

const hourIn = (timeZone: string, at: Date) =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(at),
  );

const shortDate = (day: string) =>
  new Intl.DateTimeFormat('es-PE', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(toDbDate(day));

/**
 * Recordatorios sin costo por mensaje: recepción marca a quién avisó por WhatsApp, y a los dueños
 * que activaron los avisos en su portal les llega una notificación al celular (Web Push con
 * claves VAPID propias). Cada refuerzo o cita se avisa una sola vez por canal.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private keys?: { publicKey: string; privateKey: string };
  private readonly subject: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly portal: PortalService,
    private readonly immunizations: ImmunizationsService,
    config: ConfigService,
  ) {
    this.subject =
      config.get<string>('VAPID_SUBJECT') ?? 'mailto:soporte@uywa.pe';
  }

  /** Claves VAPID: se generan la primera vez y quedan en la base (entran en los respaldos) */
  async vapid(): Promise<{ publicKey: string; privateKey: string }> {
    if (this.keys) return this.keys;
    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: 'vapid' },
    });
    if (stored) return (this.keys = JSON.parse(stored.value));
    await this.prisma.systemSetting.createMany({
      data: [
        { key: 'vapid', value: JSON.stringify(webpush.generateVAPIDKeys()) },
      ],
      skipDuplicates: true,
    });
    const created = await this.prisma.systemSetting.findUniqueOrThrow({
      where: { key: 'vapid' },
    });
    return (this.keys = JSON.parse(created.value));
  }

  async publicKey(): Promise<string> {
    return (await this.vapid()).publicKey;
  }

  // ── Portal del dueño ──

  async subscribe(token: string, dto: PushSubscribeDto): Promise<void> {
    const link = await this.portal.resolve(token);
    const data = {
      clinicId: link.clinicId,
      clientId: link.clientId,
      portalLinkId: link.id,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { ...data, endpoint: dto.endpoint },
      update: data,
    });
  }

  async unsubscribe(token: string, endpoint: string): Promise<void> {
    const link = await this.portal.resolve(token);
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint, clientId: link.clientId },
    });
  }

  // ── Recepción ──

  /** Citas de mañana para avisar (agendadas o confirmadas) */
  async tomorrow(
    clinicId: number,
    now = new Date(),
  ): Promise<TomorrowAppointment[]> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const day = dayAfter(clinicDay(timezone, now));
    const rows = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: {
          gte: startOfDayIn(timezone, day),
          lt: startOfDayIn(timezone, dayAfter(day)),
        },
        client: { active: true, anonymizedAt: null },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        durationMin: true,
        type: true,
        reason: true,
        status: true,
        vet: { select: { fullName: true } },
        pet: { select: { id: true, number: true, name: true, species: true } },
        client: { select: { id: true, name: true, phone: true } },
      },
    });
    const [marks, withPush] = await Promise.all([
      reminderMarks(
        this.prisma,
        clinicId,
        'APPOINTMENT',
        rows.map((r) => r.id),
      ),
      clientsWithPush(
        this.prisma,
        clinicId,
        [...new Set(rows.map((r) => r.client.id))],
        now,
      ),
    ]);
    return rows.map((r) => ({
      ...r,
      vet: r.vet?.fullName ?? null,
      reminded: marks.get(r.id) ?? [],
      autoNotice: withPush.has(r.client.id),
    }));
  }

  /** Recepción abrió el WhatsApp de ese aviso: queda marcado para no repetirlo */
  async markSent(
    actor: AuthUser,
    dto: MarkReminderDto,
  ): Promise<ReminderMark[]> {
    const exists =
      dto.kind === 'VACCINE'
        ? await this.prisma.immunization.count({
            where: { id: dto.targetId, clinicId: actor.clinicId },
          })
        : await this.prisma.appointment.count({
            where: { id: dto.targetId, clinicId: actor.clinicId },
          });
    if (!exists) throw new NotFoundException('Ese aviso no existe');
    await this.prisma.reminderLog.upsert({
      where: {
        kind_targetId_channel: {
          kind: dto.kind,
          targetId: dto.targetId,
          channel: 'WHATSAPP',
        },
      },
      create: {
        clinicId: actor.clinicId,
        kind: dto.kind,
        targetId: dto.targetId,
        channel: 'WHATSAPP',
        sentById: actor.id,
      },
      update: { sentById: actor.id, sentAt: new Date() },
    });
    const marks = await reminderMarks(this.prisma, actor.clinicId, dto.kind, [
      dto.targetId,
    ]);
    return marks.get(dto.targetId) ?? [];
  }

  // ── Avisos automáticos ──

  /** Manda lo que toca ahora. Devuelve cuántos avisos llegaron al menos a un celular. */
  async sendDue(now = new Date()): Promise<number> {
    const clinics = await this.prisma.clinic.findMany({
      where: {
        active: true,
        portalLinks: {
          some: {
            revokedAt: null,
            expiresAt: { gt: now },
            pushSubscriptions: { some: {} },
          },
        },
      },
      select: { id: true, name: true, timezone: true },
    });
    let sent = 0;
    for (const clinic of clinics) {
      const hour = hourIn(clinic.timezone, now);
      if (hour < NOTICE_HOURS.from || hour >= NOTICE_HOURS.to) continue;
      sent += await this.sendForClinic(clinic, now);
    }
    return sent;
  }

  private async sendForClinic(
    clinic: { id: number; name: string; timezone: string },
    now: Date,
  ): Promise<number> {
    let sent = 0;
    const due = (
      await this.immunizations.due(clinic.id, {
        status: 'upcoming',
        days: VACCINE_NOTICE_DAYS,
      })
    ).filter(
      (d) => d.autoNotice && !d.reminded.some((m) => m.channel === 'PUSH'),
    );
    for (const d of due) {
      const when =
        d.daysLeft === 0
          ? 'hoy'
          : d.daysLeft === 1
            ? 'mañana'
            : `el ${shortDate(d.nextDueAt)}`;
      const ok = await this.notify(clinic.id, d.client.id, {
        title: `${d.pet.name}: le toca ${d.name}`,
        body: `Su refuerzo es ${when}. Pide tu cita en ${clinic.name}.`,
        tag: `imm-${d.id}`,
      });
      if (ok) sent += await this.log(clinic.id, 'VACCINE', d.id);
    }
    const appointments = (await this.tomorrow(clinic.id, now)).filter(
      (a) => a.autoNotice && !a.reminded.some((m) => m.channel === 'PUSH'),
    );
    const time = new Intl.DateTimeFormat('es-PE', {
      timeZone: clinic.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    for (const a of appointments) {
      const ok = await this.notify(clinic.id, a.client.id, {
        title: `Mañana: cita de ${a.pet.name}`,
        body: `${time.format(a.startsAt)} en ${clinic.name}${a.reason ? ` · ${a.reason}` : ''}.`,
        tag: `appt-${a.id}`,
      });
      if (ok) sent += await this.log(clinic.id, 'APPOINTMENT', a.id);
    }
    return sent;
  }

  private async log(
    clinicId: number,
    kind: 'VACCINE' | 'APPOINTMENT',
    targetId: number,
  ): Promise<number> {
    const { count } = await this.prisma.reminderLog.createMany({
      data: [{ clinicId, kind, targetId, channel: 'PUSH' }],
      skipDuplicates: true,
    });
    return count;
  }

  /** Envía a todos los celulares del dueño; borra los que el navegador ya no acepta */
  private async notify(
    clinicId: number,
    clientId: number,
    payload: PushPayload,
  ): Promise<boolean> {
    const subs = await this.prisma.pushSubscription.findMany({
      where: {
        clinicId,
        clientId,
        portalLink: { revokedAt: null, expiresAt: { gt: new Date() } },
      },
    });
    const { publicKey, privateKey } = await this.vapid();
    let delivered = false;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          {
            vapidDetails: { subject: this.subject, publicKey, privateKey },
            TTL: 12 * 3600,
          },
        );
        delivered = true;
        await this.prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastSentAt: new Date() },
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
        else
          this.logger.warn(
            `No se pudo enviar el aviso ${payload.tag} (${status ?? 'sin respuesta'})`,
          );
      }
    }
    return delivered;
  }
}
