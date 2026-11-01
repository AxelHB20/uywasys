import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
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

interface SetupStep {
  title: string;
  detail: string;
  route: string;
  key: 'profile' | 'team' | 'client';
}

const TIME_ZONE = 'America/Lima';
const REFRESH_MS = 60_000;

const STATUS: Record<QueueStatus, { label: string; tone: BadgeTone }> = {
  IN_PROGRESS: { label: 'En atención', tone: 'info' },
  WAITING: { label: 'En espera', tone: 'warning' },
  ARRIVED: { label: 'Llegó', tone: 'neutral' },
  DONE: { label: 'Atendido', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  private readonly healthService = inject(HealthService);
  private readonly clinicService = inject(ClinicService);
  private readonly dashboardService = inject(DashboardService);
  protected readonly session = inject(SessionService);

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
