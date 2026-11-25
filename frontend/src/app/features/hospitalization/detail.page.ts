import { TRANSPORT_LABELS } from '../../core/services/grooming.models';
import { QueueService } from '../../core/services/queue.service';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { SPECIES_LABELS } from '../../core/services/clients.models';
import { CareServicesService } from '../../core/services/care-services.service';
import {
  EVERY_HOURS_OPTIONS,
  HOSP_ROUTES,
  HOSP_STATUS_LABELS,
  HospEntry,
  HospOrder,
  HospOrderKind,
  HospitalizationDetail,
  ORDER_KIND_LABELS,
  SLOT_LABELS,
  Slot,
  SlotState,
  dayOf,
  frequencyLabel,
  hourOf,
  relativeTime,
  temperatureFlag,
  whenOf,
} from '../../core/services/hospitalization.models';
import { HospitalizationService } from '../../core/services/hospitalization.service';
import { CareService } from '../../core/services/inventory.models';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { VitalHint, vitalHint } from '../../shared/utils/vital-signs';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatPhone } from '../../shared/utils/peru';
import { SPECIES_ICONS } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { TemperatureChartComponent } from './temperature-chart.component';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';

const REFRESH_MS = 60_000;
const MUCOSA_OPTIONS = ['Rosadas', 'Pálidas', 'Congestivas', 'Ictéricas', 'Cianóticas'];

type Modal = 'order' | 'dose' | 'vitals' | 'discharge' | 'edit' | null;

/** Estilo de cada casilla de la hoja: color, icono y texto (nunca solo color) */
export const SLOT_STYLE: Record<SlotState, { chip: string; icon: IconName | null }> = {
  GIVEN: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: 'check' },
  SKIPPED: { chip: 'bg-slate-100 text-slate-600 ring-slate-200 line-through', icon: 'minus' },
  // Tinte, no bloque sólido: con varias atrasadas la hoja no "grita" y el aviso de arriba resume
  OVERDUE: { chip: 'bg-rose-50 text-rose-800 ring-rose-300 hover:bg-rose-100', icon: 'alert' },
  DUE: { chip: 'bg-amber-100 text-amber-900 ring-amber-300 hover:bg-amber-200', icon: 'clock' },
  PENDING: { chip: 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50', icon: null },
};

const STATUS_TONE: Record<HospitalizationDetail['status'], BadgeTone> = {
  ACTIVE: 'info',
  DISCHARGED: 'success',
  DECEASED: 'neutral',
};

const toNum = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** Valor para <input type="datetime-local"> en hora de Lima */
function localInput(date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour'] === '24' ? '00' : p['hour']}:${p['minute']}`;
}

/** "2026-11-02T14:30" (hora de Lima, UTC-5 sin horario de verano) → ISO */
function fromLocalInput(value: string): string {
  return new Date(`${value}:00-05:00`).toISOString();
}

/**
 * Paciente internado: hoja de tratamiento por horas, signos vitales, evolución y alta.
 * Cualquiera del equipo registra dosis, signos y notas; indicaciones y alta, el veterinario.
 */
@Component({
  selector: 'app-hospitalization-detail',
  imports: [
    BackLinkComponent,
    RouterLink,
    ReactiveFormsModule,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    FechaPipe,
    TemperatureChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detail.page.html',
})
export class HospitalizationDetailPage {
  private readonly api = inject(HospitalizationService);
  private readonly careServices = inject(CareServicesService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly queueApi = inject(QueueService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly id = input.required<string>();

  protected readonly icons = SPECIES_ICONS;
  protected readonly species = SPECIES_LABELS;
  protected readonly statusLabels = HOSP_STATUS_LABELS;
  protected readonly statusTone = STATUS_TONE;
  protected readonly kindLabels = ORDER_KIND_LABELS;
  protected readonly kinds = Object.keys(ORDER_KIND_LABELS) as HospOrderKind[];
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly slotStyle = SLOT_STYLE;
  protected readonly everyOptions = EVERY_HOURS_OPTIONS;
  protected readonly routes = HOSP_ROUTES;
  protected readonly mucosaOptions = MUCOSA_OPTIONS;
  protected readonly frequencyLabel = frequencyLabel;
  protected readonly hourOf = hourOf;
  protected readonly money = money;
  protected readonly formatPhone = formatPhone;
  protected readonly legend: SlotState[] = ['OVERDUE', 'DUE', 'PENDING', 'GIVEN', 'SKIPPED'];

  protected readonly data = signal<HospitalizationDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly modal = signal<Modal>(null);
  protected readonly now = signal(new Date());
  protected readonly showStopped = signal(false);

  protected readonly canManage = computed(() =>
    ['ADMIN', 'VET'].includes(this.session.role() ?? ''),
  );
  protected readonly active = computed(() => this.data()?.status === 'ACTIVE');
  protected readonly transportLabels = TRANSPORT_LABELS;
  /** Recepción, veterinario y administrador marcan la entrega en casa */
  protected readonly canDeliver = computed(() =>
    ['ADMIN', 'VET', 'RECEPTION'].includes(this.session.role() ?? ''),
  );

  protected deliveredHome(queueEntryId: number): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.queueApi.deliveredHome(queueEntryId).subscribe({
      next: (item) => {
        this.saving.set(false);
        this.data.update((d) =>
          d?.homeDelivery
            ? { ...d, homeDelivery: { ...d.homeDelivery, deliveredAt: item.deliveredHomeAt } }
            : d,
        );
        this.toast.success('Quedó entregado en su casa');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
  protected readonly activeOrders = computed(
    () => this.data()?.orders.filter((o) => o.active) ?? [],
  );
  protected readonly stoppedOrders = computed(
    () => this.data()?.orders.filter((o) => !o.active) ?? [],
  );
  protected readonly lastVitals = computed(() => this.data()?.lastVitals ?? null);
  protected readonly filters = [
    { value: 'all', label: 'Todo' },
    { value: 'NOTE', label: 'Notas' },
    { value: 'VITALS', label: 'Signos' },
    { value: 'DOSE', label: 'Dosis' },
  ] as const;
  protected readonly filter = signal<'all' | 'NOTE' | 'VITALS' | 'DOSE'>('all');
  protected readonly showAll = signal(false);
  protected readonly timeline = computed(() => {
    const f = this.filter();
    const all = this.data()?.entries ?? [];
    return f === 'all' ? all : all.filter((e) => e.kind === f);
  });
  protected readonly shown = computed(() =>
    this.showAll() ? this.timeline() : this.timeline().slice(0, 12),
  );

  // ── Indicación ──
  protected readonly orderForm = new FormGroup({
    kind: new FormControl<HospOrderKind>('MEDICATION', { nonNullable: true }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(150)],
    }),
    dose: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    route: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    everyHours: new FormControl<number | null>(8),
    startsAt: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    durationDays: new FormControl<number | null>(null, [Validators.min(1), Validators.max(60)]),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
  });

  // ── Dosis ──
  protected readonly dosing = signal<{ order: HospOrder; slot: Slot } | null>(null);
  protected readonly doseForm = new FormGroup({
    skipped: new FormControl(false, { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  // ── Signos ──
  protected readonly vitalsForm = new FormGroup({
    temperatureC: new FormControl<number | null>(null, [Validators.min(30), Validators.max(45)]),
    heartRate: new FormControl<number | null>(null, [Validators.min(20), Validators.max(400)]),
    respiratoryRate: new FormControl<number | null>(null, [Validators.min(4), Validators.max(200)]),
    weightKg: new FormControl<number | null>(null, [Validators.min(0.01), Validators.max(150)]),
    mucosa: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  // ── Nota de evolución ──
  protected readonly note = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });

  // ── Editar ──
  protected readonly editForm = new FormGroup({
    cage: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    diagnosis: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
  });

  // ── Alta ──
  protected readonly stayServices = signal<CareService[]>([]);
  protected readonly dischargeForm = new FormGroup({
    outcome: new FormControl<'DISCHARGED' | 'DECEASED'>('DISCHARGED', { nonNullable: true }),
    careServiceId: new FormControl<number | null>(null),
    days: new FormControl<number | null>(1, [Validators.min(1), Validators.max(90)]),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
  });
  private readonly dischargeValues = signal(this.dischargeForm.getRawValue());
  protected readonly stayCharge = computed(() => {
    const v = this.dischargeValues();
    const service = this.stayServices().find((s) => s.id === Number(v.careServiceId));
    return service ? Math.round(service.price * (Number(v.days) || 0) * 100) / 100 : 0;
  });

  constructor() {
    effect(() => this.load(Number(this.id())));
    // Cada fila de horas se desplaza a lo que toca (en el celular no se ve todo)
    let scrolledFor: number | null = null;
    afterRenderEffect(() => {
      const d = this.data();
      if (!d || scrolledFor === d.id) return;
      scrolledFor = d.id;
      for (const row of this.host.nativeElement.querySelectorAll<HTMLElement>('.slot-row')) {
        const target = row.querySelector<HTMLElement>(`[data-slot="${row.dataset['target']}"]`);
        if (target) row.scrollLeft = target.offsetLeft - row.offsetLeft - 4;
      }
    });
    this.dischargeForm.valueChanges.subscribe(() =>
      this.dischargeValues.set(this.dischargeForm.getRawValue()),
    );
    // Sin servicio de estancia no hay días que cobrar
    this.dischargeForm.controls.careServiceId.valueChanges.subscribe((id) => {
      const days = this.dischargeForm.controls.days;
      if (id) days.enable({ emitEvent: false });
      else days.disable({ emitEvent: false });
    });
    const timer = setInterval(() => {
      this.now.set(new Date());
      // No recarga con un formulario abierto: no se pierde lo que se escribe
      if (!this.modal() && !this.saving() && !this.note.value) this.load(Number(this.id()), true);
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected load(id = Number(this.id()), silent = false): void {
    if (!silent) this.loading.set(true);
    this.api.get(id).subscribe({
      next: (d) => {
        this.data.set(d);
        this.now.set(new Date());
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: (e: unknown) => {
        if (!silent) this.loadError.set(apiErrorMessage(e, 'No se pudo cargar el internamiento.'));
        this.loading.set(false);
      },
    });
  }

  // ── Presentación ──

  protected when(iso: string): string {
    return whenOf(iso, this.now());
  }

  protected relative(iso: string): string {
    return relativeTime(iso, this.now());
  }

  protected day(iso: string): string {
    return dayOf(iso, this.now());
  }

  /** Separa los días en la fila de horas */
  /** Título del día antes de la primera hora de cada día (también la primera: "ayer") */
  protected newDay(slots: Slot[], index: number): boolean {
    return index === 0 || this.day(slots[index].at) !== this.day(slots[index - 1].at);
  }

  protected slotTitle(order: HospOrder, slot: Slot): string {
    const base = `${order.description} · ${this.when(slot.at)} · ${this.slotLabels[slot.state]}`;
    return slot.doneAt ? `${base} (${this.when(slot.doneAt)})` : base;
  }

  /** La casilla que se ve primero: la atrasada o la que toca (con una dada antes, de contexto) */
  protected targetIndex(order: HospOrder): number {
    const i = order.slots.findIndex(
      (s) => s.state === 'OVERDUE' || s.state === 'DUE' || s.state === 'PENDING',
    );
    return Math.max(0, i - 1);
  }

  protected givenCount(order: HospOrder): number {
    return order.slots.filter((s) => s.state === 'GIVEN').length;
  }

  protected canRecord(slot: Slot): boolean {
    return (
      this.active() &&
      (slot.state === 'OVERDUE' || slot.state === 'DUE' || slot.state === 'PENDING')
    );
  }

  /** Dosis atrasadas de las indicaciones activas, de la más antigua a la más reciente */
  protected readonly overdue = computed(() =>
    this.activeOrders()
      .flatMap((o) => o.slots.filter((s) => s.state === 'OVERDUE').map((s) => ({ o, s })))
      .sort((a, b) => a.s.at.localeCompare(b.s.at)),
  );

  /** Sin control de signos en más de 12 h: en un internado eso tiene que verse */
  protected readonly staleVitals = computed(() => {
    const last = this.lastVitals();
    return (
      !!last && this.active() && this.now().getTime() - new Date(last.at).getTime() > 12 * 3_600_000
    );
  });

  /** Aviso de FC o FR fuera del rango de la especie (null si está bien o no hay referencia) */
  protected vitalFlag(
    vital: 'heartRate' | 'respiratoryRate',
    value: number | null,
  ): VitalHint | null {
    const d = this.data();
    return d ? vitalHint(d.pet.species, vital, value) : null;
  }

  /** La evolución se separa por día: título cuando cambia el día respecto a la anterior */
  protected entryDay(list: readonly HospEntry[], i: number): string | null {
    const day = this.day(list[i].at);
    return i === 0 || this.day(list[i - 1].at) !== day ? day : null;
  }

  protected tempFlag(t: number | null): 'high' | 'low' | null {
    const d = this.data();
    return d ? temperatureFlag(d.pet.species, t) : null;
  }

  protected entryIcon(e: HospEntry): IconName {
    return e.kind === 'VITALS'
      ? 'heart-pulse'
      : e.kind === 'NOTE'
        ? 'pen-line'
        : e.skipped
          ? 'minus'
          : 'pill';
  }

  protected vitalsText(e: HospEntry): string {
    const parts: string[] = [];
    if (e.temperatureC !== null) parts.push(`T° ${e.temperatureC} °C`);
    if (e.heartRate !== null) parts.push(`FC ${e.heartRate}`);
    if (e.respiratoryRate !== null) parts.push(`FR ${e.respiratoryRate}`);
    if (e.weightKg !== null) parts.push(`${e.weightKg} kg`);
    if (e.mucosa) parts.push(`mucosas ${e.mucosa.toLowerCase()}`);
    return parts.join(' · ');
  }

  protected bad(c: { invalid: boolean; touched: boolean }): boolean {
    return c.invalid && c.touched;
  }

  // ── Acciones ──

  protected askOrder(): void {
    this.orderForm.reset({
      kind: 'MEDICATION',
      description: '',
      dose: '',
      route: '',
      everyHours: 8,
      startsAt: localInput(),
      durationDays: null,
      notes: '',
    });
    this.modal.set('order');
  }

  protected saveOrder(): void {
    const d = this.data();
    if (!d || this.saving()) return;
    if (this.orderForm.invalid) {
      this.orderForm.markAllAsTouched();
      return;
    }
    const v = this.orderForm.getRawValue();
    this.run(
      this.api.addOrder(d.id, {
        kind: v.kind,
        description: v.description.trim(),
        dose: v.dose.trim() || null,
        route: v.route.trim() || null,
        everyHours: v.everyHours,
        startsAt: fromLocalInput(v.startsAt),
        durationDays: toNum(v.durationDays),
        notes: v.notes.trim() || null,
      }),
      'Indicación agregada a la hoja.',
    );
  }

  protected stopOrder(order: HospOrder): void {
    const d = this.data();
    if (!d || this.saving()) return;
    this.run(this.api.stopOrder(d.id, order.id), `«${order.description}» suspendida.`, false);
  }

  protected askDose(order: HospOrder, slot: Slot): void {
    if (!this.canRecord(slot)) return;
    this.dosing.set({ order, slot });
    this.doseForm.reset({ skipped: false, notes: '' });
    this.modal.set('dose');
  }

  protected saveDose(): void {
    const d = this.data();
    const dosing = this.dosing();
    if (!d || !dosing || this.saving()) return;
    const v = this.doseForm.getRawValue();
    if (v.skipped && !v.notes.trim()) {
      this.doseForm.controls.notes.setErrors({ required: true });
      this.doseForm.controls.notes.markAsTouched();
      return;
    }
    this.run(
      this.api.addEntry(d.id, {
        kind: 'DOSE',
        orderId: dosing.order.id,
        scheduledAt: dosing.slot.at,
        skipped: v.skipped,
        notes: v.notes.trim() || null,
      }),
      v.skipped ? 'Dosis marcada como omitida.' : 'Dosis registrada.',
    );
  }

  protected askVitals(): void {
    this.vitalsForm.reset({
      temperatureC: null,
      heartRate: null,
      respiratoryRate: null,
      weightKg: null,
      mucosa: '',
      notes: '',
    });
    this.modal.set('vitals');
  }

  protected saveVitals(): void {
    const d = this.data();
    if (!d || this.saving()) return;
    const v = this.vitalsForm.getRawValue();
    if (this.vitalsForm.invalid) {
      this.vitalsForm.markAllAsTouched();
      return;
    }
    const values = [v.temperatureC, v.heartRate, v.respiratoryRate, v.weightKg].map(toNum);
    if (values.every((x) => x === null) && !v.mucosa) {
      this.toast.error('Registra al menos un signo vital.');
      return;
    }
    this.run(
      this.api.addEntry(d.id, {
        kind: 'VITALS',
        temperatureC: values[0],
        heartRate: values[1],
        respiratoryRate: values[2],
        weightKg: values[3],
        mucosa: v.mucosa || null,
        notes: v.notes.trim() || null,
      }),
      'Signos vitales registrados.',
    );
  }

  protected saveNote(): void {
    const d = this.data();
    if (!d || this.saving()) return;
    if (this.note.invalid || !this.note.value.trim()) {
      this.note.markAsTouched();
      return;
    }
    this.run(
      this.api.addEntry(d.id, { kind: 'NOTE', notes: this.note.value.trim() }),
      'Nota agregada a la evolución.',
      false,
      () => this.note.reset(''),
    );
  }

  protected askEdit(): void {
    const d = this.data();
    if (!d) return;
    this.editForm.reset({ cage: d.cage ?? '', diagnosis: d.diagnosis ?? '' });
    this.modal.set('edit');
  }

  protected saveEdit(): void {
    const d = this.data();
    if (!d || this.saving()) return;
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const v = this.editForm.getRawValue();
    this.run(
      this.api.update(d.id, { cage: v.cage.trim() || null, diagnosis: v.diagnosis.trim() || null }),
      'Datos actualizados.',
    );
  }

  protected askDischarge(): void {
    const d = this.data();
    if (!d) return;
    const open = () => {
      const service = this.stayServices()[0] ?? null;
      this.dischargeForm.reset({
        outcome: 'DISCHARGED',
        careServiceId: service?.id ?? null,
        days: d.days,
        notes: '',
      });
      this.modal.set('discharge');
    };
    if (this.stayServices().length) return open();
    this.careServices.list('active').subscribe({
      next: (list) => {
        this.stayServices.set(list.filter((s) => s.category === 'HOSPITALIZATION'));
        open();
      },
      error: () => open(),
    });
  }

  protected saveDischarge(): void {
    const d = this.data();
    if (!d || this.saving()) return;
    if (this.dischargeForm.invalid) {
      this.dischargeForm.markAllAsTouched();
      return;
    }
    const v = this.dischargeForm.getRawValue();
    this.run(
      this.api.discharge(d.id, {
        outcome: v.outcome,
        careServiceId: v.careServiceId,
        days: v.careServiceId ? toNum(v.days) : null,
        notes: v.notes.trim() || null,
      }),
      v.outcome === 'DECEASED'
        ? `Se registró el fallecimiento de ${d.pet.name}.`
        : `${d.pet.name} fue dado de alta. Lo pendiente quedó por cobrar en caja.`,
    );
  }

  protected closeModal(): void {
    if (!this.saving()) this.modal.set(null);
  }

  private run(
    request: ReturnType<HospitalizationService['get']>,
    message: string,
    closeModal = true,
    after?: () => void,
  ): void {
    this.saving.set(true);
    request.subscribe({
      next: (d) => {
        this.data.set(d);
        this.now.set(new Date());
        this.saving.set(false);
        if (closeModal) this.modal.set(null);
        after?.();
        this.toast.success(message);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(e));
      },
    });
  }
}
