import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES, SPECIES_LABELS } from '../../core/services/clients.models';
import { ClinicService } from '../../core/services/clinic.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { HealthService } from '../../core/services/health.service';
import { QueueItem, QueueStatus } from '../../core/services/queue.service';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { SPECIES_ICONS, initials, relativeDay } from '../../shared/utils/records';
import { CASH_ROLES } from '../../core/services/cash.models';
import { money } from '../../shared/utils/stock';
import { toNotification } from '../../core/layout/header/header.component';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  Appointment,
  AppointmentStatus,
  limaClock,
} from '../../core/services/appointments.models';
import { DueImmunization, reminderLink } from '../../core/services/medical.models';
import { delta, recentBars } from '../../core/services/reports.models';
import { ReportsService } from '../../core/services/reports.service';
import { DailyBarsComponent } from '../../shared/ui/charts/daily-bars.component';

interface SetupStep {
  title: string;
  detail: string;
  route: string;
  key: 'profile' | 'team' | 'client';
}

const TIME_ZONE = 'America/Lima';
const REFRESH_MS = 60_000;

const APPOINTMENT_TONES: Record<AppointmentStatus, BadgeTone> = {
  SCHEDULED: 'warning',
  CONFIRMED: 'info',
  ARRIVED: 'success',
  NO_SHOW: 'neutral',
  CANCELLED: 'neutral',
};

const ALERT_ICONS: Record<string, IconName> = {
  urgent: 'alert',
  doses: 'bed',
  expiring: 'package',
  lowStock: 'package',
  shortage: 'package',
  staleCash: 'receipt',
  billing: 'file-text',
  labReview: 'flask',
  labOverdue: 'clock',
  staleVisits: 'stethoscope',
  staleGrooming: 'scissors',
};

const ALERT_TONES = {
  danger: 'bg-rose-50 text-rose-800 ring-rose-600/15 hover:bg-rose-100',
  warning: 'bg-amber-50 text-amber-900 ring-amber-600/20 hover:bg-amber-100',
  info: 'bg-anil-50 text-anil-800 ring-anil-600/15 hover:bg-anil-100',
} as const;

const monthLong = new Intl.DateTimeFormat('es-PE', { month: 'long', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const STATUS: Record<QueueStatus, { label: string; tone: BadgeTone }> = {
  IN_PROGRESS: { label: 'En atención', tone: 'info' },
  WAITING: { label: 'En espera', tone: 'warning' },
  ARRIVED: { label: 'Llegó', tone: 'neutral' },
  DONE: { label: 'Atendido', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};

@Component({
  selector: 'app-dashboard-page',
  imports: [
    RouterLink,
    NgTemplateOutlet,
    IconComponent,
    BadgeComponent,
    DailyBarsComponent,
    ModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  private readonly healthService = inject(HealthService);
  private readonly clinicService = inject(ClinicService);
  private readonly dashboardService = inject(DashboardService);
  private readonly reportsService = inject(ReportsService);
  protected readonly session = inject(SessionService);
  /** Caja y groomer no abren la historia clínica */
  protected readonly canSeeRecord = computed(() =>
    ['ADMIN', 'VET', 'RECEPTION'].includes(this.session.role() ?? ''),
  );

  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly status = STATUS;
  protected readonly initials = initials;
  protected readonly relativeDay = relativeDay;
  protected readonly money = money;
  /** Las ventas las ve quien maneja la caja */
  protected readonly showSales = computed(() =>
    CASH_ROLES.includes(this.session.role() ?? 'GROOMER'),
  );
  protected readonly canRegister = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );

  /** Reloj de la pantalla: actualiza los minutos de espera y la fecha. */
  protected readonly now = signal(new Date());
  protected readonly today = computed(() =>
    capitalize(
      new Intl.DateTimeFormat('es-PE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: TIME_ZONE,
      }).format(this.now()),
    ),
  );
  protected readonly greeting = computed(() =>
    greetingFor(
      Number(
        new Intl.DateTimeFormat('es-PE', {
          hour: 'numeric',
          hourCycle: 'h23',
          timeZone: TIME_ZONE,
        }).format(this.now()),
      ),
    ),
  );

  protected readonly summary = rxResource({ stream: () => this.dashboardService.summary() });
  protected readonly data = computed(() => (this.summary.hasValue() ? this.summary.value() : null));
  protected readonly inClinic = computed(() => {
    const q = this.data()?.queue;
    return q ? q.arrived + q.waiting + q.inProgress : 0;
  });

  // ── Inicio renovado (Fase 7) ──
  protected readonly appointmentLabels = APPOINTMENT_STATUS_LABELS;
  protected readonly appointmentTypes = APPOINTMENT_TYPE_LABELS;
  protected readonly appointmentTones = APPOINTMENT_TONES;
  protected readonly alertTones = ALERT_TONES;
  protected readonly alerts = computed(() => (this.data()?.alerts ?? []).map(toNotification));
  protected readonly appointments = computed(() => this.data()?.appointments ?? null);
  protected readonly reminders = computed(() => this.data()?.reminders ?? null);

  /** Lo cobrado en el mes: solo el administrador */
  protected readonly month = rxResource({
    params: () => (this.session.isAdmin() ? true : undefined),
    stream: () => this.reportsService.month(),
  });
  protected readonly monthData = computed(() =>
    this.month.hasValue() ? this.month.value() : null,
  );
  protected readonly bars = computed(() => {
    const m = this.monthData();
    return m ? recentBars(m) : [];
  });
  /** Lo cobrado el mismo día de la semana pasada (día completo: hoy aún va en curso, sin porcentaje) */
  protected readonly lastWeekSameDay = computed(() => {
    const today = this.bars().at(-1);
    if (!today) return null;
    const day = new Intl.DateTimeFormat('es-PE', { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(`${today.day}T12:00:00Z`))
      .replace('.', '');
    return { label: `${day}. pasado`, amount: today.previous };
  });

  protected readonly attentionTones = {
    danger: 'bg-rose-50 text-rose-700',
    warning: 'bg-amber-50 text-amber-800',
    info: 'bg-anil-50 text-anil-700',
    success: 'bg-emerald-50 text-emerald-700',
  } as const;

  /** Avisos visibles sin desplegar: más alarga el bloque y deja la tarjeta del mes vacía al lado */
  protected readonly attentionLimit = 5;
  protected toneClass(tone: keyof typeof this.attentionTones): string {
    return this.attentionTones[tone];
  }

  /** La lista completa se abre en una ventana: desplegarla en la página la deforma */
  protected readonly attentionOpen = signal(false);
  protected readonly visibleAttention = computed(() =>
    this.attention().slice(0, this.attentionLimit),
  );
  protected readonly hiddenAttention = computed(() =>
    Math.max(0, this.attention().length - this.attentionLimit),
  );

  /** Un solo bloque con todo lo que pide acción, de lo más urgente a lo informativo */
  protected readonly attention = computed(() => {
    const d = this.data();
    if (!d) return [];
    type Tone = keyof typeof this.attentionTones;
    const items: {
      id: string;
      tone: Tone;
      icon: IconName;
      title: string;
      detail: string;
      link: string;
      query?: Record<string, string>;
    }[] = [];
    const hz = d.hospitalization;
    for (const n of this.alerts()) {
      if (n.id === 'doses' && hz?.active) continue; // va en la línea de hospitalización
      items.push({ ...n, icon: ALERT_ICONS[n.id] ?? 'alert' });
    }
    if (hz?.active)
      items.push({
        id: 'hospital',
        tone: hz.overdue ? 'danger' : 'info',
        icon: 'bed',
        title: `${hz.active} ${hz.active === 1 ? 'paciente internado' : 'pacientes internados'}`,
        detail: hz.overdue
          ? `${hz.overdue} ${hz.overdue === 1 ? 'dosis atrasada' : 'dosis atrasadas'}`
          : 'Tratamientos al día',
        link: '/hospitalizacion',
      });
    const overdue = d.reminders?.overdue ?? 0;
    if (overdue)
      items.push({
        id: 'reminders',
        tone: 'warning',
        icon: 'syringe',
        title: `${overdue} ${overdue === 1 ? 'refuerzo vencido' : 'refuerzos vencidos'}`,
        detail: 'Avísales por WhatsApp desde Refuerzos',
        link: '/vacunas',
      });
    const gr = d.grooming;
    if (gr && (gr.active || gr.delivered))
      items.push({
        id: 'grooming',
        tone: gr.ready ? 'success' : 'info',
        icon: 'scissors',
        title: gr.ready
          ? `${gr.ready} ${gr.ready === 1 ? 'mascota lista' : 'mascotas listas'} para entregar`
          : `${gr.active} en el tablero de grooming`,
        detail: `${gr.active} en el tablero · ${gr.delivered} ${gr.delivered === 1 ? 'entregado' : 'entregados'} hoy`,
        link: '/grooming',
      });
    const rank: Record<Tone, number> = { danger: 0, warning: 1, success: 2, info: 3 };
    return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
  });
  protected readonly monthDelta = computed(() => {
    const m = this.monthData();
    return m ? delta(m.kpis.collected, m.previousKpis.collected) : null;
  });
  protected readonly monthName = computed(() => {
    const m = this.monthData();
    return m ? monthLong.format(new Date(`${m.from}T12:00:00Z`)).toLowerCase() : '';
  });
  protected readonly previousMonthName = computed(() => {
    const m = this.monthData();
    return m ? capitalize(monthLong.format(new Date(`${m.previous.from}T12:00:00Z`))) : '';
  });
  /** "1–15 oct" */
  protected readonly previousRange = computed(() => {
    const m = this.monthData();
    if (!m) return '';
    const from = new Date(`${m.previous.from}T12:00:00Z`);
    const to = new Date(`${m.previous.to}T12:00:00Z`);
    const end = dayMonth.format(to).replace('.', '');
    return m.previous.from === m.previous.to ? end : `${from.getUTCDate()}–${end}`;
  });

  /** Solo se avisa si el servidor no responde; si todo está bien, no hace falta decirlo. */
  protected readonly health = rxResource({ stream: () => this.healthService.check() });
  protected readonly apiDown = computed(() => !this.health.isLoading() && !this.health.hasValue());

  protected readonly setupSteps: SetupStep[] = [
    {
      title: 'Completa los datos de la clínica',
      detail: 'RUC, dirección, teléfono y logo para tickets y recetas.',
      route: '/configuracion',
      key: 'profile',
    },
    {
      title: 'Crea las cuentas de tu equipo',
      detail: 'Cada persona con su rol: recepción, veterinario, groomer o caja.',
      route: '/usuarios',
      key: 'team',
    },
    {
      title: 'Registra tu primer cliente',
      detail: 'El dueño y su mascota, en menos de un minuto.',
      route: '/clientes/nuevo',
      key: 'client',
    },
  ];
  private readonly setup = rxResource({
    params: () => (this.session.isAdmin() ? true : undefined),
    stream: () => this.clinicService.setupStatus(),
  });
  protected readonly doneCount = computed(
    () => this.setupSteps.filter((step) => this.isDone(step)).length,
  );
  /** La guía desaparece cuando la clínica ya está lista. */
  protected readonly showSetup = computed(
    () =>
      this.session.isAdmin() && this.setup.hasValue() && this.doneCount() < this.setupSteps.length,
  );

  constructor() {
    const timer = setInterval(() => {
      this.now.set(new Date());
      this.summary.reload();
      if (this.session.isAdmin()) this.month.reload();
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected isDone(step: SetupStep): boolean {
    const status = this.setup.hasValue() ? this.setup.value() : null;
    if (step.key === 'client') return (this.data()?.clients.active ?? 0) > 0;
    if (!status) return false;
    return step.key === 'profile' ? status.profileComplete : status.teamMembers > 0;
  }

  protected waitLabel(item: QueueItem): string {
    const since = new Date(item.status === 'IN_PROGRESS' ? item.startedAt! : item.arrivedAt);
    const minutes = Math.max(0, Math.round((this.now().getTime() - since.getTime()) / 60_000));
    const text =
      minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    return item.status === 'IN_PROGRESS' ? `en atención hace ${text}` : `espera ${text}`;
  }

  protected arrivalTime(item: QueueItem): string {
    return new Intl.DateTimeFormat('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: TIME_ZONE,
    }).format(new Date(item.arrivedAt));
  }

  protected appointmentTime(a: Appointment): string {
    return limaClock(a.startsAt).time;
  }

  /** La próxima cita que aún no llega (para resaltarla) */
  protected readonly nextAppointmentId = computed(() => {
    const now = this.now().getTime();
    const list = this.appointments()?.items ?? [];
    const next = list.find(
      (a) =>
        (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') &&
        new Date(a.startsAt).getTime() + a.durationMin * 60_000 >= now,
    );
    return next?.id ?? null;
  });

  protected dueLabel(item: DueImmunization): { text: string; tone: BadgeTone } {
    const d = item.daysLeft;
    if (d < 0) return { text: `Vencida hace ${-d} ${d === -1 ? 'día' : 'días'}`, tone: 'danger' };
    if (d === 0) return { text: 'Toca hoy', tone: 'warning' };
    return { text: `En ${d} ${d === 1 ? 'día' : 'días'}`, tone: 'info' };
  }

  protected whatsapp(item: DueImmunization): string {
    return reminderLink(item, this.session.clinicName());
  }

  protected trendText(d: { percent: number | null; trend: string }): string {
    if (d.percent === null)
      return d.trend === 'up' ? 'El mes anterior no hubo cobros' : 'Sin cobros aún';
    if (d.trend === 'flat') return 'Igual que el mes anterior';
    const n = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(
      Math.abs(d.percent),
    );
    return `${d.trend === 'up' ? 'Sube' : 'Baja'} ${n} %`;
  }

  protected speciesIcon(species: keyof typeof SPECIES_ICONS): IconName {
    return this.speciesIcons[species];
  }
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
