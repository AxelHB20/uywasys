export type ExpiryLevel = 'EXPIRED' | 'RED' | 'YELLOW' | 'GREEN';

export interface ExpiryStatus {
  /** Días que faltan (negativo si ya venció) */
  days: number;
  level: ExpiryLevel;
}

/**
 * Semáforo de vencimientos con fechas de la clínica (AAAA-MM-DD):
 * vencido · rojo hasta 30 días · amarillo de 31 a 60 · verde más de 60.
 */
export function expiryStatus(
  expiresAt: string | null,
  today: string,
): ExpiryStatus | null {
  if (!expiresAt) return null;
  const days = Math.round(
    (Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  const level: ExpiryLevel =
    days < 0 ? 'EXPIRED' : days <= 30 ? 'RED' : days <= 60 ? 'YELLOW' : 'GREEN';
  return { days, level };
}

/** AAAA-MM-DD sumando días (para "vence en los próximos N días"). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
