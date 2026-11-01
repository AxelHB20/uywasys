import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
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
  layoutLanes,
  limaClock,
  timeRange,
} from '../../core/services/appointments.models';
import { AppointmentsService } from '../../core/services/appointments.service';
import { addDays } from '../../core/services/medical.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { limaToday } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';
import { AppointmentDraft, AppointmentFormComponent } from './appointment-form.component';

/** Alto de una hora en la grilla (px): 30 minutos alcanzan para hora, paciente y motivo */
const HOUR_PX = 88;
const UNASSIGNED = 0;

interface Column {
  id: number;
  name: string;
  items: Appointment[];
}

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-white ring-amber-300 border-l-amber-400',
  CONFIRMED: 'bg-anil-50 ring-anil-200 border-l-anil-600',
  ARRIVED: 'bg-emerald-50 ring-emerald-200 border-l-emerald-600',
  NO_SHOW: 'bg-slate-50 ring-slate-200 border-l-slate-400',
  CANCELLED: 'bg-slate-50 ring-slate-200 border-l-slate-300',
};
const STATUS_DOT: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-amber-400',
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
@Component({
  selector: 'app-agenda-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    ModalComponent,
    AppointmentFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agenda.page.html',
})
export class AgendaPage implements OnDestroy {
  private readonly api = inject(AppointmentsService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // Parámetros de la URL (?fecha=…&nueva=1&petId=…&mascota=…&cliente=…&motivo=…)
  readonly fecha = input<string>();
  readonly nueva = input<string>();
  readonly petId = input<string>();
  readonly mascota = input<string>();
  readonly cliente = input<string>();
  readonly motivo = input<string>();

  protected readonly statusLabels = APPOINTMENT_STATUS_LABELS;
  protected readonly typeLabels = APPOINTMENT_TYPE_LABELS;
  protected readonly statusStyle = STATUS_STYLE;
  protected readonly statusDot = STATUS_DOT;
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
  protected readonly staff = computed<AgendaStaff[]>(() => this.staffRes.value() ?? []);
  protected readonly list = rxResource({
    params: () => ({ day: this.day() }),
    stream: ({ params }) => (params.day ? this.api.list({ from: params.day }) : of([])),
  });
  protected readonly items = computed(() => this.list.value() ?? []);
  protected readonly active = computed(() =>
    this.items().filter(
      (a) =>
        a.status !== 'CANCELLED' &&
        a.status !== 'NO_SHOW' &&
        (this.vetFilter() === null || (a.vet?.id ?? UNASSIGNED) === this.vetFilter()),
    ),
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

  protected readonly columns = computed<Column[]>(() => {
    const active = this.active();
    const filter = this.vetFilter();
    const people = this.staff().filter((s) => filter === null || s.id === filter);
    const cols: Column[] = people.map((s) => ({
      id: s.id,
      name: s.fullName,
      items: active.filter((a) => a.vet?.id === s.id),
    }));
    const unassigned = active.filter((a) => !a.vet);
    if (filter === null && (unassigned.length || !cols.length))
      cols.push({ id: UNASSIGNED, name: 'Sin asignar', items: unassigned });
    if (filter === UNASSIGNED)
      cols.push({ id: UNASSIGNED, name: 'Sin asignar', items: unassigned });
    return cols;
  });

  /** Horas visibles: de 8 a 20, o más si hay citas fuera de ese rango */
  protected readonly hours = computed(() => {
    let from = 8;
    let to = 20;
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

  constructor() {
    // La URL decide el día y puede abrir una cita nueva (por ejemplo, desde Vacunas)
    effect(() => {
      const fecha = this.fecha();
      const nueva = this.nueva();
      untracked(() => {
        if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) this.day.set(fecha);
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
          void this.router.navigate([], { queryParams: { fecha: this.day() }, replaceUrl: true });
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
    void this.router.navigate([], { queryParams: { fecha: day }, replaceUrl: true });
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

  /** Clic en un hueco de la columna: cita nueva redondeada a 15 minutos */
  protected slotClick(event: MouseEvent, col: Column): void {
    if (!this.canEdit()) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes =
      Math.floor(((event.clientY - rect.top) / HOUR_PX) * 4) * 15 + this.hours()[0] * 60;
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

  protected isPast(a: Appointment): boolean {
    return new Date(a.startsAt).getTime() <= Date.now();
  }

  protected whatsapp(a: Appointment): string {
    return confirmationLink(a, this.session.clinicName(), this.dayLabel().toLowerCase());
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
