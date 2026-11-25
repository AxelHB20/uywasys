import type {
  ReminderChannel,
  ReminderKind,
} from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export interface ReminderMark {
  channel: ReminderChannel;
  sentAt: Date;
  /** null = aviso automático al celular */
  by: string | null;
}

/** Avisos ya hechos de cada refuerzo o cita (por WhatsApp desde recepción o automáticos) */
export async function reminderMarks(
  prisma: PrismaService,
  clinicId: number,
  kind: ReminderKind,
  targetIds: number[],
): Promise<Map<number, ReminderMark[]>> {
  const out = new Map<number, ReminderMark[]>();
  if (!targetIds.length) return out;
  const rows = await prisma.reminderLog.findMany({
    where: { clinicId, kind, targetId: { in: targetIds } },
    orderBy: { sentAt: 'asc' },
    select: { targetId: true, channel: true, sentAt: true, sentById: true },
  });
  const userIds = [
    ...new Set(rows.flatMap((r) => (r.sentById ? [r.sentById] : []))),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  for (const r of rows) {
    const list = out.get(r.targetId) ?? [];
    list.push({
      channel: r.channel,
      sentAt: r.sentAt,
      by: r.sentById ? (names.get(r.sentById) ?? null) : null,
    });
    out.set(r.targetId, list);
  }
  return out;
}

/** Clientes que activaron los avisos en su portal vigente: a ellos les llega solo */
export async function clientsWithPush(
  prisma: PrismaService,
  clinicId: number,
  clientIds: number[],
  now = new Date(),
): Promise<Set<number>> {
  if (!clientIds.length) return new Set();
  const rows = await prisma.pushSubscription.findMany({
    where: {
      clinicId,
      clientId: { in: clientIds },
      portalLink: { revokedAt: null, expiresAt: { gt: now } },
    },
    distinct: ['clientId'],
    select: { clientId: true },
  });
  return new Set(rows.map((r) => r.clientId));
}
