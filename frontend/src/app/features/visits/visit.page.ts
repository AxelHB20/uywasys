import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
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

type Modal = 'close' | 'cancel' | 'void' | null;

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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visit.page.html',
})
export class VisitPage {
  private readonly visits = inject(VisitsService);
  private readonly services = inject(CareServicesService);
  private readonly inventory = inject(InventoryService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
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
  protected readonly addingVaccine = signal(false);
  protected readonly prescribing = signal(false);
  /** Presupuestos aceptados de la mascota, listos para cargar a esta atención */
  protected readonly acceptedEstimates = signal<Estimate[]>([]);
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

  // ── Agregar cargos ──
  private readonly catalog = signal<CareService[]>([]);
  protected readonly search = new FormControl('', { nonNullable: true });
  private readonly term = toSignal(this.search.valueChanges, { initialValue: '' });
  protected readonly serviceOptions = computed<CatalogOption[]>(() =>
    toServiceOptions(this.catalog(), this.term()),
  );
  protected readonly productOptions = toSignal(
    this.search.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<CatalogOption[]>([])
          : this.inventory.list({ q }).pipe(
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

  constructor() {
    effect(() => this.load(Number(this.id())));
    this.services.list('active').subscribe({
      next: (list) => this.catalog.set(list),
      error: () => this.catalog.set([]),
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

  protected saveNotes(): void {
    const visit = this.visit();
    if (!visit || this.saving()) return;
    if (this.notesForm.invalid) {
      this.notesForm.markAllAsTouched();
      return;
    }
    const v = this.notesForm.getRawValue();
    this.saving.set(true);
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
    this.visits
      .update(visit.id, {
        reason: toText(v.reason),
        weightKg: toNum(v.weightKg),
        temperatureC: toNum(v.temperatureC),
        notes: toText(v.notes),
        ...soap,
      })
      .subscribe({
        next: (updated) => {
          this.apply(updated);
          this.saving.set(false);
          this.toast.success('Atención guardada.');
        },
        error: (error: unknown) => this.fail(error),
      });
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
    if (this.notesForm.dirty) {
      this.toast.error('Guarda la consulta antes de cerrar la atención.');
      return;
    }
    if (this.lines.length) {
      this.toast.error('Tienes cargos sin registrar: regístralos o quítalos antes de cerrar.');
      return;
    }
    this.modal.set('close');
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

  protected askCancel(): void {
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
    this.visit.set(visit);
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
    if (visit.status !== 'OPEN') {
      this.addingVaccine.set(false);
      this.prescribing.set(false);
    }
    if (visit.status === 'OPEN' && this.canEdit()) this.notesForm.enable();
    else this.notesForm.disable();
  }

  private fail(error: unknown): void {
    this.saving.set(false);
    this.toast.error(apiErrorMessage(error));
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
