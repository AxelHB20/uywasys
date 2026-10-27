import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ClinicService } from '../../core/services/clinic.service';
import { HealthService } from '../../core/services/health.service';
import { SessionService } from '../../core/auth/session.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';

interface Kpi {
  label: string;
  icon: IconName;
  comingIn: string;
}

interface SetupStep {
  title: string;
  detail: string;
  icon: IconName;
  route: string;
  /** Fase en que llega; si no tiene, el paso ya se puede hacer. */
  comingIn?: string;
  /** Cómo saber que el paso está hecho. */
  key?: 'profile' | 'team';
}

const TIME_ZONE = 'America/Lima';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  private readonly healthService = inject(HealthService);
  private readonly clinicService = inject(ClinicService);
  protected readonly session = inject(SessionService);

  private readonly now = new Date();

  protected readonly today = capitalize(
    new Intl.DateTimeFormat('es-PE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: TIME_ZONE,
    }).format(this.now),
  );

  protected readonly greeting = greetingFor(
    Number(
      new Intl.DateTimeFormat('es-PE', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: TIME_ZONE,
      }).format(this.now),
    ),
  );

  protected readonly health = rxResource({ stream: () => this.healthService.check() });
  protected readonly apiUp = computed(() => this.health.hasValue());
  protected readonly checkedAt = computed(() => {
    const value = this.health.hasValue() ? this.health.value() : null;
    return value
      ? new Intl.DateTimeFormat('es-PE', { timeStyle: 'short', timeZone: TIME_ZONE }).format(
          new Date(value.time),
        )
      : null;
  });

  /** Indicadores del día: se activan con cada módulo (no se muestran cifras inventadas). */
  protected readonly kpis: Kpi[] = [
    { label: 'Citas de hoy', icon: 'calendar', comingIn: 'Fase 5' },
    { label: 'Ventas del día', icon: 'receipt', comingIn: 'Fase 4' },
    { label: 'Productos con stock bajo', icon: 'package', comingIn: 'Fase 2' },
    { label: 'Vacunas por vencer', icon: 'syringe', comingIn: 'Fase 5' },
  ];

  protected readonly setupSteps: SetupStep[] = [
    {
      title: 'Completa los datos de la clínica',
      detail: 'RUC, dirección, teléfono y logo para tickets y recetas.',
      icon: 'building',
      route: '/configuracion',
      key: 'profile',
    },
    {
      title: 'Crea las cuentas de tu equipo',
      detail: 'Cada persona con su rol: recepción, veterinario, groomer o caja.',
      icon: 'user-cog',
      route: '/usuarios',
      key: 'team',
    },
    {
      title: 'Importa tus clientes y mascotas',
      detail: 'Desde un Excel, sin escribirlos uno por uno.',
      icon: 'clients',
      route: '/clientes',
      comingIn: 'Fase 1',
    },
    {
      title: 'Registra tu inventario',
      detail: 'Productos, lotes y fechas de vencimiento.',
      icon: 'package',
      route: '/inventario',
      comingIn: 'Fase 2',
    },
  ];

  /** Avance de la configuración inicial: solo lo consulta el administrador. */
  private readonly setup = rxResource({
    params: () => (this.session.isAdmin() ? true : undefined),
    stream: () => this.clinicService.setupStatus(),
  });

  protected isDone(step: SetupStep): boolean {
    const status = this.setup.hasValue() ? this.setup.value() : null;
    if (!status || !step.key) return false;
    return step.key === 'profile' ? status.profileComplete : status.teamMembers > 0;
  }

  protected readonly doneCount = computed(() => {
    // Lee el recurso para que el contador se actualice cuando llega la respuesta.
    if (!this.setup.hasValue()) return 0;
    return this.setupSteps.filter((step) => this.isDone(step)).length;
  });
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
