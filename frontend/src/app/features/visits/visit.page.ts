import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  interval,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { UsedSuppliesComponent } from './used-supplies.component';
import { FRONT_DESK_ROLES, SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import { CareServicesService } from '../../core/services/care-services.service';
import { CASH_ROLES } from '../../core/services/cash.models';
import { CareService } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import {
  CHARGE_STATUS_LABELS,
  Charge,
  ChargeItemInput,
  VISIT_STATUS_LABELS,
  VisitDetail,
} from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import {
  CatalogOption,
  toProductOptions,
  toServiceOptions,
} from '../../shared/catalog/catalog-options';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatPhone } from '../../shared/utils/peru';
import { whatsappPhone } from '../../core/services/grooming.models';
import { ownerInstructions, ownerMessage } from './owner-instructions';
import { petAge } from '../../shared/utils/pet-age';
import { SPECIES_ICONS, clientCode, petCode } from '../../shared/utils/records';
import { formatQty, money, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { Immunization } from '../../core/services/medical.models';
import { ImmunizationFormComponent } from '../medical/immunization-form.component';
import { ImmunizationListComponent } from '../medical/immunization-list.component';
import { Estimate } from '../../core/services/estimates.models';
import { EstimatesService } from '../../core/services/estimates.service';
import { PrescriptionFormComponent } from '../medical/prescription-form.component';
import { PetDocumentsComponent } from '../medical/pet-documents.component';
import { PrescriptionListComponent } from '../medical/prescription-list.component';
import {
  ClinicalTemplate,
  ConsultationContent,
} from '../../core/services/clinical-templates.service';
import { HospitalizationDetail } from '../../core/services/hospitalization.models';
import { AdmitModalComponent } from '../hospitalization/admit-modal.component';
import { SaveTemplateComponent } from '../templates/save-template.component';
import { ApplyMode, TemplatePickerComponent } from '../templates/template-picker.component';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { LabService } from '../../core/services/lab.service';
import { LabOrder } from '../../core/services/lab.models';
import { VisitContext } from '../../core/services/visits.models';
import { Vital, VitalHint, vitalHint } from '../../shared/utils/vital-signs';
import { LabOrdersComponent } from '../medical/lab-orders.component';

const MUCOSA_OPTIONS = ['Rosadas', 'Pálidas', 'Congestivas', 'Ictéricas', 'Cianóticas'];
const HYDRATION_OPTIONS = [
  'Normal',
  'Deshidratación leve (5 %)',
  'Deshidratación moderada (8 %)',
  'Deshidratación severa (10 % o más)',
];
const BODY_CONDITIONS = [
  { value: 1, label: '1 · Emaciado' },
  { value: 2, label: '2 · Muy delgado' },
  { value: 3, label: '3 · Delgado' },
  { value: 4, label: '4 · Ideal bajo' },
  { value: 5, label: '5 · Ideal' },
  { value: 6, label: '6 · Sobrepeso leve' },
  { value: 7, label: '7 · Sobrepeso' },
  { value: 8, label: '8 · Obeso' },
  { value: 9, label: '9 · Obesidad severa' },
];

/** '' o null del input numérico → null; si no, número */
const toNum = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);
const toText = (value: string): string | null => value.trim() || null;

type LineGroup = FormGroup<{
  option: FormControl<CatalogOption>;
  quantity: FormControl<number | null>;
  discount: FormControl<number | null>;
  discountReason: FormControl<string>;
  prescriptionRef: FormControl<string>;
  showDiscount: FormControl<boolean>;
}>;

type Modal =
  'close' | 'cancel' | 'void' | 'template' | 'saveTemplate' | 'admit' | 'supplies' | null;

/** Espera tras la última tecla antes de guardar solo */
export const AUTOSAVE_MS = 1500;

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'invalid';

/** Una revisión antes de cerrar: avisa, no bloquea */
interface CloseCheck {
  text: string;
  /** Campo al que lleva "Completar" */
  field?: string;
}

const STATUS_TONE: Record<VisitDetail['status'], BadgeTone> = {
  OPEN: 'info',
  CLOSED: 'success',
  CANCELLED: 'neutral',
};
const CHARGE_TONE: Record<Charge['status'], BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  VOID: 'neutral',
};

/** Descuento de una línea: con motivo y sin pasar el importe. */
function lineValidator(group: LineGroup): ValidationErrors | null {
  const { option, quantity, discount, discountReason, prescriptionRef } = group.controls;
  const errors: ValidationErrors = {};
  const gross = (quantity.value ?? 0) * option.value.unitPrice;
  if ((discount.value ?? 0) > gross + 0.001) errors['discountTooBig'] = true;
  if ((discount.value ?? 0) > 0 && !discountReason.value.trim()) errors['discountReason'] = true;
  if (option.value.controlled && !prescriptionRef.value.trim()) errors['prescription'] = true;
  return Object.keys(errors).length ? errors : null;
}

/**
 * Pantalla de la atención: alertas de la mascota, signos y notas, cargos con sus insumos,
 * y cierre. Cerrada, solo admite adendas.
 */
@Component({
  selector: 'app-visit-page',
  imports: [
    NgTemplateOutlet,
    UsedSuppliesComponent,
    BackLinkComponent,
    FechaPipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    ImmunizationFormComponent,
    ImmunizationListComponent,
    PrescriptionFormComponent,
    PrescriptionListComponent,
    PetDocumentsComponent,
    TemplatePickerComponent,
    SaveTemplateComponent,
    AdmitModalComponent,
    LabOrdersComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visit.page.html',
  host: {
    '(document:keydown.escape)': 'moreOpen.set(false)',
    '(document:click)': 'onDocClick($event)',
  },
})
export class VisitPage {
  private readonly visits = inject(VisitsService);
  private readonly services = inject(CareServicesService);
  private readonly inventory = inject(InventoryService);
  protected readonly session = inject(SessionService);
  /** Adjuntos y consentimientos: solo quienes ven la historia clínica (no el groomer) */
  protected readonly canSeeRecord = computed(() =>
    ['ADMIN', 'VET', 'RECEPTION'].includes(this.session.role() ?? ''),
  );
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly labApi = inject(LabService);

  // ── Exámenes de laboratorio ──
  protected readonly labOrders = signal<LabOrder[]>([]);
  private readonly loadLabs = effect(() => {
    const v = this.visit();
    const id = v && v.type !== 'GROOMING' && this.canSeeRecord() ? v.id : null;
    untracked(() => {
      if (id && id !== this.labsFor) {
        this.labsFor = id;
        this.reloadLabs();
      }
    });
  });
  private labsFor: number | null = null;

  protected reloadLabs(): void {
    if (!this.labsFor) return;
    this.labApi.forVisit(this.labsFor).subscribe({
      next: (orders) => this.labOrders.set(orders),
      error: () => this.labOrders.set([]),
    });
  }

  // ── Contexto del paciente: lo que el veterinario necesita a la vista ──
  protected readonly context = signal<VisitContext | null>(null);
  private contextFor: number | null = null;
  private readonly loadContext = effect(() => {
    const v = this.visit();
    const id = v && this.canSeeRecord() ? v.id : null;
    untracked(() => {
      if (!id || id === this.contextFor) return;
      this.contextFor = id;
      // Un servidor anterior no tiene este dato: el panel simplemente no se muestra
      this.visits.context(id).subscribe({
        next: (c) => this.context.set(c),
        error: () => this.context.set(null),
      });
    });
  });

  /** 2.15: diagnósticos que la clínica más usa, sugeridos al escribir (se piden una vez) */
  protected readonly diagnosisOptions = signal<string[]>([]);
  private diagnosesLoaded = false;
  private readonly loadDiagnoses = effect(() => {
    const v = this.visit();
    const wanted = !!v && this.isConsultation() && this.editable() && this.canSeeRecord();
    untracked(() => {
      if (!wanted || this.diagnosesLoaded) return;
      this.diagnosesLoaded = true;
      this.visits.diagnoses().subscribe({
        next: (list) => this.diagnosisOptions.set(list),
        error: () => this.diagnosisOptions.set([]),
      });
    });
  });

  /** Peso de hoy frente al anterior: "+0.8 kg" */
  protected readonly weightChange = computed(() => {
    const before = this.context()?.previousWeight?.kg;
    const now = Number(this.formValues().weightKg);
    if (!before || !now) return null;
    const diff = round(now - before);
    const pct = Math.round((diff / before) * 100);
    return { diff, pct };
  });

  /** "+0.8" / "−1.2" */
  protected signed(n: number): string {
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
  }

  /** Avisos de signos vitales fuera del rango de la especie */
  protected vital(name: Vital): VitalHint | null {
    const v = this.visit();
    const values = this.formValues();
    if (!v || (!this.isConsultation() && name !== 'temperatureC')) return null;
    const raw = values[name];
    return vitalHint(v.pet.species, name, raw === null || raw === undefined ? null : Number(raw));
  }

  /** Lleva a "Servicios y productos"; con agregar, deja el cursor en el buscador */
  protected goToCharges(add: boolean): void {
    const doc = this.document;
    const target = doc.getElementById(add ? 'v-search' : 'charges-title');
    const reduce = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    if (add) (target as HTMLInputElement | null)?.focus({ preventScroll: true });
  }

  /** Un pedido nuevo o cancelado cambia los cargos de la cuenta */
  protected onLab(): void {
    this.reloadLabs();
    this.onPrescription();
  }
  private readonly estimatesApi = inject(EstimatesService);

  /** :id de la ruta */
  readonly id = input.required<string>();

  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly statusLabels = VISIT_STATUS_LABELS;
  protected readonly statusTone = STATUS_TONE;
  protected readonly chargeLabels = CHARGE_STATUS_LABELS;
  protected readonly chargeTone = CHARGE_TONE;
  protected readonly money = money;
  protected readonly formatQty = formatQty;
  protected readonly unitLabel = unitLabel;
  protected readonly formatPhone = formatPhone;
  protected readonly petAge = petAge;
  protected readonly clientCode = clientCode;
  protected readonly petCode = petCode;
  protected readonly mucosaOptions = MUCOSA_OPTIONS;
  protected readonly hydrationOptions = HYDRATION_OPTIONS;
  protected readonly bodyConditions = BODY_CONDITIONS;

  protected readonly visit = signal<VisitDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly modal = signal<Modal>(null);
  protected readonly voiding = signal<Charge | null>(null);

  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
  protected readonly canCollect = computed(() =>
    CASH_ROLES.includes(this.session.role() ?? 'GROOMER'),
  );
  protected readonly isOpen = computed(() => this.visit()?.status === 'OPEN');
  protected readonly editable = computed(() => this.isOpen() && this.canEdit());
  protected readonly isConsultation = computed(() => this.visit()?.type === 'CONSULTATION');
  /** Consulta y recepción: solo motivo y triaje (peso y temperatura); lo clínico es del veterinario */
  protected readonly triageOnly = computed(
    () => this.isConsultation() && this.session.role() === 'RECEPTION',
  );
  /** "Cerrar atención": la consulta la cierra el veterinario o el administrador */
  protected readonly canClose = computed(() => this.editable() && !this.triageOnly());

  /** Peso que parece un error de tipeo (más del doble o menos de la mitad del anterior) */
  protected readonly weightSuspicious = computed(() => {
    const before = this.context()?.previousWeight?.kg;
    const now = Number(this.formValues().weightKg);
    if (!before || !now) return false;
    return now >= before * 2 || now <= before / 2;
  });

  /** El menú "⋯" se cierra al tocar fuera (también sobre el menú lateral) */
  protected onDocClick(event: MouseEvent): void {
    if (!this.moreOpen()) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-more-menu]')) this.moreOpen.set(false);
  }
  protected readonly addingVaccine = signal(false);
  protected readonly prescribing = signal(false);
  /** Presupuestos aceptados de la mascota, listos para cargar a esta atención */
  protected readonly acceptedEstimates = signal<Estimate[]>([]);
  /** Presupuesto que se está por cargar (se confirma en un modal, sin salir de la atención) */
  protected readonly estimateToLoad = signal<Estimate | null>(null);
  protected readonly loadingEstimate = signal(false);
  protected readonly estimateRx = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(60)],
  });
  protected readonly estimateHasControlled = computed(
    () => this.estimateToLoad()?.items.some((i) => i.controlled) ?? false,
  );
  /** Recetas: veterinario o administrador (el backend exige además la colegiatura) */
  protected readonly canPrescribe = computed(() =>
    ['ADMIN', 'VET'].includes(this.session.role() ?? ''),
  );
  protected readonly activeCharges = computed(
    () => this.visit()?.charges.filter((c) => c.status !== 'VOID') ?? [],
  );
  protected readonly voidedCharges = computed(
    () => this.visit()?.charges.filter((c) => c.status === 'VOID') ?? [],
  );
  protected readonly pending = computed(() =>
    round(this.activeCharges().reduce((sum, c) => sum + c.balance, 0)),
  );
  protected readonly shortages = computed(() =>
    this.activeCharges().flatMap((c) => c.shortages.filter((s) => !s.resolved)),
  );

  // ── Signos y notas ──
  protected readonly notesForm = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    weightKg: new FormControl<number | null>(null, [
      Validators.min(0.01),
      Validators.max(999),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
    temperatureC: new FormControl<number | null>(null, [
      Validators.min(30),
      Validators.max(45),
      Validators.pattern(/^\d+(\.\d)?$/),
    ]),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(5000)] }),
    anamnesis: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(5000)] }),
    heartRate: new FormControl<number | null>(null, [
      Validators.min(10),
      Validators.max(400),
      Validators.pattern(/^\d+$/),
    ]),
    respiratoryRate: new FormControl<number | null>(null, [
      Validators.min(4),
      Validators.max(200),
      Validators.pattern(/^\d+$/),
    ]),
    capillaryRefillS: new FormControl<number | null>(null, [
      Validators.min(0),
      Validators.max(10),
      Validators.pattern(/^\d+(\.\d)?$/),
    ]),
    mucosa: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    hydration: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    bodyCondition: new FormControl<number | null>(null),
    physicalExam: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(5000)],
    }),
    diagnosis: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    diagnosisDefinitive: new FormControl(false, { nonNullable: true }),
  });
  /** Lo que hay escrito ahora (signos vitales, peso): alimenta los avisos */
  private readonly formValues = toSignal(
    this.notesForm.valueChanges.pipe(
      startWith(null),
      map(() => this.notesForm.getRawValue()),
    ),
    { requireSync: true },
  );

  // ── Guardado automático (2.8): lo escrito no se pierde aunque se olvide guardar ──
  protected readonly saveState = signal<SaveState>('idle');
  private readonly savedAt = signal<number | null>(null);
  private readonly clock = toSignal(interval(10_000).pipe(map(() => Date.now())), {
    initialValue: Date.now(),
  });
  /** Hay un guardado en curso; si cambian más cosas mientras tanto, se guarda otra vez al terminar */
  private inFlight = false;
  private saveAgain = false;
  private readonly autoSaving = this.notesForm.valueChanges
    .pipe(debounceTime(AUTOSAVE_MS), takeUntilDestroyed())
    .subscribe(() => this.autoSave());

  /** "Guardado hace 20 s" */
  protected readonly savedLabel = computed(() => {
    const at = this.savedAt();
    if (!at) return '';
    const seconds = Math.max(0, Math.round((this.clock() - at) / 1000));
    if (seconds < 10) return 'Guardado';
    if (seconds < 60) return `Guardado hace ${seconds} s`;
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? `Guardado hace ${minutes} min` : 'Guardado';
  });

  // ── Agregar cargos ──
  private readonly catalog = signal<CareService[]>([]);
  protected readonly search = new FormControl('', { nonNullable: true });
  private readonly term = toSignal(this.search.valueChanges, { initialValue: '' });
  /** Baño y corte van por Grooming (con su groomer, checklist y constancia), salvo en la atención de un grooming */
  private readonly chargeable = computed(() =>
    this.visit()?.grooming
      ? this.catalog()
      : this.catalog().filter((s) => s.category !== 'GROOMING'),
  );
  protected readonly serviceOptions = computed<CatalogOption[]>(() =>
    toServiceOptions(this.chargeable(), this.term()),
  );
  /** Si busca un servicio de grooming en una consulta, se le dice dónde va */
  protected readonly groomingHint = computed(() => {
    if (this.visit()?.grooming) return null;
    const term = this.term().trim();
    if (term.length < 2) return null;
    const match = toServiceOptions(
      this.catalog().filter((s) => s.category === 'GROOMING'),
      term,
      1,
    )[0];
    return match ? match.description : null;
  });
  protected readonly productOptions = toSignal(
    this.search.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<CatalogOption[]>([])
          : this.inventory.list({ q, chargeable: true }).pipe(
              map((page) => toProductOptions(page.items).slice(0, 6)),
              catchError(() => of<CatalogOption[]>([])),
            ),
      ),
    ),
    { initialValue: [] as CatalogOption[] },
  );
  protected readonly lines = new FormArray<LineGroup>([]);

  // ── Modales ──
  protected readonly reasonForm = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    }),
  });
  protected readonly addendum = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(2000)],
  });
  /** "Agregar adenda" se activa al escribir */
  protected readonly addendumText = toSignal(
    this.addendum.valueChanges.pipe(map((v) => !!v?.trim())),
    { initialValue: false },
  );

  constructor() {
    effect(() => this.load(Number(this.id())));
    this.services.list('active').subscribe({
      next: (list) => this.catalog.set(list),
      error: () => this.catalog.set([]),
    });
  }

  protected askLoadEstimate(estimate: Estimate): void {
    this.estimateRx.reset('');
    this.estimateToLoad.set(estimate);
  }

  protected cancelLoadEstimate(): void {
    if (!this.loadingEstimate()) this.estimateToLoad.set(null);
  }

  protected confirmLoadEstimate(): void {
    const estimate = this.estimateToLoad();
    const visit = this.visit();
    if (!estimate || !visit || this.loadingEstimate()) return;
    if (this.estimateHasControlled() && this.estimateRx.invalid) {
      this.estimateRx.markAsTouched();
      return;
    }
    this.loadingEstimate.set(true);
    const rx = this.estimateHasControlled() ? this.estimateRx.value.trim() : null;
    this.estimatesApi.convert(estimate.id, visit.id, rx).subscribe({
      next: () => {
        this.loadingEstimate.set(false);
        this.estimateToLoad.set(null);
        this.acceptedEstimates.update((list) => list.filter((x) => x.id !== estimate.id));
        this.toast.success(`${estimate.code} cargado: sus cargos ya están en esta atención.`);
        // Vuelve a leer la atención: aparecen los cargos y desaparece el aviso del presupuesto
        this.load(visit.id);
      },
      error: (error: unknown) => {
        this.loadingEstimate.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected load(id = Number(this.id())): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.visits.get(id).subscribe({
      next: (visit) => {
        this.apply(visit);
        this.loading.set(false);
        if (visit.status === 'OPEN' && this.canEdit())
          this.estimatesApi.list({ status: 'ACCEPTED', petId: visit.pet.id }).subscribe({
            next: (list) => this.acceptedEstimates.set(list),
            error: () => this.acceptedEstimates.set([]),
          });
        else this.acceptedEstimates.set([]);
      },
      error: (error: unknown) => {
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la atención.'));
        this.loading.set(false);
      },
    });
  }

  protected chargeLine(c: Charge): string {
    // Con cantidad 1 el precio ya se ve a la derecha
    return c.quantity === 1 ? '' : `${formatQty(c.quantity)} × ${money(c.unitPrice)}`;
  }

  protected shortageText(s: Charge['shortages'][number]): string {
    return `${formatQty(s.quantity)} ${unitLabel(s.baseUnit, s.quantity)} de ${s.product}`;
  }

  /** Quitar: quien lo registró mientras está abierta, o el administrador. */
  protected canVoid(c: Charge): boolean {
    if (c.status !== 'PENDING' || c.paidAmount > 0 || !this.canEdit()) return false;
    if (this.session.role() === 'ADMIN') return true;
    return this.isOpen() && c.createdBy.id === this.session.user()?.id;
  }

  // ── Signos y notas ──

  /** "Guardar ahora": lo mismo que el guardado automático, sin esperar */
  protected saveNotes(): void {
    const visit = this.visit();
    if (!visit || !this.editable()) return;
    if (this.notesForm.invalid) {
      this.notesForm.markAllAsTouched();
      this.saveState.set('invalid');
      return;
    }
    if (this.inFlight) {
      this.saveAgain = true;
      return;
    }
    this.persist(visit.id);
  }

  private autoSave(): void {
    const visit = this.visit();
    if (!visit || !this.editable() || !this.notesForm.dirty) return;
    if (this.notesForm.invalid) {
      this.saveState.set('invalid');
      return;
    }
    if (this.inFlight) {
      this.saveAgain = true;
      return;
    }
    this.persist(visit.id);
  }

  /**
   * Guarda sin reescribir el formulario: si se siguió escribiendo mientras viajaba, lo nuevo se
   * queda y se guarda en la siguiente vuelta.
   */
  private persist(id: number, then?: () => void): void {
    const payload = this.notesPayload();
    const sent = JSON.stringify(payload);
    this.inFlight = true;
    this.saveState.set('saving');
    this.visits.update(id, payload).subscribe({
      next: (updated) => {
        this.inFlight = false;
        if (JSON.stringify(this.notesPayload()) === sent) this.notesForm.markAsPristine();
        this.visit.set(updated);
        this.savedAt.set(Date.now());
        this.saveState.set('saved');
        if (this.saveAgain) {
          this.saveAgain = false;
          this.autoSave();
        }
        then?.();
      },
      error: () => {
        this.inFlight = false;
        this.saveAgain = false;
        this.saveState.set('error');
      },
    });
  }

  /** Al salir de la pantalla con algo sin guardar, se manda igual (no espera la respuesta) */
  private readonly flushOnLeave = inject(DestroyRef).onDestroy(() => {
    const visit = this.visit();
    if (visit && this.editable() && this.notesForm.dirty && this.notesForm.valid)
      this.visits.update(visit.id, this.notesPayload()).subscribe({ error: () => undefined });
  });

  /** Cerrar la pestaña con cambios sin guardar: el navegador pregunta */
  @HostListener('window:beforeunload', ['$event'])
  protected warnUnsaved(event: BeforeUnloadEvent): void {
    if (this.notesForm.dirty && this.editable()) event.preventDefault();
  }

  private notesPayload() {
    const v = this.notesForm.getRawValue();
    const soap = this.isConsultation()
      ? {
          anamnesis: toText(v.anamnesis),
          heartRate: toNum(v.heartRate),
          respiratoryRate: toNum(v.respiratoryRate),
          capillaryRefillS: toNum(v.capillaryRefillS),
          mucosa: toText(v.mucosa),
          hydration: toText(v.hydration),
          bodyCondition: v.bodyCondition,
          physicalExam: toText(v.physicalExam),
          diagnosis: toText(v.diagnosis),
          diagnosisDefinitive: v.diagnosisDefinitive,
        }
      : {};
    const triage = {
      reason: toText(v.reason),
      weightKg: toNum(v.weightKg),
      temperatureC: toNum(v.temperatureC),
    };
    // Recepción en una consulta solo envía el triaje (el servidor rechaza lo clínico)
    if (this.triageOnly()) return triage;
    return { ...triage, notes: toText(v.notes), ...soap };
  }

  // ── Plantillas de consulta ──

  /** Lo escrito en la consulta, para guardarlo como plantilla */
  protected readonly templateContent = signal<ConsultationContent | null>(null);

  protected askSaveTemplate(): void {
    const v = this.notesForm.getRawValue();
    const content: ConsultationContent = {
      reason: toText(v.reason),
      anamnesis: toText(v.anamnesis),
      physicalExam: toText(v.physicalExam),
      diagnosis: toText(v.diagnosis),
      plan: toText(v.notes),
    };
    if (!Object.values(content).some(Boolean)) {
      this.toast.error('Escribe la consulta antes de guardarla como plantilla.');
      return;
    }
    this.templateContent.set(content);
    this.modal.set('saveTemplate');
  }

  /** Aplica la plantilla al formulario (no guarda: el veterinario revisa y guarda) */
  protected applyTemplate(event: { template: ClinicalTemplate; mode: ApplyMode }): void {
    const c = event.template.consultation ?? {};
    const map = {
      reason: c.reason,
      anamnesis: c.anamnesis,
      physicalExam: c.physicalExam,
      diagnosis: c.diagnosis,
      notes: c.plan,
    } as const;
    let changed = 0;
    for (const [key, value] of Object.entries(map) as [
      keyof typeof map,
      string | null | undefined,
    ][]) {
      if (!value) continue;
      const control = this.notesForm.controls[key];
      if (event.mode === 'fill' && control.value.trim()) continue;
      control.setValue(value);
      control.markAsDirty();
      changed++;
    }
    this.modal.set(null);
    if (changed)
      this.toast.success(
        `Plantilla «${event.template.name}» aplicada: revisa y guarda la consulta.`,
      );
    else this.toast.info('No se cambió nada: todos esos campos ya tenían texto.');
  }

  // ── Internar ──

  /** Antes de internar se guarda lo escrito en la consulta */
  protected readonly saveBeforeAdmit = (): Promise<boolean> =>
    new Promise((resolve) => {
      const visit = this.visit();
      if (!visit || !this.notesForm.dirty) return resolve(true);
      if (this.notesForm.invalid) {
        this.notesForm.markAllAsTouched();
        this.toast.error('Corrige la consulta antes de internar.');
        return resolve(false);
      }
      this.visits.update(visit.id, this.notesPayload()).subscribe({
        next: () => resolve(true),
        error: (error: unknown) => {
          this.toast.error(apiErrorMessage(error));
          resolve(false);
        },
      });
    });

  protected askAdmit(): void {
    if (this.lines.length) {
      this.toast.error('Tienes cargos sin registrar: regístralos o quítalos antes de internar.');
      return;
    }
    this.modal.set('admit');
  }

  protected onAdmitted(h: HospitalizationDetail): void {
    this.modal.set(null);
    void this.router.navigate(['/hospitalizacion', h.id]);
  }

  // ── Vacunas ──

  /** Agrega o reemplaza la aplicación sin recargar la atención (no pisa el SOAP sin guardar) */
  protected onImmunization(item: Immunization): void {
    this.addingVaccine.set(false);
    this.visit.update((v) => {
      if (!v) return v;
      const exists = v.immunizations.some((i) => i.id === item.id);
      return {
        ...v,
        immunizations: exists
          ? v.immunizations.map((i) => (i.id === item.id ? item : i))
          : [...v.immunizations, item],
      };
    });
  }

  // ── Recetas ──

  /**
   * Una receta puede crear o devolver cargos (lo entregado): se recargan los cargos y las
   * recetas sin pisar el SOAP que se esté escribiendo.
   */
  protected onPrescription(): void {
    this.prescribing.set(false);
    const id = this.visit()?.id;
    if (!id) return;
    this.visits.get(id).subscribe({
      next: (fresh) =>
        this.visit.update((v) =>
          v
            ? {
                ...v,
                prescriptions: fresh.prescriptions,
                charges: fresh.charges,
                total: fresh.total,
              }
            : fresh,
        ),
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Cargos ──

  protected pick(option: CatalogOption): void {
    this.search.setValue('');
    const group: LineGroup = new FormGroup(
      {
        option: new FormControl(option, { nonNullable: true }),
        quantity: new FormControl<number | null>(1, [
          Validators.required,
          Validators.min(0.001),
          Validators.max(9999),
          Validators.pattern(/^\d+(\.\d{1,3})?$/),
        ]),
        discount: new FormControl<number | null>(null, [
          Validators.min(0),
          Validators.pattern(/^\d+(\.\d{1,2})?$/),
        ]),
        discountReason: new FormControl('', {
          nonNullable: true,
          validators: [Validators.maxLength(120)],
        }),
        prescriptionRef: new FormControl('', {
          nonNullable: true,
          validators: [Validators.maxLength(60)],
        }),
        showDiscount: new FormControl(false, { nonNullable: true }),
      },
      { validators: (g) => lineValidator(g as LineGroup) },
    );
    this.lines.push(group);
    setTimeout(() => document.getElementById(`line-qty-${this.lines.length - 1}`)?.focus());
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
  }

  protected lineTotal(group: LineGroup): number {
    const { option, quantity, discount } = group.getRawValue();
    return round(Math.max(0, (Number(quantity) || 0) * option.unitPrice - (Number(discount) || 0)));
  }

  protected linesTotal(): number {
    return round(this.lines.controls.reduce((sum, g) => sum + this.lineTotal(g), 0));
  }

  protected lineError(group: LineGroup, key: string): boolean {
    return Boolean(group.errors?.[key]) && (group.touched || group.dirty);
  }

  protected submitLines(): void {
    const visit = this.visit();
    if (!visit || this.saving() || !this.lines.length) return;
    if (this.lines.invalid) {
      this.lines.markAllAsTouched();
      for (const g of this.lines.controls) g.markAsDirty();
      return;
    }
    const items: ChargeItemInput[] = this.lines.getRawValue().map((l) => ({
      careServiceId: l.option.careServiceId,
      productId: l.option.productId,
      presentationId: l.option.presentationId,
      quantity: Number(l.quantity),
      discount: Number(l.discount) || 0,
      discountReason: Number(l.discount) > 0 ? l.discountReason.trim() : null,
      prescriptionRef: l.prescriptionRef.trim() || null,
    }));
    this.saving.set(true);
    this.visits.addCharges(visit.id, items).subscribe({
      next: (created) => {
        this.lines.clear();
        this.saving.set(false);
        if (created.shortages.length)
          this.toast.info(
            `Registrado. Ojo: se usó sin stock registrado ${created.shortages
              .map(
                (s) =>
                  `${formatQty(s.quantity)} ${unitLabel(s.baseUnit, s.quantity)} de ${s.product}`,
              )
              .join(', ')}. El administrador lo verá en alertas.`,
          );
        else
          this.toast.success(
            created.charges.length === 1 ? 'Cargo registrado.' : 'Cargos registrados.',
          );
        this.load(visit.id);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected askVoid(charge: Charge): void {
    this.voiding.set(charge);
    this.reasonForm.reset({ reason: '' });
    this.modal.set('void');
  }

  protected confirmVoid(): void {
    const charge = this.voiding();
    const visit = this.visit();
    if (!charge || !visit || this.saving()) return;
    if (this.reasonForm.invalid) {
      this.reasonForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.visits.voidCharge(charge.id, this.reasonForm.getRawValue().reason.trim()).subscribe({
      next: () => {
        this.saving.set(false);
        this.modal.set(null);
        this.toast.success('Cargo quitado. El stock volvió a su lote.');
        this.load(visit.id);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Cerrar, cancelar, adendas ──

  protected askClose(): void {
    if (this.lines.length) {
      this.toast.error('Tienes cargos sin registrar: regístralos o quítalos antes de cerrar.');
      return;
    }
    const visit = this.visit();
    if (!visit) return;
    if (!this.notesForm.dirty) {
      this.modal.set('close');
      return;
    }
    // Primero se guarda lo escrito; el resumen se arma con lo guardado
    if (this.notesForm.invalid) {
      this.notesForm.markAllAsTouched();
      this.saveState.set('invalid');
      this.toast.error('Corrige lo marcado en la consulta antes de cerrar.');
      return;
    }
    if (this.inFlight) {
      this.toast.info('Guardando la consulta… vuelve a tocar en un momento.');
      return;
    }
    this.persist(visit.id, () => this.modal.set('close'));
  }

  /** 2.13: lo que conviene revisar antes de cerrar (no bloquea) */
  protected readonly closeChecks = computed<CloseCheck[]>(() => {
    const v = this.visit();
    if (!v) return [];
    const checks: CloseCheck[] = [];
    if (this.isConsultation() && !v.diagnosis?.trim())
      checks.push({ text: 'Falta el diagnóstico.', field: 'v-dx' });
    if (this.isConsultation() && v.weightKg === null)
      checks.push({ text: 'No se registró el peso de hoy.', field: 'v-weight' });
    const waiting = this.labOrders().filter(
      (o) => o.status === 'REQUESTED' || o.status === 'SAMPLE_TAKEN',
    ).length;
    if (waiting)
      checks.push({
        text: `${waiting === 1 ? '1 examen espera' : `${waiting} exámenes esperan`} resultado: se recibe después en Exámenes.`,
      });
    const applied = new Set(
      v.immunizations.filter((i) => !i.voidedAt).map((i) => i.name.trim().toLowerCase()),
    );
    for (const o of this.context()?.overdue ?? [])
      if (!applied.has(o.name.trim().toLowerCase()))
        checks.push({ text: `${o.name} está vencida: ¿se aplicó o se le recordó al dueño?` });
    return checks;
  });

  /** "Completar": vuelve al campo que falta */
  protected fixCheck(field: string): void {
    this.modal.set(null);
    // Al enfocarlo, el navegador lo trae a la vista
    setTimeout(() => this.document.getElementById(field)?.focus());
  }

  protected confirmClose(): void {
    const visit = this.visit();
    if (!visit || this.saving()) return;
    this.saving.set(true);
    this.visits.close(visit.id).subscribe({
      next: (closed) => {
        this.apply(closed);
        this.saving.set(false);
        this.modal.set(null);
        this.toast.success(`Atención de ${closed.pet.name} cerrada.`);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Indicaciones para el dueño (2.14) ──
  private readonly document = inject(DOCUMENT);
  /**
   * Las indicaciones salen de lo que está escrito ahora (aunque el autoguardado no haya pasado).
   * Sin modal: WhatsApp ya deja leer y corregir el mensaje antes de enviarlo.
   */
  private readonly ownerBody = computed(() => {
    const v = this.visit();
    if (!v || !this.isConsultation()) return '';
    const f = this.formValues();
    return ownerInstructions({ ...v, diagnosis: f.diagnosis, notes: f.notes });
  });
  /** Hay algo que contarle al dueño */
  protected readonly hasInstructions = computed(() => this.ownerBody().length > 0);
  protected readonly ownerPhone = computed(() => {
    const v = this.visit();
    return v ? whatsappPhone(v.client.phone) : null;
  });
  protected readonly ownerLink = computed(() => {
    const v = this.visit();
    const phone = this.ownerPhone();
    const body = this.ownerBody();
    if (!v || !phone || !body) return null;
    const text = ownerMessage(v, this.clinicName(), body);
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  });
  /** Lo que sale en la hoja impresa mientras se imprime */
  protected readonly printing = signal<string | null>(null);
  protected readonly clinicName = this.session.clinicName;
  protected readonly clinicLogo = this.session.clinicLogo;

  protected printOwner(): void {
    const text = this.ownerBody();
    if (!text) return;
    this.printing.set(text);
    // Se imprime cuando la hoja ya está en la página
    setTimeout(() => {
      const style = this.document.createElement('style');
      style.textContent = '@page { size: A5 portrait; margin: 10mm; }';
      this.document.head.appendChild(style);
      window.print();
      style.remove();
      this.printing.set(null);
    });
  }

  /** Menú "⋯": lo destructivo (cancelar) no va junto a "Cerrar atención" */
  protected readonly moreOpen = signal(false);

  protected askCancel(): void {
    this.moreOpen.set(false);
    this.reasonForm.reset({ reason: '' });
    this.modal.set('cancel');
  }

  protected confirmCancel(): void {
    const visit = this.visit();
    if (!visit || this.saving()) return;
    if (this.reasonForm.invalid) {
      this.reasonForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.visits.cancel(visit.id, this.reasonForm.getRawValue().reason.trim()).subscribe({
      next: () => {
        this.saving.set(false);
        this.modal.set(null);
        this.toast.info('Atención cancelada.');
        void this.router.navigate(visit.queueEntryId ? ['/cola'] : ['/clientes', visit.client.id]);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected saveAddendum(): void {
    const visit = this.visit();
    if (!visit || this.saving()) return;
    if (this.addendum.invalid) {
      this.addendum.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.visits.addAddendum(visit.id, this.addendum.value.trim()).subscribe({
      next: (updated) => {
        this.apply(updated);
        this.addendum.reset('');
        this.saving.set(false);
        this.toast.success('Adenda agregada.');
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected closeModal(): void {
    if (!this.saving()) this.modal.set(null);
  }

  protected invalid(control: { invalid: boolean; touched: boolean }): boolean {
    return control.invalid && control.touched;
  }

  private apply(visit: VisitDetail): void {
    const typing = this.notesForm.dirty && this.visit()?.id === visit.id && visit.status === 'OPEN';
    this.visit.set(visit);
    // Una recarga (cargos, recetas) no borra lo que se está escribiendo: eso lo guarda el autoguardado
    if (!typing) this.applyForm(visit);
    if (visit.status !== 'OPEN') {
      this.addingVaccine.set(false);
      this.prescribing.set(false);
    }
    if (visit.status === 'OPEN' && this.canEdit()) {
      this.notesForm.enable({ emitEvent: false });
      // Recepción en una consulta: solo motivo, peso y temperatura
      if (this.triageOnly())
        for (const [key, control] of Object.entries(this.notesForm.controls))
          if (!['reason', 'weightKg', 'temperatureC'].includes(key))
            control.disable({ emitEvent: false });
    } else this.notesForm.disable({ emitEvent: false });
  }

  private applyForm(visit: VisitDetail): void {
    this.notesForm.reset({
      reason: visit.reason ?? '',
      weightKg: visit.weightKg,
      temperatureC: visit.temperatureC,
      notes: visit.notes ?? '',
      anamnesis: visit.anamnesis ?? '',
      heartRate: visit.heartRate,
      respiratoryRate: visit.respiratoryRate,
      capillaryRefillS: visit.capillaryRefillS,
      mucosa: visit.mucosa ?? '',
      hydration: visit.hydration ?? '',
      bodyCondition: visit.bodyCondition,
      physicalExam: visit.physicalExam ?? '',
      diagnosis: visit.diagnosis ?? '',
      diagnosisDefinitive: visit.diagnosisDefinitive,
    });
    this.saveState.set('idle');
  }

  private fail(error: unknown): void {
    this.saving.set(false);
    this.toast.error(apiErrorMessage(error));
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
