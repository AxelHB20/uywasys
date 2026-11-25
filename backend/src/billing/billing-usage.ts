import { clinicDay, startOfDayIn } from '../common/time/clinic-day.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Comprobantes enviados al PSE en el mes en curso (hora de la clínica): lo que cuenta el plan */
export async function documentsThisMonth(
  prisma: PrismaService,
  clinicId: number,
  timezone: string,
): Promise<number> {
  const today = clinicDay(timezone);
  return prisma.electronicDocument.count({
    where: {
      clinicId,
      provider: { not: 'SIMULATED' },
      createdAt: { gte: startOfDayIn(timezone, `${today.slice(0, 8)}01`) },
    },
  });
}

/** Una fecha @db.Date como YYYY-MM-DD (o nulo) */
export const isoDay = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;
