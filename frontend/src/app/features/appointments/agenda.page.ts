import { TRANSPORT_LABELS } from '../../core/services/grooming.models';
import { money } from '../../shared/utils/stock';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES } from '../../core/services/clients.models';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  AgendaStaff,
  Appointment,
  AppointmentStatus,
  confirmationLink,
  firstFreeSlot,
  layoutLanes,
  limaClock,
  timeRange,
} from '../../core/services/appointments.models';
import { AppointmentsService } from '../../core/services/appointments.service';
import { ClinicService } from '../../core/services/clinic.service';
import { MonthPickerComponent } from './month-picker.component';
import { ReminderMark, addDays } from '../../core/services/medical.models';
import { RemindersService } from '../../core/services/reminders.service';
import { IconName } from '../../shared/ui/icon/icons';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';
import { AppointmentDraft, AppointmentFormComponent } from './appointment-form.component';
import { loaded } from '../../shared/utils/resource';

/** Alto de una hora en la grilla (px): 30 minutos alcanzan para hora, paciente y motivo */
const HOUR_PX = 88;
/** Semana: 76 px por hora, una cita de 30 min muestra hora, paciente y motivo */
const WEEK_PX = 76;
const VIEW_KEY = 'uywa.agenda.vista';
const UNASSIGNED = 0;

interface Column {
  id: number;
  name: string;
  role: AgendaStaff['role'] | null;
  items: Appointment[];
}

const ROLE_LABEL: Record<AgendaStaff['role'], string> = {
  ADMIN: 'Veterinaria · admin.',
  VET: 'Veterinario',
  GROOMER: 'Grooming',
  RECEPTION: 'Recepción',
  CASHIER: 'Caja',
};

/** Color del avatar de cada columna (se repite si hay muchos) */
const AVATAR_TINTS = [
  'bg-anil-100 text-anil-800',
  'bg-emerald-100 text-emerald-800',
  'bg-violet-100 text-violet-800',
  'bg-sky-100 text-sky-800',
  'bg-amber-100 text-amber-900',
];

/** "Dra. Lucía Ruiz Paredes" → "LR" */
export function initials(name: string): string {
  const words = name
    .replace(/^(dra?|lic|mv)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·';
}

/** Nombre corto para la cabecera de la columna: "Dra. Lucía Ruiz Paredes" → "Dra. Lucía R." (el completo va en el title) */
export function shortName(name: string): string {
  const title = /^(dra?|lic|mv)\.?\s+/i.exec(name)?.[0] ?? '';
  const [first, last] = name.slice(title.length).split(/\s+/).filter(Boolean);
  if (!first) return name;
  return `${title}${first}${last ? ` ${last[0]}.` : ''}`;
}

/** Bloque de la cita: fondo y borde por estado; "por confirmar" va punteado (no solo el color lo dice) */
const STATUS_STYLE: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-amber-50/70 border-dashed border-amber-400',
  CONFIRMED: 'bg-anil-50 border-anil-200',
  ARRIVED: 'bg-emerald-50 border-emerald-200',
  NO_SHOW: 'bg-slate-50 border-slate-200',
  CANCELLED: 'bg-slate-50 border-slate-200',
};

/** Franja de la izquierda del bloque y de la fila del celular */
const STATUS_BAR: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-amber-400',
  CONFIRMED: 'bg-anil-500',
  ARRIVED: 'bg-emerald-500',
  NO_SHOW: 'bg-slate-300',
  CANCELLED: 'bg-slate-300',
};

const STATUS_CHIP: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-amber-50 text-amber-800 ring-amber-200',
  CONFIRMED: 'bg-anil-50 text-anil-800 ring-anil-200',
  ARRIVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  NO_SHOW: 'bg-slate-100 text-slate-700 ring-slate-200',
  CANCELLED: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/** Vista con la que se abrió la agenda la última vez (si el navegador lo permite) */
function savedView(): 'day' | 'week' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'semana' ? 'week' : 'day';
  } catch {
    return 'day';
  }
}

const shortWeekday = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'short' });
const monthName = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', month: 'long' });
const utc = (day: string) => new Date(`${day}T12:00:00Z`);

/** Lunes de la semana del día */
export function weekStart(day: string): string {
  return addDays(day, -((utc(day).getUTCDay() + 6) % 7));
}

const STATUS_DOT: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-amber-500',
  CONFIRMED: 'bg-anil-600',
  ARRIVED: 'bg-emerald-600',
  NO_SHOW: 'bg-slate-400',
  CANCELLED: 'bg-slate-300',
};

const longDay = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * Agenda del día: una columna por veterinario (y "Sin asignar"), las citas en su hora y una
 * línea con la hora actual. Clic en un hueco = cita nueva a esa hora con ese veterinario.
 */
const clockFormat = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

@Component({
  host: {
    '(document:click)': 'closePending($event)',
    '(document:keydown.escape)': 'pendingOpen.set(false)',
  },
  selector: 'app-agenda-page',
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    RouterLink,
    IconComponent,
    ModalComponent,
    AppointmentFormComponent,
    MonthPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agenda.page.html',
})
export class AgendaPage implements OnDestroy {
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly money = money;
  private readonly api = inject(AppointmentsService);
  private readonly clinicApi = inject(ClinicService);
  private readonly session = inject(SessionService);
  /** Caja y groomer no abren la historia clínica */
  protected readonly canSeeRecord = computed(() =>
    ['ADMIN', 'VET', 'RECEPTION'].includes(this.session.role() ?? ''),
  );
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly reminders = inject(RemindersService);

  // Parámetros de la URL (?fecha=…&nueva=1&petId=…&mascota=…&cliente=…&motivo=…)
  readonly fecha = input<string>();
  readonly nueva = input<string>();
  readonly petId = input<string>();
  readonly mascota = input<string>();
  readonly cliente = input<string>();
  readonly motivo = input<string>();
  /** ?vista=semana | dia */
  readonly vista = input<string>();

  protected readonly statusLabels = APPOINTMENT_STATUS_LABELS;
  protected readonly typeLabels = APPOINTMENT_TYPE_LABELS;
  protected readonly statusStyle = STATUS_STYLE;
  protected readonly statusDot = STATUS_DOT;
  protected readonly statusBar = STATUS_BAR;
  protected readonly statusChip = STATUS_CHIP;
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly avatarTints = AVATAR_TINTS;
  protected readonly initials = initials;
  protected readonly shortName = shortName;
  /** Menú "Por confirmar" del encabezado */
  protected readonly pendingOpen = signal(false);
  private readonly pendingBox = viewChild<ElementRef<HTMLElement>>('pendingBox');
  protected readonly remindedCount = computed(
    () => this.toConfirm().filter((a) => this.remindedOf(a).length).length,
  );
  protected closePending(event: Event): void {
    const box = this.pendingBox()?.nativeElement;
    if (this.pendingOpen() && box && !box.contains(event.target as Node))
      this.pendingOpen.set(false);
  }
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly timeRange = timeRange;
  protected readonly hourPx = HOUR_PX;
  protected readonly legend: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED'];
  protected readonly today = limaToday();

  protected readonly day = signal(this.today);
  protected readonly vetFilter = signal<number | null>(null);
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );

  protected readonly staffRes = rxResource({ stream: () => this.api.staff() });
  private readonly staffList = loaded(this.staffRes);
  protected readonly staff = computed<AgendaStaff[]>(() => this.staffList() ?? []);
  /** Se trae la semana entera: la tira de días muestra cuántas citas tiene cada uno */
  protected readonly week = computed(() => weekStart(this.day()));
  protected readonly list = rxResource({
    params: () => ({ from: this.week() }),
    stream: ({ params }) =>
      params.from ? this.api.list({ from: params.from, to: addDays(params.from, 6) }) : of([]),
  });
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  protected readonly data = loaded(this.list);
  private readonly weekItems = computed(() => this.data() ?? []);
  protected readonly items = computed(() =>
    this.weekItems().filter((a) => limaClock(a.startsAt).day === this.day()),
  );
  /** Lun a dom con sus citas (sin las canceladas, igual que el resumen del día) */
  protected readonly weekDays = computed(() => {
    const counts = new Map<string, { total: number; pending: number }>();
    for (const a of this.weekItems()) {
      if (a.status === 'CANCELLED') continue;
      const d = limaClock(a.startsAt).day;
      const c = counts.get(d) ?? { total: 0, pending: 0 };
      c.total++;
      if (a.status === 'SCHEDULED') c.pending++;
      counts.set(d, c);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(this.week(), i);
      const wd = shortWeekday.format(utc(day)).replace('.', '');
      return {
        day,
        weekday: wd.charAt(0).toUpperCase() + wd.slice(1),
        number: Number(day.slice(8)),
        total: counts.get(day)?.total ?? 0,
        pending: counts.get(day)?.pending ?? 0,
        dots: Array.from({ length: Math.min(4, counts.get(day)?.total ?? 0) }, (_, n) => n),
        isToday: day === this.today,
        isPast: day < this.today,
      };
    });
  });
  protected readonly weekLabel = computed(() => {
    const from = this.week();
    const to = addDays(from, 6);
    const m1 = monthName.format(utc(from)).toLowerCase();
    const m2 = monthName.format(utc(to)).toLowerCase();
    return m1 === m2
      ? `${Number(from.slice(8))} al ${Number(to.slice(8))} de ${m2}`
      : `${Number(from.slice(8))} de ${m1} al ${Number(to.slice(8))} de ${m2}`;
  });
  protected readonly active = computed(() =>
    this.items()
      .filter(
        (a) =>
          a.status !== 'CANCELLED' &&
          a.status !== 'NO_SHOW' &&
          (this.vetFilter() === null || (a.vet?.id ?? UNASSIGNED) === this.vetFilter()),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  );
  protected readonly inactive = computed(() =>
    this.items().filter((a) => a.status === 'CANCELLED' || a.status === 'NO_SHOW'),
  );
  protected readonly counts = computed(() => {
    const list = this.items().filter((a) => a.status !== 'CANCELLED');
    return {
      total: list.length,
      pending: list.filter((a) => a.status === 'SCHEDULED').length,
      confirmed: list.filter((a) => a.status === 'CONFIRMED').length,
      arrived: list.filter((a) => a.status === 'ARRIVED').length,
    };
  });

  /** Mostrar también a quien no tiene citas ese día (groomers, administrador) */
  protected readonly showAll = signal(false);
  private readonly allColumns = computed<Column[]>(() => {
    const active = this.active();
    const filter = this.vetFilter();
    const people = this.staff().filter((s) => filter === null || s.id === filter);
    const cols: Column[] = people.map((s) => ({
      id: s.id,
      name: s.fullName,
      role: s.role,
      items: active.filter((a) => a.vet?.id === s.id),
    }));
    const unassigned = active.filter((a) => !a.vet);
    if (filter === null && (unassigned.length || !cols.length))
      cols.push({ id: UNASSIGNED, name: 'Sin asignar', role: null, items: unassigned });
    if (filter === UNASSIGNED)
      cols.push({ id: UNASSIGNED, name: 'Sin asignar', role: null, items: unassigned });
    return cols;
  });
  /** Por defecto: los veterinarios y quien tenga citas ese día; el resto con "Ver a todos" */
  protected readonly columns = computed<Column[]>(() => {
    const all = this.allColumns();
    if (this.showAll() || this.vetFilter() !== null) return all;
    const shown = all.filter((c) => c.role === 'VET' || c.role === null || c.items.length);
    return shown.length ? shown : all;
  });
  protected readonly hiddenColumns = computed(
    () => this.allColumns().length - this.columns().length,
  );

  /** Panel lateral: lo que sigue hoy y lo que falta confirmar */
  protected readonly upcoming = computed(() => {
    if (this.day() !== this.today) return [];
    const now = this.nowMinutes();
    return this.active()
      .filter(
        (a) => a.status !== 'ARRIVED' && limaClock(a.startsAt).minutes + a.durationMin > now - 15,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  });
  /** Lo que sigue: todas las citas a la misma hora (pueden ser con distintos profesionales) */
  protected readonly nextGroup = computed(() => {
    const [first, ...rest] = this.upcoming();
    return first ? [first, ...rest.filter((a) => a.startsAt === first.startsAt)] : [];
  });
  /** Día: las del día elegido. Semana: las de la pestaña, de hoy en adelante */
  protected readonly toConfirm = computed(() =>
    (this.isWeek()
      ? this.tabItems().filter((a) => limaClock(a.startsAt).day >= this.today)
      : this.active()
    )
      .filter((a) => a.status === 'SCHEDULED')
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  );
  /** Índice de la primera cita que aún no empieza (para la línea "Ahora" del celular) */
  protected readonly nowIndex = computed(() => {
    if (this.day() !== this.today) return -1;
    const now = this.nowMinutes();
    return this.active().findIndex((a) => limaClock(a.startsAt).minutes >= now);
  });
  protected readonly nowLabel = computed(() => {
    const m = this.nowMinutes();
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });

  // ── Horario de atención (Clínica → Horario): se sombrea lo cerrado ──
  private readonly openingRes = rxResource({ stream: () => this.clinicApi.hours() });
  /** Apertura y cierre del día elegido en minutos; null si ese día no se atiende o no hay datos */
  protected readonly dayHours = computed(() => this.hoursOf(this.day()));

  /** Apertura y cierre de un día en minutos: null si no se atiende, undefined si no hay horario */
  protected hoursOf(day: string): { open: number; close: number } | null | undefined {
    const list = this.openingRes.hasValue() ? this.openingRes.value() : [];
    if (!list.length) return undefined;
    const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const d = list.find((h) => h.day === weekday);
    if (!d?.open || !d.close) return null;
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return { open: toMin(d.open), close: toMin(d.close) };
  }

  /** Franjas sombreadas: antes de abrir, después de cerrar o el día entero si no se atiende */
  protected readonly closedBlocks = computed(() => {
    const hours = this.hours();
    const start = hours[0] * 60;
    const end = (hours[hours.length - 1] + 1) * 60;
    const px = (min: number) => ((min - start) * HOUR_PX) / 60;
    const h = this.dayHours();
    if (h === undefined) return [];
    if (h === null) return [{ top: 0, height: px(end), label: 'Cerrado este día' }];
    const blocks: { top: number; height: number; label: string }[] = [];
    if (h.open > start) blocks.push({ top: 0, height: px(h.open), label: 'Antes de abrir' });
    if (h.close < end)
      blocks.push({ top: px(h.close), height: px(end) - px(h.close), label: 'Cerrado' });
    return blocks;
  });

  /** Lo que ya pasó se ve atenuado (todo el día si es un día anterior) */
  protected readonly pastHeight = computed(() => {
    const total = this.hours().length * HOUR_PX;
    if (this.day() < this.today) return total;
    if (this.day() > this.today) return 0;
    const top = ((this.nowMinutes() - this.hours()[0] * 60) * HOUR_PX) / 60;
    return Math.min(Math.max(top, 0), total);
  });

  /** Horas visibles: el horario de atención (o de 8 a 20), y más si hay citas fuera de él */
  protected readonly hours = computed(() => {
    const h = this.dayHours();
    let from = h ? Math.floor(h.open / 60) : 8;
    let to = h ? Math.ceil(h.close / 60) : 20;
    for (const a of this.active()) {
      const start = limaClock(a.startsAt).minutes;
      from = Math.min(from, Math.floor(start / 60));
      to = Math.max(to, Math.ceil((start + a.durationMin) / 60));
    }
    return Array.from({ length: to - from }, (_, i) => from + i);
  });
  protected readonly lanes = computed(() => {
    const map = new Map<number, { lane: number; lanes: number }>();
    for (const col of this.columns())
      for (const [id, lane] of layoutLanes(col.items)) map.set(id, lane);
    return map;
  });

  // ── Vista semana ──
  protected readonly view = signal<'day' | 'week'>(savedView());
  protected readonly isWeek = computed(() => this.view() === 'week');
  protected readonly weekPx = WEEK_PX;
  protected readonly views = [
    { id: 'day' as const, label: 'Día' },
    { id: 'week' as const, label: 'Semana' },
  ];
  protected readonly weekOfToday = weekStart(this.today);
  /** Pestaña elegida (médico o todo el equipo); null = la de por defecto */
  private readonly weekTab = signal<number | 'ALL' | null>(null);
  private readonly weekActive = computed(() =>
    this.weekItems()
      .filter((a) => a.status !== 'CANCELLED' && a.status !== 'NO_SHOW')
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  );
  /** Pestañas: los veterinarios, quien tenga citas en la semana y "Sin asignar" si hay */
  protected readonly weekPeople = computed(() => {
    const items = this.weekActive();
    const people = this.staff()
      .map((s, i) => ({
        id: s.id,
        name: s.fullName,
        role: s.role as AgendaStaff['role'] | null,
        tint: AVATAR_TINTS[i % AVATAR_TINTS.length],
        items: items.filter((a) => a.vet?.id === s.id),
      }))
      .filter((p) => p.role === 'VET' || p.items.length);
    const unassigned = items.filter((a) => !a.vet);
    if (unassigned.length)
      people.push({
        id: UNASSIGNED,
        name: 'Sin asignar',
        role: null,
        tint: 'bg-slate-100 text-slate-600',
        items: unassigned,
      });
    return people.map((p) => ({
      ...p,
      pending: p.items.filter((a) => a.status === 'SCHEDULED').length,
    }));
  });
  /** El médico entra a su propia semana; recepción y administración, a todo el equipo */
  protected readonly tab = computed<number | 'ALL'>(() => {
    const t = this.weekTab();
    const people = this.weekPeople();
    if (t === 'ALL' || (t !== null && people.some((p) => p.id === t))) return t;
    const me = this.session.user()?.id;
    return ['VET', 'GROOMER'].includes(this.session.role() ?? '') && people.some((p) => p.id === me)
      ? me!
      : 'ALL';
  });
  protected readonly tabPerson = computed(() => {
    const t = this.tab();
    return t === 'ALL' ? null : (this.weekPeople().find((p) => p.id === t) ?? null);
  });
  private readonly tabItems = computed(() => {
    const t = this.tab();
    return this.weekActive().filter((a) => t === 'ALL' || (a.vet?.id ?? UNASSIGNED) === t);
  });
  protected readonly weekCounts = computed(() => ({
    total: this.tabItems().length,
    pending: this.tabItems().filter((a) => a.status === 'SCHEDULED').length,
  }));
  /** Los 7 días con las citas de la pestaña */
  private readonly weekBase = computed(() => {
    const items = this.tabItems();
    return this.weekDays().map((d) => {
      const list = items.filter((a) => limaClock(a.startsAt).day === d.day);
      return {
        ...d,
        hours: this.hoursOf(d.day),
        items: list,
        pending: list.filter((a) => a.status === 'SCHEDULED').length,
      };
    });
  });
  /** Horas visibles de la semana: el horario más amplio y lo que haga falta para las citas */
  protected readonly weekHours = computed(() => {
    let from = 24;
    let to = 0;
    for (const d of this.weekBase()) {
      if (d.hours) {
        from = Math.min(from, Math.floor(d.hours.open / 60));
        to = Math.max(to, Math.ceil(d.hours.close / 60));
      }
      for (const a of d.items) {
        const start = limaClock(a.startsAt).minutes;
        from = Math.min(from, Math.floor(start / 60));
        to = Math.max(to, Math.ceil((start + a.durationMin) / 60));
      }
    }
    if (from >= to) [from, to] = [8, 20];
    return Array.from({ length: to - from }, (_, i) => from + i);
  });
  protected readonly weekCols = computed(() => {
    const hours = this.weekHours();
    const start = hours[0] * 60;
    const end = (hours[hours.length - 1] + 1) * 60;
    const px = (min: number) => ((min - start) * WEEK_PX) / 60;
    return this.weekBase().map((d) => {
      const closed: { top: number; height: number }[] = [];
      if (d.hours === null) closed.push({ top: 0, height: px(end) });
      else if (d.hours) {
        if (d.hours.open > start) closed.push({ top: 0, height: px(d.hours.open) });
        if (d.hours.close < end)
          closed.push({ top: px(d.hours.close), height: px(end) - px(d.hours.close) });
      }
      const past = d.isPast
        ? px(end)
        : d.isToday
          ? Math.min(Math.max(px(this.nowMinutes()), 0), px(end))
          : 0;
      return { ...d, closed, past, lanes: layoutLanes(d.items) };
    });
  });
  /** Todo el equipo: citas por médico y día */
  protected readonly teamCells = computed(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of this.weekActive()) {
      const key = `${a.vet?.id ?? UNASSIGNED}|${limaClock(a.startsAt).day}`;
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  });
  protected cell(personId: number, day: string): Appointment[] {
    return this.teamCells().get(`${personId}|${day}`) ?? [];
  }

  protected setView(view: 'day' | 'week'): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view === 'week' ? 'semana' : 'dia');
    } catch {
      /* sin almacenamiento: solo dura esta visita */
    }
    this.syncUrl();
  }

  /** El médico de la pestaña (null en "Todo el equipo") */
  protected tabVet(): number | null {
    const t = this.tab();
    return t === 'ALL' ? null : t;
  }

  protected setTab(tab: number | 'ALL'): void {
    this.weekTab.set(tab);
  }

  /** Del resumen de la semana al día (de un médico o de todos) */
  protected openDay(day: string, vetId: number | null = null): void {
    this.vetFilter.set(vetId);
    this.view.set('day');
    this.setDay(day);
  }

  protected wTop(a: Appointment): number {
    return ((limaClock(a.startsAt).minutes - this.weekHours()[0] * 60) * WEEK_PX) / 60;
  }

  protected wHeight(a: Appointment): number {
    return Math.max((a.durationMin * WEEK_PX) / 60, 20);
  }

  protected weekNowTop(): number | null {
    const top = ((this.nowMinutes() - this.weekHours()[0] * 60) * WEEK_PX) / 60;
    return top < 0 || top > this.weekHours().length * WEEK_PX ? null : top;
  }

  protected readonly weekHover = signal<{ day: string; minutes: number } | null>(null);

  private weekSlotAt(event: MouseEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.floor(((event.clientY - rect.top) / WEEK_PX) * 4) * 15 + this.weekHours()[0] * 60;
  }

  /** Se puede agendar en ese momento: abierto, no pasado y con permiso */
  private bookable(day: string, minutes: number): boolean {
    if (!this.canEdit() || day < this.today) return false;
    if (day === this.today && minutes < this.nowMinutes() - 14) return false;
    const h = this.hoursOf(day);
    return h === undefined || (h !== null && minutes >= h.open && minutes < h.close);
  }

  protected weekSlotHover(event: MouseEvent, day: string): void {
    const minutes = this.weekSlotAt(event);
    if ((event.target as HTMLElement).closest('button') || !this.bookable(day, minutes)) {
      if (this.weekHover()) this.weekHover.set(null);
      return;
    }
    const cur = this.weekHover();
    if (!cur || cur.day !== day || cur.minutes !== minutes) this.weekHover.set({ day, minutes });
  }

  protected weekSlotClick(event: MouseEvent, day: string): void {
    const minutes = this.weekSlotAt(event);
    if (!this.bookable(day, minutes)) return;
    const t = this.tab();
    this.openNew({ day, time: this.hhmm(minutes), vetId: typeof t === 'number' && t ? t : null });
  }

  /** Se puede agendar algo ese día (para el "+ Agendar" de las celdas vacías) */
  protected canBook(day: string): boolean {
    return this.canEdit() && day >= this.today && this.hoursOf(day) !== null;
  }

  /** Cita nueva con la primera hora libre de ese médico ese día */
  protected bookOn(day: string, vetId: number | null): void {
    const vet = vetId === UNASSIGNED ? null : vetId;
    this.openNew({ day, vetId: vet, time: this.freeTime(day, vet) ?? undefined });
  }

  /** "Nueva cita" del encabezado: el día y el médico que se están mirando */
  protected newAppointment(): void {
    const day = this.day() < this.today ? this.today : this.day();
    const t = this.tab();
    const vetId = this.isWeek() ? (typeof t === 'number' ? t : null) : this.vetFilter();
    this.bookOn(day, vetId);
  }

  /** Primera hora libre del médico (o la primera que no pasó si es "quien esté disponible") */
  protected freeTime(day: string, vetId: number | null): string | null {
    if (day < this.week() || day > addDays(this.week(), 6)) return null;
    const h = this.hoursOf(day);
    if (h === null) return null;
    const busy =
      vetId === null
        ? []
        : this.weekActive().filter((a) => a.vet?.id === vetId && limaClock(a.startsAt).day === day);
    return firstFreeSlot(busy, {
      open: h?.open ?? 8 * 60,
      close: h?.close ?? 20 * 60,
      after: day === this.today ? this.nowMinutes() : 0,
    });
  }

  /** "Mar 24" para la lista de por confirmar de la semana */
  protected shortDay(a: Appointment): string {
    const day = limaClock(a.startsAt).day;
    const wd = shortWeekday.format(utc(day)).replace('.', '');
    return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${Number(day.slice(8))}`;
  }

  protected apptDay(a: Appointment): string {
    return limaClock(a.startsAt).day;
  }

  /** Minutos desde medianoche en Lima, para la línea de "ahora" */
  protected readonly nowMinutes = signal(limaClock(new Date()).minutes);
  private readonly clock = setInterval(
    () => this.nowMinutes.set(limaClock(new Date()).minutes),
    60_000,
  );

  protected readonly dayLabel = computed(() => {
    const label = longDay.format(new Date(`${this.day()}T12:00:00Z`));
    return label.charAt(0).toUpperCase() + label.slice(1);
  });
  protected readonly relativeLabel = computed(() => {
    const d = this.day();
    if (d === this.today) return 'Hoy';
    if (d === addDays(this.today, 1)) return 'Mañana';
    if (d === addDays(this.today, -1)) return 'Ayer';
    return null;
  });

  // ── Modales ──
  protected readonly selected = signal<Appointment | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly draft = signal<AppointmentDraft | null>(null);
  protected readonly editing = signal<Appointment | null>(null);
  protected readonly formBusy = signal(false);
  protected readonly cancelling = signal<Appointment | null>(null);
  protected readonly acting = signal(false);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('agendaScroll');
  private scrolledFor = '';
  private readonly weekScroll = viewChild<ElementRef<HTMLElement>>('weekScroll');
  private weekScrolledFor = '';

  constructor() {
    // Al abrir un día, la grilla se ubica donde hay algo que ver: la hora actual si es hoy,
    // o la primera cita; no en las 8:00 con la pantalla vacía
    afterRenderEffect(() => {
      const el = this.scroller()?.nativeElement;
      const items = this.active();
      const hours = this.hours();
      const key = `${this.day()}|${items.length}`;
      if (!el || !this.list.hasValue() || key === this.scrolledFor) return;
      this.scrolledFor = key;
      const first = items.length
        ? Math.min(...items.map((a) => limaClock(a.startsAt).minutes))
        : null;
      // Hoy: una hora antes de ahora (se ve lo que acaba de pasar y lo que sigue)
      const target =
        this.day() === this.today ? untracked(this.nowMinutes) - 60 : (first ?? hours[0] * 60) - 30;
      el.scrollTop = Math.max(0, ((target - hours[0] * 60) * HOUR_PX) / 60);
    });

    // Semana de un médico: se abre en la hora de las primeras citas (o una hora antes de ahora)
    afterRenderEffect(() => {
      const el = this.weekScroll()?.nativeElement;
      const cols = this.weekCols();
      const hours = this.weekHours();
      const key = `${this.week()}|${this.tab()}`;
      if (!el || !this.list.hasValue() || key === this.weekScrolledFor) return;
      this.weekScrolledFor = key;
      const starts = cols.flatMap((c) => c.items.map((a) => limaClock(a.startsAt).minutes));
      const target = cols.some((c) => c.isToday)
        ? untracked(this.nowMinutes) - 60
        : (starts.length ? Math.min(...starts) : hours[0] * 60) - 30;
      el.scrollTop = Math.max(0, ((target - hours[0] * 60) * WEEK_PX) / 60);
    });

    // La URL decide el día y puede abrir una cita nueva (por ejemplo, desde Vacunas)
    effect(() => {
      const fecha = this.fecha();
      const nueva = this.nueva();
      untracked(() => {
        if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) this.day.set(fecha);
        const vista = this.vista();
        if (vista === 'semana' || vista === 'dia')
          this.view.set(vista === 'semana' ? 'week' : 'day');
        if (nueva && this.canEdit()) {
          const petId = Number(this.petId());
          this.openNew({
            day: this.day() < this.today ? this.today : this.day(),
            pet:
              petId && this.mascota()
                ? { petId, petName: this.mascota()!, clientName: this.cliente() ?? '' }
                : null,
            reason: this.motivo() ?? '',
          });
          // Que recargar la página no vuelva a abrir el formulario
          this.syncUrl();
        }
      });
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
  }

  protected go(offset: number): void {
    this.setDay(addDays(this.day(), offset));
  }

  protected setDay(day: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    this.day.set(day);
    this.syncUrl();
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      queryParams: { fecha: this.day(), vista: this.isWeek() ? 'semana' : null },
      replaceUrl: true,
    });
  }

  protected setVet(value: string): void {
    this.vetFilter.set(value === '' ? null : Number(value));
  }

  protected top(a: Appointment): number {
    return ((limaClock(a.startsAt).minutes - this.hours()[0] * 60) * HOUR_PX) / 60;
  }

  protected height(a: Appointment): number {
    return Math.max((a.durationMin * HOUR_PX) / 60, 22);
  }

  protected nowTop(): number | null {
    if (this.day() !== this.today) return null;
    const top = ((this.nowMinutes() - this.hours()[0] * 60) * HOUR_PX) / 60;
    return top < 0 || top > this.hours().length * HOUR_PX ? null : top;
  }

  /** El horario (redondeado a 15 min) bajo el mouse, para mostrar dónde caería la cita */
  protected readonly hover = signal<{ col: number; minutes: number } | null>(null);

  private slotAt(event: MouseEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.floor(((event.clientY - rect.top) / HOUR_PX) * 4) * 15 + this.hours()[0] * 60;
  }

  protected slotHover(event: MouseEvent, col: Column): void {
    if (!this.canEdit() || (event.target as HTMLElement).closest('button')) {
      this.hover.set(null);
      return;
    }
    const minutes = this.slotAt(event);
    const past =
      this.day() < this.today || (this.day() === this.today && minutes < this.nowMinutes() - 14);
    const cur = this.hover();
    if (past) {
      if (cur) this.hover.set(null);
    } else if (!cur || cur.col !== col.id || cur.minutes !== minutes)
      this.hover.set({ col: col.id, minutes });
  }

  protected hoverTop(minutes: number): number {
    return ((minutes - this.hours()[0] * 60) * HOUR_PX) / 60;
  }

  protected hhmm(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  /** Clic en un hueco de la columna: cita nueva redondeada a 15 minutos */
  protected slotClick(event: MouseEvent, col: Column): void {
    if (!this.canEdit()) return;
    const minutes = this.slotAt(event);
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    this.openNew({
      day: this.day() < this.today ? this.today : this.day(),
      time,
      vetId: col.id === UNASSIGNED ? null : col.id,
    });
  }

  protected openNew(draft: AppointmentDraft): void {
    this.editing.set(null);
    this.draft.set(draft);
    this.formOpen.set(true);
  }

  protected reschedule(a: Appointment): void {
    this.selected.set(null);
    this.draft.set(null);
    this.editing.set(a);
    this.formOpen.set(true);
  }

  protected onSaved(a: Appointment): void {
    this.formOpen.set(false);
    this.editing.set(null);
    const { day } = limaClock(a.startsAt);
    if (day !== this.day()) this.setDay(day);
    else this.list.reload();
  }

  protected closeForm(): void {
    if (!this.formBusy()) this.formOpen.set(false);
  }

  protected startTime(a: Appointment): string {
    return limaClock(a.startsAt).time;
  }

  /** "en 25 min", "en 2 h 10 min" o "ahora" */
  protected startsIn(a: Appointment): string {
    const diff = limaClock(a.startsAt).minutes - this.nowMinutes();
    if (diff <= 0) return 'ahora';
    if (diff < 60) return `en ${diff} min`;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m ? `en ${h} h ${m} min` : `en ${h} h`;
  }

  protected isPast(a: Appointment): boolean {
    return new Date(a.startsAt).getTime() <= Date.now();
  }

  /** Avisos marcados en esta pantalla (sin volver a pedir la agenda) */
  private readonly marks = signal<Record<number, ReminderMark[]>>({});

  protected remindedOf(a: Appointment): ReminderMark[] {
    return this.marks()[a.id] ?? a.reminded ?? [];
  }

  /** Recepción abrió el WhatsApp de la cita: queda marcado para no repetir el aviso */
  protected markReminded(a: Appointment): void {
    const previous = this.remindedOf(a);
    this.marks.update((m) => ({
      ...m,
      [a.id]: [
        ...previous.filter((x) => x.channel !== 'WHATSAPP'),
        {
          channel: 'WHATSAPP',
          sentAt: new Date().toISOString(),
          by: this.session.user()?.fullName ?? null,
        },
      ],
    }));
    this.reminders.markSent('APPOINTMENT', a.id).subscribe({
      next: (marks) => this.marks.update((m) => ({ ...m, [a.id]: marks })),
      error: () => this.marks.update((m) => ({ ...m, [a.id]: previous })),
    });
  }

  protected reminderNote(a: Appointment): { text: string; icon: IconName; done: boolean } | null {
    const last = this.remindedOf(a).at(-1);
    if (last) {
      const at = new Date(last.sentAt);
      const when = `${formatDate(at, 'date')} ${clockFormat.format(at)}`;
      return last.channel === 'PUSH'
        ? { text: `Aviso automático enviado al celular el ${when}`, icon: 'smartphone', done: true }
        : {
            text: `Avisado por WhatsApp el ${when}${last.by ? ` · ${last.by}` : ''}`,
            icon: 'check',
            done: true,
          };
    }
    if (a.autoNotice && (a.status === 'SCHEDULED' || a.status === 'CONFIRMED'))
      return {
        text: 'El dueño activó los avisos: le llegará solo la tarde anterior',
        icon: 'bell',
        done: false,
      };
    return null;
  }

  protected whatsapp(a: Appointment): string {
    const day = longDay.format(utc(limaClock(a.startsAt).day));
    return confirmationLink(a, this.session.clinicName(), day.toLowerCase());
  }

  protected act(a: Appointment, action: 'confirm' | 'arrive' | 'noShow'): void {
    if (this.acting()) return;
    this.acting.set(true);
    const request =
      action === 'confirm'
        ? this.api.confirm(a.id)
        : action === 'arrive'
          ? this.api.arrive(a.id)
          : this.api.noShow(a.id);
    request.subscribe({
      next: (updated) => {
        this.acting.set(false);
        this.selected.set(null);
        this.list.reload();
        // Una cita de grooming que llega va directo a su ingreso
        if (action === 'arrive' && a.type === 'GROOMING' && updated.queueEntryId) {
          void this.router.navigate(['/grooming/ingreso'], {
            queryParams: { petId: a.pet.id, cola: updated.queueEntryId },
          });
          return;
        }
        this.toast.success(
          action === 'confirm'
            ? 'Cita confirmada.'
            : action === 'arrive'
              ? `${updated.pet.name} pasó a la cola de hoy.`
              : 'Cita marcada como "no vino".',
        );
      },
      error: (error: unknown) => {
        this.acting.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected askCancel(a: Appointment): void {
    this.selected.set(null);
    this.reason.reset('');
    this.cancelling.set(a);
  }

  protected confirmCancel(): void {
    const a = this.cancelling();
    if (!a || this.acting()) return;
    if (this.reason.invalid) {
      this.reason.markAsTouched();
      return;
    }
    this.acting.set(true);
    this.api.cancel(a.id, this.reason.value.trim()).subscribe({
      next: () => {
        this.acting.set(false);
        this.cancelling.set(null);
        this.list.reload();
        this.toast.success('Cita cancelada.');
      },
      error: (error: unknown) => {
        this.acting.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected errorText(): string {
    return apiErrorMessage(this.list.error(), 'No se pudo cargar la agenda.');
  }
}
