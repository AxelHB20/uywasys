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
  CATEGORY_LABELS,
  IGV_LABELS,
  IgvAffectation,
  MOVEMENT_LABELS,
  Movement,
  MovementType,
  Presentation,
  ProductCategory,
  ProductDetail,
  STOCK_ROLES,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
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
  readableStock,
  unitLabel,
} from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';

type Modal = 'purchase' | 'outflow' | 'count' | 'presentation' | 'edit' | null;

const MOVEMENT_TONE: Record<MovementType, BadgeTone> = {
  PURCHASE: 'success',
  WASTE: 'danger',
  TREATMENT: 'info',
  COUNT_ADJUST: 'warning',
  RETURN: 'neutral',
  SALE: 'neutral',
};

@Component({
  selector: 'app-product-detail-page',
  imports: [
    FechaPipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    PetPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.page.html',
})
export class ProductDetailPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);

  readonly id = input.required<string>();

  protected readonly categories = CATEGORIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
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
    quantity: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
    lotNumber: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    expiresAt: new FormControl('', { nonNullable: true }),
    costPerPresentation: new FormControl<number | null>(null, [Validators.min(0)]),
    supplier: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
    documentNumber: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(30)],
    }),
  });
  private readonly purchaseValue = toSignal(this.purchaseForm.valueChanges, {
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
  protected readonly needsLot = computed(() => this.product()?.category !== 'ACCESSORY');

  // ── Salida ──
  protected readonly outflowForm = new FormGroup({
    type: new FormControl<'WASTE' | 'TREATMENT'>('WASTE', { nonNullable: true }),
    quantity: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
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
    factor: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
    price: new FormControl<number | null>(null, [Validators.min(0)]),
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
    minStock: new FormControl<number | null>(null, [Validators.min(0)]),
    requiresPrescription: new FormControl(false, { nonNullable: true }),
    controlled: new FormControl(false, { nonNullable: true }),
    igv: new FormControl<IgvAffectation>('TAXED', { nonNullable: true }),
    sunatUnit: new FormControl('NIU', {
      nonNullable: true,
      validators: [Validators.pattern(/^[A-Z0-9]{2,3}$/)],
    }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    active: new FormControl(true, { nonNullable: true }),
  });

  constructor() {
    effect(() => this.load(Number(this.id())));
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

  protected unitName(): string {
    const p = this.product();
    return p ? unitLabel(p.baseUnit, 2) : '';
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
      documentNumber: '',
    });
    this.modal.set('purchase');
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

  protected openCount(): void {
    const items = this.countForm.controls.items;
    items.clear();
    for (const b of this.product()?.batches ?? []) {
      items.push(
        new FormControl<number | null>(b.quantity, [Validators.required, Validators.min(0)]),
      );
    }
    this.countForm.controls.reason.reset('');
    this.modal.set('count');
  }

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
    });
    this.modal.set('edit');
  }

  protected close(): void {
    if (!this.saving()) this.modal.set(null);
  }

  // ── Guardar ──
  protected savePurchase(): void {
    const p = this.product();
    if (!p || this.invalidForm(this.purchaseForm)) return;
    const v = this.purchaseForm.getRawValue();
    if (this.needsLot() && (!v.lotNumber.trim() || !v.expiresAt)) {
      this.toast.error('Ingresa el lote y la fecha de vencimiento');
      return;
    }
    this.run(
      this.inventory.purchase(p.id, {
        presentationId: Number(v.presentationId),
        quantity: Number(v.quantity),
        lotNumber: v.lotNumber.trim() || null,
        expiresAt: v.expiresAt || null,
        costPerPresentation: v.costPerPresentation === null ? null : Number(v.costPerPresentation),
        supplier: v.supplier.trim() || null,
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
      this.toast.error('Un controlado pide el paciente y el N.º de receta');
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
