import type { PrismaService } from '../../prisma/prisma.service.js';
import { clinicDay } from './clinic-day.js';

/** Hoy (AAAA-MM-DD) según la zona horaria configurada de la clínica. */
export async function clinicToday(
  prisma: PrismaService,
  clinicId: number,
): Promise<string> {
  const clinic = await prisma.clinic.findUniqueOrThrow({
    where: { id: clinicId },
    select: { timezone: true },
  });
  return clinicDay(clinic.timezone);
}
