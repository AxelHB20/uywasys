import { IconName } from '../../shared/ui/icon/icons';
import { Species } from './clients.models';
import { HeaderAlert } from './dashboard.service';

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

export interface NotificationEvent {
  id: string;
  kind: NotificationKind;
  urgent: boolean;
  at: string;
  petName: string | null;
  species: Species | null;
  detail: string;
  link: string;
  query?: Record<string, string>;
  amount?: number;
  startsAt?: string;
  code?: string;
}

/** Aviso fijo arriba de todas las pantallas mientras dure el problema (p. ej. facturación detenida) */
export interface SystemBanner {
  id: string;
  tone: 'danger' | 'warning';
  title: string;
  detail: string;
  action?: { label: string; link: string };
  /** Rojo: no se oculta hasta resolverse. Ámbar: se oculta hasta mañana */
  dismissible: boolean;
}

export interface NotificationsView {
  alerts: HeaderAlert[];
  events: NotificationEvent[];
  banners?: SystemBanner[];
  seenAt: string | null;
  serverTime: string;
}

export type NotificationTone = 'danger' | 'warning' | 'info' | 'success';

/** Cómo se muestra un evento en la campana y en el aviso emergente */
export interface EventView {
  title: string;
  detail: string;
  icon: IconName;
  tone: NotificationTone;
  /** Texto del botón del aviso emergente */
  action: string;
}

const soles = (n: number) => `S/ ${n.toFixed(2)}`;
const when = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function eventView(e: NotificationEvent): EventView {
  const pet = e.petName ?? '';
  switch (e.kind) {
    case 'arrival':
      return e.urgent
        ? {
            title: `Urgencia: llegó ${pet}`,
            detail: e.detail,
            icon: 'alert',
            tone: 'danger',
            action: 'Ver cola',
          }
        : {
            title: `Llegó ${pet}`,
            detail: e.detail,
            icon: 'clock',
            tone: 'info',
            action: 'Ver cola',
          };
    case 'groomingArrival':
      return {
        title: `${pet} ingresó a grooming`,
        detail: e.detail,
        icon: 'scissors',
        tone: 'info',
        action: 'Ver tablero',
      };
    case 'readyToCharge':
      return {
        title: `${pet}: listo para cobrar`,
        detail: [e.amount ? soles(e.amount) : null, e.detail].filter(Boolean).join(' · '),
        icon: 'receipt',
        tone: 'warning',
        action: 'Cobrar',
      };
    case 'groomingReady':
      return {
        title: `${pet} está listo para entregar`,
        detail: e.detail,
        icon: 'check',
        tone: 'success',
        action: 'Ver tablero',
      };
    case 'appointmentNew':
      return {
        title: `Nueva cita: ${pet}`,
        detail: [e.startsAt ? when.format(new Date(e.startsAt)) : null, e.detail]
          .filter(Boolean)
          .join(' · '),
        icon: 'calendar',
        tone: 'info',
        action: 'Ver citas',
      };
    case 'labResult':
      return {
        title: `${pet}: resultado listo`,
        detail: e.detail,
        icon: 'flask',
        tone: 'warning',
        action: 'Revisar',
      };
    case 'billingConfig':
      return {
        title: 'Cambió la facturación electrónica',
        detail: e.detail,
        icon: 'settings',
        tone: 'info',
        action: 'Ver',
      };
    case 'billingStopped':
      return {
        title: 'La facturación está detenida',
        detail: e.detail,
        icon: 'alert',
        tone: 'danger',
        action: 'Ver qué hacer',
      };
    case 'billingRejected':
      return {
        title: `${e.code} ${e.urgent ? 'rechazado por SUNAT' : 'no se pudo enviar'}`,
        detail: e.detail,
        icon: 'file-text',
        tone: 'danger',
        action: 'Revisar',
      };
  }
}

/** "ahora", "hace 5 min", "hace 2 h" */
export function timeAgo(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h`;
}

export const TONE_TILE: Record<NotificationTone, string> = {
  danger: 'bg-rose-50 text-rose-700',
  warning: 'bg-amber-50 text-amber-800',
  info: 'bg-anil-50 text-anil-700',
  success: 'bg-emerald-50 text-emerald-700',
};
