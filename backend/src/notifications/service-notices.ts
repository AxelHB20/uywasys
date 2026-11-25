import type { SystemBanner } from './notifications.service.js';

/** Lo que se vigila para avisar antes de que algo se detenga */
export interface ServiceWatch {
  /** Hoy en la zona de la clínica, YYYY-MM-DD */
  today: string;
  /** Proveedor con facturación activa (nulo = apagada o en simulación) */
  provider: string | null;
  tokenUpdatedAt: Date | null;
  monthlyQuota: number | null;
  /** Comprobantes enviados al PSE este mes */
  usedThisMonth: number;
  planExpiresOn: string | null;
  domainExpiresOn: string | null;
  serverExpiresOn: string | null;
}

/** Mifact cambia el token cada ~6 meses: se avisa a los 5 */
export const TOKEN_WARN_DAYS = 150;
/** Vencimientos: aviso ámbar desde 30 días antes, rojo desde 7 */
export const DUE_WARN_DAYS = 30;
export const DUE_DANGER_DAYS = 7;
/** Cupo del mes: aviso ámbar al 80 % */
export const QUOTA_WARN = 0.8;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
/** "3 de diciembre" */
const dayLabel = (iso: string) =>
  `${Number(iso.slice(8, 10))} de ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const inDays = (n: number) =>
  n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`;

const DUE: Record<
  'plan' | 'domain' | 'server',
  { what: (p: string) => string; why: string }
> = {
  plan: {
    what: (p) => `El plan de ${p}`,
    why: 'Renuévalo para que la facturación no se detenga.',
  },
  domain: {
    what: () => 'El dominio',
    why: 'Renuévalo para que el sistema siga abriendo en su dirección.',
  },
  server: {
    what: () => 'El servidor',
    why: 'Renuévalo para que el sistema no se apague.',
  },
};

const PROVIDER_NAMES: Record<string, string> = {
  MIFACT: 'Mifact',
  NUBEFACT: 'Nubefact',
  LUCODE: 'Lucode',
};

/**
 * Avisos para el administrador antes de que algo se detenga: token del PSE viejo, cupo del mes
 * por acabarse y vencimientos del plan del PSE, del dominio y del servidor. Los rojos van primero.
 */
export function serviceNotices(w: ServiceWatch): SystemBanner[] {
  const out: SystemBanner[] = [];
  const pse = w.provider ? (PROVIDER_NAMES[w.provider] ?? 'el PSE') : 'el PSE';

  // Cupo del mes (solo con facturación real activa)
  if (w.provider && w.monthlyQuota && w.monthlyQuota > 0) {
    const month = w.today.slice(0, 7);
    const left = w.monthlyQuota - w.usedThisMonth;
    const monthName = MONTHS[Number(w.today.slice(5, 7)) - 1];
    if (left <= 0)
      out.push({
        id: `quota:${month}:full`,
        tone: 'danger',
        title: `Se acabaron los comprobantes de ${monthName}`,
        detail: `Van ${w.usedThisMonth} de ${w.monthlyQuota} del plan. ${pse} puede rechazar los siguientes hasta el 1 del próximo mes: amplía el plan con ${pse}.`,
        dismissible: false,
      });
    else if (w.usedThisMonth >= w.monthlyQuota * QUOTA_WARN)
      out.push({
        id: `quota:${month}:warn`,
        tone: 'warning',
        title: `Usaste ${w.usedThisMonth} de ${w.monthlyQuota} comprobantes de ${monthName}`,
        detail: `Quedan ${left}. Si se acaban, ${pse} puede rechazar los siguientes hasta el 1 del próximo mes.`,
        dismissible: true,
      });
  }

  // Vencimientos
  for (const [key, on] of [
    ['plan', w.planExpiresOn],
    ['domain', w.domainExpiresOn],
    ['server', w.serverExpiresOn],
  ] as const) {
    if (!on) continue;
    const left = daysBetween(w.today, on);
    if (left > DUE_WARN_DAYS) continue;
    const { what, why } = DUE[key];
    out.push({
      id: `due:${key}:${on}:${left < 0 ? 'past' : left <= DUE_DANGER_DAYS ? 'soon' : 'warn'}`,
      tone: left <= DUE_DANGER_DAYS ? 'danger' : 'warning',
      title:
        left < 0
          ? `${what(pse)} venció el ${dayLabel(on)}`
          : `${what(pse)} vence ${inDays(left)} (${dayLabel(on)})`,
      detail: why,
      // Los ámbar se pueden ocultar hasta mañana; los rojos siguen hasta que se renueve
      dismissible: left > DUE_DANGER_DAYS,
    });
  }

  // Token del PSE con 5 meses o más (Mifact lo cambia cada ~6)
  if (w.provider === 'MIFACT' && w.tokenUpdatedAt) {
    const since = w.tokenUpdatedAt.toISOString().slice(0, 10);
    const age = daysBetween(since, w.today);
    if (age >= TOKEN_WARN_DAYS)
      out.push({
        id: `token-age:${since}`,
        tone: 'warning',
        title: `El token de Mifact tiene ${Math.floor(age / 30)} meses`,
        detail:
          'Mifact lo cambia cada 6 meses más o menos. Cuando te envíe el nuevo, pégalo en "Actualizar token" para que la facturación no se detenga.',
        action: {
          label: 'Actualizar token',
          link: '/comprobantes/configuracion',
        },
        dismissible: true,
      });
  }

  return out.sort(
    (a, b) => Number(b.tone === 'danger') - Number(a.tone === 'danger'),
  );
}
