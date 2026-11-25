import { Species } from './clients.models';
import type { GroomingTransport } from './grooming.models';
import type { ReminderMark } from './medical.models';

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'NO_SHOW' | 'CANCELLED';
export type AppointmentType = 'CONSULTATION' | 'GROOMING';

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Por confirmar',
  CONFIRMED: 'Confirmada',
  ARRIVED: 'Llegó',
  NO_SHOW: 'No vino',
  CANCELLED: 'Cancelada',
};

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  CONSULTATION: 'Consulta',
  GROOMING: 'Grooming',
};

export const APPOINTMENT_DURATIONS = [15, 20, 30, 45, 60, 90, 120];

export interface Appointment {
  id: number;
  startsAt: string;
  durationMin: number;
  type: AppointmentType;
  reason: string | null;
  notes: string | null;
  transport: GroomingTransport;
  transportAddress: string | null;
  /** Decimal del servidor: llega como texto */
  transportPrice: string | number | null;
  status: AppointmentStatus;
  cancelReason: string | null;
  queueEntryId: number | null;
  createdAt: string;
  pet: { id: number; number: number; name: string; species: Species; aggressive: boolean };
  client: { id: number; name: string; phone: string };
  vet: { id: number; fullName: string } | null;
  createdBy: { id: number; fullName: string };
  /** Avisos ya hechos de esta cita */
  reminded?: ReminderMark[];
  /** El dueño activó los avisos en su portal: le llega solo */
  autoNotice?: boolean;
}

export interface AgendaStaff {
  id: number;
  fullName: string;
  role: 'ADMIN' | 'VET' | 'GROOMER' | 'RECEPTION' | 'CASHIER';
}

export interface AppointmentInput {
  petId?: number;
  vetId: number | null;
  startsAt: string;
  durationMin: number;
  type: AppointmentType;
  reason: string | null;
  notes: string | null;
  transport?: GroomingTransport;
  transportAddress?: string | null;
  transportPrice?: number | null;
  allowOverlap?: boolean;
}

// ── Horas en Lima (Perú no tiene horario de verano: siempre UTC-5) ──

/** "2026-10-29" + "10:30" → ISO */
export function limaIso(day: string, time: string): string {
  return new Date(`${day}T${time}:00-05:00`).toISOString();
}

const limaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO → { day: AAAA-MM-DD, time: HH:MM, minutes: minutos desde medianoche } en Lima */
export function limaClock(iso: string | Date): { day: string; time: string; minutes: number } {
  const p = Object.fromEntries(
    limaParts
      .formatToParts(typeof iso === 'string' ? new Date(iso) : iso)
      .map((x) => [x.type, x.value]),
  );
  const time = `${p['hour']}:${p['minute']}`;
  return {
    day: `${p['year']}-${p['month']}-${p['day']}`,
    time,
    minutes: Number(p['hour']) * 60 + Number(p['minute']),
  };
}

/** Horas de 15 en 15 para el selector: 07:00 … 21:45 */
export function timeSlots(from = 7, to = 22, step = 15): string[] {
  const slots: string[] = [];
  for (let m = from * 60; m < to * 60; m += step)
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return slots;
}

/** Primer horario de la agenda que todavía no pasó hoy (hora de Lima), o null si ya no queda */
export function nextSlot(now: Date = new Date(), slots = timeSlots()): string | null {
  const { minutes } = limaClock(now);
  return slots.find((s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) >= minutes) ?? null;
}

/**
 * Primer horario libre (de 15 en 15) donde entra una cita de `durationMin`, entre la apertura y el
 * cierre (minutos desde medianoche) y no antes de `after`. null si ya no entra nada ese día.
 */
export function firstFreeSlot(
  busy: Pick<Appointment, 'startsAt' | 'durationMin'>[],
  o: { open: number; close: number; after?: number; durationMin?: number; step?: number },
): string | null {
  const step = o.step ?? 15;
  const dur = o.durationMin ?? 30;
  const ranges = busy.map((a) => {
    const s = limaClock(a.startsAt).minutes;
    return [s, s + a.durationMin] as const;
  });
  const from = Math.max(o.open, Math.ceil((o.after ?? 0) / step) * step);
  for (let m = Math.ceil(from / step) * step; m + dur <= o.close; m += step)
    if (!ranges.some(([s, e]) => m < e && m + dur > s))
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return null;
}

/** "10:00 – 10:30" */
export function timeRange(a: Pick<Appointment, 'startsAt' | 'durationMin'>): string {
  const start = limaClock(a.startsAt);
  const endMin = start.minutes + a.durationMin;
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  return `${start.time} – ${end}`;
}

/** Mensaje de WhatsApp para confirmar la cita */
export function confirmationLink(a: Appointment, clinicName: string, dayLabel: string): string {
  const { time } = limaClock(a.startsAt);
  const what = a.type === 'GROOMING' ? 'su turno de grooming' : 'su cita';
  const text = `Hola, le escribimos de ${clinicName}. Le recordamos ${what} para ${a.pet.name} el ${dayLabel} a las ${time}. ¿Nos confirma su asistencia?`;
  return `https://wa.me/51${a.client.phone}?text=${encodeURIComponent(text)}`;
}

/**
 * Carriles para citas que se cruzan en la misma columna (sobrecupo): cada cita recibe su
 * carril y cuántos carriles tiene su grupo, para dibujarlas lado a lado.
 */
export function layoutLanes<T extends Pick<Appointment, 'id' | 'startsAt' | 'durationMin'>>(
  items: T[],
): Map<number, { lane: number; lanes: number }> {
  const sorted = [...items].sort(
    (a, b) => limaClock(a.startsAt).minutes - limaClock(b.startsAt).minutes,
  );
  const result = new Map<number, { lane: number; lanes: number }>();
  let group: { id: number; end: number; lane: number }[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) result.set(g.id, { lane: g.lane, lanes });
    group = [];
  };
  for (const item of sorted) {
    const start = limaClock(item.startsAt).minutes;
    const end = start + item.durationMin;
    if (start >= groupEnd) {
      flush();
      groupEnd = end;
    } else groupEnd = Math.max(groupEnd, end);
    const busy = new Set(group.filter((g) => g.end > start).map((g) => g.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    group.push({ id: item.id, end, lane });
  }
  flush();
  return result;
}
