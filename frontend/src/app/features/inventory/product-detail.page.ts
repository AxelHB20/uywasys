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
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  Batch,
  CATEGORIES,
  CATEGORY_ICON,
  CATEGORY_LABELS,
  CATEGORY_TINT,
  IGV_LABELS,
  IgvAffectation,
  MOVEMENT_LABELS,
  Movement,
  MovementType,
  Presentation,
  ProductCategory,
  ProductDetail,
  STOCK_ROLES,
  defaultTracksExpiry,
  lotRequired,
  INVENTORY_HELP,
  CONTROLLED_LABEL,
  BASE_UNIT_LABELS,
  BaseUnit,
  NEW_PRODUCT_UNITS,
  lotHint,
  lotMissingText,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { Supplier } from '../../core/services/purchases.models';
import { PurchasesService } from '../../core/services/purchases.service';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { PetPickerComponent, PickedPet } from '../../shared/ui/pet-picker/pet-picker.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { limaDate } from '../../shared/utils/records';
import {
  EXPIRY_BADGE,
  expiryText,
  formatQty,
  money,
  baseTotal,
  readableStock,
  unitLabel,
} from '../../shared/utils/stock';
import { apiErrorMessage, maxDecimals } from '../../shared/utils/validators';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { ExpiryChoiceComponent } from './expiry-choice.component';
import { MonthInputComponent } from '../../shared/ui/month-input/month-input.component';
import { ControlledCheckComponent } from './controlled-check.component';
import { ChargeChoiceComponent } from './charge-choice.component';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';

const RECEIVED = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Modal = 'purchase' | 'outflow' | 'count' | 'presentation' | 'edit' | null;

const MOVEMENT_TONE: Record<MovementType, BadgeTone> = {
  PURCHASE: 'success',
  WASTE: 'danger',
  TREATMENT: 'info',
  COUNT_ADJUST: 'warning',
  RETURN: 'neutral',
  SALE: 'neutral',
  PURCHASE_VOID: 'danger',
};

@Component({
  selector: 'app-product-detail-page',
  imports: [
    BackLinkComponent,
    FechaPipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    PetPickerComponent,
    ExpiryChoiceComponent,
    MonthInputComponent,
    ControlledCheckComponent,
    ChargeChoiceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.page.html',
})
export class ProductDetailPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);
  private readonly purchasesApi = inject(PurchasesService);

  readonly id = input.required<string>();

  protected readonly categories = CATEGORIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly categoryIcon = CATEGORY_ICON;
  protected readonly categoryTint = CATEGORY_TINT;
  protected readonly igvTypes = Object.keys(IGV_LABELS) as IgvAffectation[];
  protected readonly igvLabels = IGV_LABELS;
  protected readonly movementLabels = MOVEMENT_LABELS;
  protected readonly movementTone = MOVEMENT_TONE;
  protected readonly expiryBadge = EXPIRY_BADGE;
  protected readonly expiryText = expiryText;
  protected readonly money = money;
  protected readonly today = limaDate(new Date());
  protected readonly canManage = computed(() =>
    STOCK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
  protected readonly isAdmin = computed(() => this.session.isAdmin());

  protected readonly product = signal<ProductDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly modal = signal<Modal>(null);
  protected readonly saving = signal(false);

  protected readonly activePresentations = computed(
    () => this.product()?.presentations.filter((p) => p.active) ?? [],
  );
  protected readonly stockText = computed(() => {
    const p = this.product();
    return p ? readableStock(p.totalStock, p.baseUnit, p.presentations) : '';
  });
  /** "= 200 tabletas" solo si el stock se muestra en cajas o blísteres (no repite "23 unidades") */
  protected readonly stockTotal = computed(() => {
    const p = this.product();
    return p ? baseTotal(p.totalStock, p.baseUnit, p.presentations) : null;
  });
  protected readonly stockValue = computed(() => {
    const p = this.product();
    if (!p) return null;
    const total = p.batches.reduce((sum, b) => sum + (b.unitCost ?? 0) * b.quantity, 0);
    return p.batches.some((b) => b.unitCost !== null) ? Math.round(total * 100) / 100 : null;
  });
  protected readonly nextBatch = computed(
    () => this.product()?.batches.find((b) => b.expiry) ?? null,
  );

  // Kardex
  protected readonly movements = signal<Movement[]>([]);
  protected readonly movementsTotal = signal(0);
  protected readonly movementsPage = signal(1);
  protected readonly movementsLoading = signal(false);

  // ── Compra ──
  protected readonly purchaseForm = new FormGroup({
    presentationId: new FormControl<number | null>(null, [Validators.required]),
    quantity: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0.001),
      maxDecimals(3),
    ]),
    lotNumber: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    expiresAt: new FormControl('', { nonNullable: true }),
    costPerPresentation: new FormControl<number | null>(null, [Validators.min(0), maxDecimals(4)]),
    supplier: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
    supplierId: new FormControl<number | null>(null),
    documentNumber: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(30)],
    }),
  });
  protected readonly purchaseValue = toSignal(this.purchaseForm.valueChanges, {
    initialValue: this.purchaseForm.value,
  });
  protected readonly purchasePreview = computed(() => {
    const p = this.product();
    const v = this.purchaseValue();
    const pres = p?.presentations.find((x) => x.id === Number(v.presentationId));
    if (!p || !pres || !v.quantity) return null;
    const units = Math.round(v.quantity * pres.factor * 1000) / 1000;
    return `= ${formatQty(units)} ${unitLabel(p.baseUnit, units)}`;
  });
  /** Lo que vence pide lote y fecha; camas, juguetes y similares no */
  protected readonly needsLot = computed(() => this.product()?.tracksExpiry ?? true);
  protected readonly help = INVENTORY_HELP;
  protected readonly controlledLabel = CONTROLLED_LABEL;

  /** Lo que no cuadra en el producto, con su arreglo */
  protected readonly issues = computed(() => {
    const p = this.product();
    if (!p) return [];
    const list: { key: 'base' | 'supply' | 'controlled'; text: string }[] = [];
    const active = p.presentations.filter((x) => x.active);
    const unit = BASE_UNIT_LABELS[p.baseUnit][0];
    const wrong = this.wrongBase();
    if (wrong)
      list.push({
        key: 'base',
        text: `«${wrong.name}» dice que trae ${wrong.factor} ${BASE_UNIT_LABELS[p.baseUnit][1]}. Si es 1 ${unit} suelta, «Trae» debe ser 1 (¿pusieron el stock ahí?).`,
      });
    if (p.chargeable === false && p.category !== 'SUPPLY' && active.some((x) => (x.price ?? 0) > 0))
      list.push({
        key: 'supply',
        text: 'Tiene precio de venta pero está marcado como insumo: no aparece al cobrar.',
      });
    if (p.controlled && p.category !== 'MEDICINE')
      list.push({
        key: 'controlled',
        text: `Está marcado como ${CONTROLLED_LABEL} sin ser medicamento.`,
      });
    return list;
  });

  /**
   * La presentación "de 1" mal cargada: ninguna trae 1 y hay una que se llama como la unidad
   * ("Tableta x1") o, si no, la más chica.
   */
  private wrongBase(): Presentation | null {
    const p = this.product();
    if (!p) return null;
    const active = p.presentations.filter((x) => x.active);
    // En ml y g, "Por kilo = 1000" es una conversión de verdad (igual que en "Corregir productos")
    if (!NEW_PRODUCT_UNITS.includes(p.baseUnit)) return null;
    if (!active.length || active.some((x) => x.factor === 1)) return null;
    const unit = BASE_UNIT_LABELS[p.baseUnit][0].toLowerCase();
    const named = active.find((x) => {
      const n = x.name.toLowerCase().trim();
      return n.startsWith(unit) || /\bx\s*1\b/.test(n);
    });
    const plain = active.length === 1 && !/\d/.test(active[0].name) ? active[0] : null;
    return named ?? plain;
  }

  protected fixIssue(key: 'base' | 'supply' | 'controlled'): void {
    const p = this.product();
    if (!p) return;
    if (key === 'base') {
      this.openPresentation(this.wrongBase());
      return;
    }
    this.openEdit();
  }
  protected readonly lotHintMsg = computed(() => {
    const p = this.product();
    return p ? lotHint(p.category, p.controlled) : '';
  });
  protected readonly lotMissingMsg = computed(() => {
    const p = this.product();
    return p ? lotMissingText(p.category, p.controlled) : 'Falta el lote';
  });
  /** Vacunas y controlados piden lote; lo demás que vence, basta la fecha */
  protected readonly lotMandatory = computed(() => {
    const p = this.product();
    return !!p && lotRequired(p.category, p.controlled);
  });
  protected readonly purchaseTried = signal(false);
  protected readonly lotMissing = computed(
    () =>
      this.purchaseTried() &&
      this.needsLot() &&
      this.lotMandatory() &&
      !this.purchaseValue().lotNumber?.trim(),
  );
  protected readonly expiryMissing = computed(
    () => this.purchaseTried() && this.needsLot() && !this.purchaseValue().expiresAt,
  );

  // ── Salida ──
  protected readonly outflowForm = new FormGroup({
    type: new FormControl<'WASTE' | 'TREATMENT'>('WASTE', { nonNullable: true }),
    quantity: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0.001),
      maxDecimals(3),
    ]),
    unit: new FormControl<number | 'base'>('base', { nonNullable: true }),
    batchId: new FormControl<number | 'auto'>('auto', { nonNullable: true }),
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    }),
    prescriptionRef: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(60)],
    }),
  });
  private readonly outflowValue = toSignal(this.outflowForm.valueChanges, {
    initialValue: this.outflowForm.value,
  });
  protected readonly outflowType = computed(() => this.outflowValue().type ?? 'WASTE');
  protected readonly pickedPet = signal<PickedPet | null>(null);
  protected readonly outflowTried = signal(false);
  /** Uso de un controlado: exige paciente y receta */
  protected readonly controlledUse = computed(
    () => !!this.product()?.controlled && this.outflowType() === 'TREATMENT',
  );
  protected readonly outflowBatches = computed(() => {
    const batches = this.product()?.batches ?? [];
    // Para usar en un paciente no se ofrecen lotes vencidos; para merma sí
    return this.outflowType() === 'WASTE'
      ? batches
      : batches.filter((b) => b.expiry?.level !== 'EXPIRED');
  });

  // ── Conteo ──
  /** Lo que hay para sacar: el lote elegido o todo el stock */
  protected readonly outflowAvailable = computed(() => {
    const p = this.product();
    if (!p) return '';
    const id = this.outflowValue().batchId;
    const batch = id && id !== 'auto' ? p.batches.find((b) => b.id === Number(id)) : null;
    const qty = batch ? batch.quantity : p.totalStock;
    const total = baseTotal(qty, p.baseUnit, p.presentations);
    const text = readableStock(qty, p.baseUnit, p.presentations);
    return (total ? `${text} (${total})` : text) + (batch ? ` en ${this.batchName(batch)}` : '');
  });

  protected readonly countForm = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3)],
    }),
    items: new FormArray<FormControl<number | null>>([]),
  });

  // ── Presentación ──
  protected readonly editingPresentation = signal<Presentation | null>(null);
  protected readonly presentationForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    factor: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0.001),
      maxDecimals(3),
    ]),
    price: new FormControl<number | null>(null, [Validators.min(0), maxDecimals(2)]),
    active: new FormControl(true, { nonNullable: true }),
  });

  // ── Editar producto ──
  protected readonly editForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(120)],
    }),
    category: new FormControl<ProductCategory>('MEDICINE', { nonNullable: true }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[\w.-]{0,30}$/)],
    }),
    barcode: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    minStock: new FormControl<number | null>(null, [Validators.min(0), maxDecimals(3)]),
    requiresPrescription: new FormControl(false, { nonNullable: true }),
    controlled: new FormControl(false, { nonNullable: true }),
    igv: new FormControl<IgvAffectation>('TAXED', { nonNullable: true }),
    sunatUnit: new FormControl('NIU', {
      nonNullable: true,
      validators: [Validators.pattern(/^[A-Z0-9]{2,3}$/)],
    }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    active: new FormControl(true, { nonNullable: true }),
    tracksExpiry: new FormControl(true, { nonNullable: true }),
    chargeable: new FormControl(true, { nonNullable: true }),
    baseUnit: new FormControl<BaseUnit>('UNIT', { nonNullable: true }),
  });
  /** Ya se sabe cuántos movimientos tiene (primera página del kardex cargada) */
  private readonly movementsLoaded = signal(false);
  /** Sin compras, ventas ni stock inicial: se puede cambiar cómo se cuenta (Unidad → Frasco) */
  protected readonly canChangeUnit = computed(
    () => this.movementsLoaded() && this.movementsTotal() === 0,
  );
  protected readonly unitLabels = BASE_UNIT_LABELS;
  /** "La presentación «Unidad» pasará a llamarse «Frasco»" (si existe y no choca) */
  protected renameHint(): string | null {
    const p = this.product();
    const to = this.editForm.controls.baseUnit.value;
    if (!p || to === p.baseUnit) return null;
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const [from, target] = [cap(BASE_UNIT_LABELS[p.baseUnit][0]), cap(BASE_UNIT_LABELS[to][0])];
    const names = p.presentations.map((x) => x.name.trim().toLowerCase());
    if (!names.includes(from.toLowerCase()) || names.includes(target.toLowerCase())) return null;
    return `La presentación «${from}» pasará a llamarse «${target}».`;
  }

  protected unitChoices(): BaseUnit[] {
    const p = this.product();
    return !p || NEW_PRODUCT_UNITS.includes(p.baseUnit)
      ? NEW_PRODUCT_UNITS
      : [p.baseUnit, ...NEW_PRODUCT_UNITS];
  }
  private readonly editTracks = toSignal(this.editForm.controls.tracksExpiry.valueChanges, {
    initialValue: true,
  });
  /** Pasar a "no vence" borra las fechas de los lotes actuales: se avisa antes */
  protected readonly dropsExpiry = computed(() => {
    const p = this.product();
    return !!p?.tracksExpiry && !this.editTracks() && p.batches.some((b) => b.expiresAt);
  });

  constructor() {
    // El IGV define cuánto impuesto se declara: solo el administrador lo cambia
    if (!this.isAdmin()) this.editForm.controls.igv.disable();
    effect(() => this.load(Number(this.id())));
    // Al cambiar de categoría, el control de vencimiento la sigue mientras no se haya tocado
    this.editForm.controls.category.valueChanges.subscribe((category) => {
      const tracks = this.editForm.controls.tracksExpiry;
      if (this.modal() === 'edit' && !tracks.dirty) tracks.setValue(defaultTracksExpiry(category));
    });
    this.outflowForm.controls.type.valueChanges.subscribe(() => {
      this.outflowForm.controls.batchId.setValue('auto');
      this.pickedPet.set(null);
    });
  }

  protected load(id = Number(this.id())): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.inventory.get(id).subscribe({
      next: (product) => {
        this.product.set(product);
        this.loading.set(false);
        this.loadMovements(1);
      },
      error: (error: unknown) => {
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el producto.'));
        this.loading.set(false);
      },
    });
  }

  protected loadMovements(page: number): void {
    const p = this.product();
    if (!p) return;
    this.movementsLoading.set(true);
    this.inventory.movements(p.id, page).subscribe({
      next: (res) => {
        this.movements.set(page === 1 ? res.items : [...this.movements(), ...res.items]);
        this.movementsTotal.set(res.total);
        if (page === 1) this.movementsLoaded.set(true);
        this.movementsPage.set(page);
        this.movementsLoading.set(false);
      },
      error: () => this.movementsLoading.set(false),
    });
  }

  protected batchQty(b: Batch): string {
    const p = this.product()!;
    return readableStock(b.quantity, p.baseUnit, p.presentations);
  }

  protected movementQty(m: Movement): string {
    const p = this.product()!;
    const value = Math.abs(m.quantity);
    return `${m.quantity > 0 ? '+' : '−'}${formatQty(value)} ${unitLabel(p.baseUnit, value)}`;
  }

  protected units(value: number): string {
    const p = this.product();
    return p ? `${formatQty(value)} ${unitLabel(p.baseUnit, value)}` : '';
  }

  /** Cómo se nombra un ingreso: por su lote si vence, por la fecha en que llegó si no */
  protected batchName(b: Batch): string {
    return this.needsLot()
      ? `Lote ${b.lotNumber ?? '—'}`
      : `Ingreso del ${RECEIVED.format(new Date(b.receivedAt))}`;
  }

  protected unitName(): string {
    const p = this.product();
    return p ? unitLabel(p.baseUnit, 2) : '';
  }

  // ── Proveedores (lista de Compras) ──
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly suppliersFailed = signal(false);
  private suppliersLoaded = false;

  private loadSuppliers(): void {
    if (this.suppliersLoaded) return;
    this.suppliersLoaded = true;
    this.purchasesApi.suppliers().subscribe({
      next: (list) => this.suppliers.set(list),
      error: () => this.suppliersFailed.set(true),
    });
  }

  // ── Abrir modales ──
  protected openPurchase(): void {
    const largest = [...this.activePresentations()].sort((a, b) => b.factor - a.factor)[0];
    this.purchaseForm.reset({
      presentationId: largest?.id ?? null,
      quantity: null,
      lotNumber: '',
      expiresAt: '',
      costPerPresentation: null,
      supplier: '',
      supplierId: null,
      documentNumber: '',
    });
    this.loadSuppliers();
    this.purchaseTried.set(false);
    this.modal.set('purchase');
  }

  /** El insumo descontado por un servicio no es "uso interno" registrado a mano */
  protected movementLabel(m: Movement): string {
    if (m.type === 'TREATMENT' && m.refType === 'charge') return 'Servicio';
    return this.movementLabels[m.type];
  }

  protected openOutflow(type: 'WASTE' | 'TREATMENT' = 'WASTE', batch?: Batch): void {
    this.outflowForm.reset({
      type,
      quantity: null,
      unit: 'base',
      batchId: 'auto',
      reason: '',
      prescriptionRef: '',
    });
    if (batch) {
      this.outflowForm.controls.batchId.setValue(batch.id);
      if (batch.expiry?.level === 'EXPIRED')
        this.outflowForm.controls.reason.setValue('Lote vencido');
    }
    this.pickedPet.set(null);
    this.outflowTried.set(false);
    this.modal.set('outflow');
  }

  /** "Es de uso interno" es lo contrario de "se cobra al cliente" */
  protected setInternal(internal: boolean): void {
    const c = this.editForm.controls.chargeable;
    c.setValue(!internal);
    c.markAsDirty();
  }

  protected countHasDecimals(): boolean {
    return this.countForm.controls.items.controls.some((c) => c.hasError('decimals'));
  }

  protected openCount(): void {
    const items = this.countForm.controls.items;
    items.clear();
    for (const b of this.product()?.batches ?? []) {
      items.push(
        new FormControl<number | null>(b.quantity, [
          Validators.required,
          Validators.min(0),
          maxDecimals(3),
        ]),
      );
    }
    this.countForm.controls.reason.reset('');
    this.modal.set('count');
  }

  private readonly countValue = toSignal(this.countForm.controls.items.valueChanges, {
    initialValue: [] as (number | null)[],
  });

  /** "−5 tabletas" mientras se escribe lo contado (null si coincide o está vacío) */
  protected countDiff(index: number, system: number): string | null {
    const counted = this.countValue()[index];
    if (counted === null || counted === undefined || Number.isNaN(Number(counted))) return null;
    const diff = Math.round((Number(counted) - system) * 1000) / 1000;
    if (diff === 0) return null;
    return `${diff > 0 ? '+' : '−'}${this.units(Math.abs(diff))}`;
  }

  /** Unidades SUNAT comunes; si el producto trae otra (importada), se mantiene en la lista */
  protected readonly sunatUnits = computed(() => {
    const list = [
      { code: 'NIU', label: 'Unidad (NIU)' },
      { code: 'ZZ', label: 'Servicio (ZZ)' },
      { code: 'KGM', label: 'Kilogramo (KGM)' },
      { code: 'GRM', label: 'Gramo (GRM)' },
      { code: 'LTR', label: 'Litro (LTR)' },
      { code: 'MLT', label: 'Mililitro (MLT)' },
      { code: 'BX', label: 'Caja (BX)' },
    ];
    const current = this.product()?.sunatUnit;
    return current && !list.some((u) => u.code === current)
      ? [...list, { code: current, label: current }]
      : list;
  });

  protected openPresentation(p: Presentation | null): void {
    this.editingPresentation.set(p);
    this.presentationForm.reset({
      name: p?.name ?? '',
      factor: p?.factor ?? null,
      price: p?.price ?? null,
      active: p?.active ?? true,
    });
    this.modal.set('presentation');
  }

  protected openEdit(): void {
    const p = this.product();
    if (!p) return;
    this.editForm.reset({
      name: p.name,
      category: p.category,
      code: p.code ?? '',
      barcode: p.barcode ?? '',
      minStock: p.minStock,
      requiresPrescription: p.requiresPrescription,
      controlled: p.controlled,
      igv: p.igv,
      sunatUnit: p.sunatUnit,
      notes: p.notes ?? '',
      active: p.active,
      tracksExpiry: p.tracksExpiry,
      chargeable: p.chargeable ?? true,
      baseUnit: p.baseUnit,
    });
    this.modal.set('edit');
  }

  protected close(): void {
    if (!this.saving()) this.modal.set(null);
  }

  // ── Guardar ──
  protected savePurchase(): void {
    const p = this.product();
    this.purchaseTried.set(true);
    if (!p || this.invalidForm(this.purchaseForm)) return;
    const v = this.purchaseForm.getRawValue();
    const tracks = this.needsLot();
    if (tracks && ((this.lotMandatory() && !v.lotNumber.trim()) || !v.expiresAt)) {
      setTimeout(() =>
        document.querySelector<HTMLElement>('#purchase-form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    this.run(
      this.inventory.purchase(p.id, {
        presentationId: Number(v.presentationId),
        quantity: Number(v.quantity),
        lotNumber: tracks ? v.lotNumber.trim() || null : null,
        expiresAt: tracks ? v.expiresAt || null : null,
        costPerPresentation: v.costPerPresentation === null ? null : Number(v.costPerPresentation),
        supplier: this.suppliersFailed() ? v.supplier.trim() || null : null,
        supplierId: this.suppliersFailed() ? undefined : v.supplierId,
        documentNumber: v.documentNumber.trim() || null,
      }),
      'Compra registrada',
    );
  }

  protected saveOutflow(): void {
    const p = this.product();
    this.outflowTried.set(true);
    if (!p || this.invalidForm(this.outflowForm)) return;
    const v = this.outflowForm.getRawValue();
    if (this.controlledUse() && (!this.pickedPet() || !v.prescriptionRef.trim())) {
      this.toast.error('Un psicotrópico pide el paciente y el N.º de receta');
      return;
    }
    this.run(
      this.inventory.outflow(p.id, {
        type: v.type,
        quantity: Number(v.quantity),
        presentationId: v.unit === 'base' ? null : Number(v.unit),
        batchId: v.batchId === 'auto' ? null : Number(v.batchId),
        reason: v.reason.trim(),
        petId: v.type === 'TREATMENT' ? (this.pickedPet()?.petId ?? null) : null,
        prescriptionRef: v.prescriptionRef.trim() || null,
      }),
      v.type === 'WASTE' ? 'Merma registrada' : 'Uso registrado',
    );
  }

  protected saveCount(): void {
    const p = this.product();
    if (!p || this.invalidForm(this.countForm)) return;
    const counted = this.countForm.controls.items.getRawValue();
    const items = p.batches
      .map((b, i) => ({ batchId: b.id, counted: Number(counted[i]) }))
      .filter((item, i) => item.counted !== p.batches[i].quantity);
    if (!items.length) {
      this.toast.info('Las cantidades contadas coinciden con el sistema');
      this.modal.set(null);
      return;
    }
    this.run(
      this.inventory.count(p.id, { reason: this.countForm.controls.reason.value.trim(), items }),
      'Conteo ajustado',
    );
  }

  protected savePresentation(): void {
    const p = this.product();
    if (!p || this.invalidForm(this.presentationForm)) return;
    const v = this.presentationForm.getRawValue();
    const data = {
      name: v.name.trim(),
      factor: Number(v.factor),
      price: v.price === null ? null : Number(v.price),
    };
    const editing = this.editingPresentation();
    const request: Observable<Presentation> = editing
      ? this.inventory.updatePresentation(editing.id, { ...data, active: v.active })
      : this.inventory.addPresentation(p.id, data);
    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.modal.set(null);
        this.toast.success(editing ? 'Presentación actualizada' : 'Presentación agregada');
        this.load(p.id);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected saveEdit(): void {
    const p = this.product();
    if (!p || this.invalidForm(this.editForm)) return;
    const v = this.editForm.getRawValue();
    this.run(
      this.inventory.update(p.id, {
        name: v.name.trim(),
        category: v.category,
        code: v.code.trim() || null,
        barcode: v.barcode.trim() || null,
        minStock: v.minStock ?? 0,
        requiresPrescription: v.requiresPrescription,
        controlled: v.controlled,
        igv: v.igv,
        sunatUnit: v.sunatUnit,
        notes: v.notes.trim() || null,
        active: v.active,
        tracksExpiry: v.tracksExpiry,
        chargeable: v.chargeable,
        ...(this.canChangeUnit() && v.baseUnit !== p.baseUnit ? { baseUnit: v.baseUnit } : {}),
      }),
      'Producto actualizado',
    );
  }

  protected invalid(control: { invalid: boolean; touched: boolean }): boolean {
    return control.invalid && control.touched;
  }

  private invalidForm(form: FormGroup): boolean {
    if (form.valid) return false;
    form.markAllAsTouched();
    setTimeout(() =>
      document.querySelector<HTMLElement>('dialog[open] [aria-invalid="true"]')?.focus(),
    );
    return true;
  }

  /** Guarda desde un modal: actualiza la ficha y el kardex con la respuesta. */
  private run(request: Observable<ProductDetail>, message: string): void {
    this.saving.set(true);
    request.subscribe({
      next: (product) => {
        this.product.set(product);
        this.saving.set(false);
        this.modal.set(null);
        this.toast.success(message);
        this.loadMovements(1);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
