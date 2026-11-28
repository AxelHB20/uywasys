import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import {
  BASE_UNIT_LABELS,
  BaseUnit,
  CATEGORIES,
  CATEGORY_LABELS,
  IGV_LABELS,
  IgvAffectation,
  NEW_PRODUCT_UNITS,
  ProductCategory,
  ProductSummary,
  defaultChargeable,
  defaultTracksExpiry,
  INVENTORY_HELP,
  lotHint,
  lotMissingText,
  lotRequired,
} from '../../core/services/inventory.models';
import { SessionService } from '../../core/auth/session.service';
import { InventoryService } from '../../core/services/inventory.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { MonthInputComponent } from '../../shared/ui/month-input/month-input.component';
import { ControlledCheckComponent } from './controlled-check.component';
import { ChargeChoiceComponent } from './charge-choice.component';
import {
  IgvChoiceComponent,
  costWithoutIgv,
} from '../../shared/ui/igv-choice/igv-choice.component';
import { apiErrorMessage, maxDecimals } from '../../shared/utils/validators';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { formatQty, money, unitLabel } from '../../shared/utils/stock';
import { normalizeText } from '../../shared/catalog/catalog-options';

type PresentationForm = FormGroup<{
  name: FormControl<string>;
  factor: FormControl<number | null>;
  price: FormControl<number | null>;
}>;

const DEFAULT_PRESENTATION: Record<BaseUnit, string> = {
  UNIT: 'Unidad',
  TABLET: 'Tableta',
  BOX: 'Caja',
  BOTTLE: 'Frasco',
  ML: 'Frasco',
  G: 'Bolsa',
};

function presentationForm(
  name = '',
  factor: number | null = 1,
  price: number | null = null,
): PresentationForm {
  return new FormGroup({
    name: new FormControl(name, {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    factor: new FormControl<number | null>(factor, [
      Validators.required,
      Validators.min(0.001),
      maxDecimals(3),
    ]),
    price: new FormControl<number | null>(price, [Validators.min(0), maxDecimals(2)]),
  });
}

/** Mismo nombre sin importar tildes, mayúsculas ni espacios de más */
const same = (a: string, b: string) =>
  normalizeText(a).replace(/\s+/g, ' ') === normalizeText(b).replace(/\s+/g, ' ');

/** Botones "También se vende por" según cómo se cuenta el stock */
const SUGGESTIONS: Record<BaseUnit, string[]> = {
  TABLET: ['Blíster', 'Caja'],
  UNIT: ['Caja', 'Paquete'],
  BOX: [],
  BOTTLE: ['Caja'],
  ML: ['Frasco'],
  G: ['Bolsa'],
};

/** Ejemplo bajo el título, según la unidad */
const EXAMPLES: Record<BaseUnit, string> = {
  TABLET: 'Ej.: Tableta S/ 1.50 · Blíster x 10 S/ 14 · Caja x 100 S/ 120.',
  UNIT: 'Ej.: Unidad S/ 25 · Caja x 12 S/ 270.',
  BOX: 'Ej.: Caja S/ 25.',
  BOTTLE: 'Ej.: Frasco 60 ml S/ 38 · Caja x 6 S/ 210.',
  ML: 'Ej.: ml S/ 1.50 · Frasco 50 ml S/ 45.',
  G: 'Ej.: g S/ 0.10 · Bolsa 2 kg S/ 145.',
};

/** Nombre que se arma solo ("Caja" + 100 → "Caja x 100") mientras no lo cambien a mano */
const AUTO_NAME = /^(Blíster|Caja|Paquete|Frasco|Bolsa)(\s*x\s*[\d.,]*)?$/;

/** Lo agregado en esta visita: se queda en la pantalla para seguir cargando sin volver */
interface Added {
  id: number;
  name: string;
  stock: string | null;
}

@Component({
  selector: 'app-new-product-page',
  imports: [
    BackLinkComponent,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    MonthInputComponent,
    ControlledCheckComponent,
    ChargeChoiceComponent,
    IgvChoiceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-product.page.html',
})
export class NewProductPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  /** El IGV define cuánto impuesto se declara: solo el administrador lo cambia */
  protected readonly isAdmin = inject(SessionService).isAdmin;

  protected readonly categories = CATEGORIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly units = NEW_PRODUCT_UNITS;
  protected readonly unitLabels = BASE_UNIT_LABELS;
  protected readonly igvTypes = Object.keys(IGV_LABELS) as IgvAffectation[];
  protected readonly igvLabels = IGV_LABELS;
  protected readonly help = INVENTORY_HELP;
  protected readonly saving = signal(false);
  protected readonly added = signal<Added[]>([]);
  protected readonly tried = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(120)],
    }),
    category: new FormControl<ProductCategory | null>(null, [Validators.required]),
    baseUnit: new FormControl<BaseUnit>('TABLET', { nonNullable: true }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[\w.-]{0,30}$/)],
    }),
    barcode: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    minStock: new FormControl<number | null>(null, [Validators.min(0), maxDecimals(3)]),
    controlled: new FormControl(false, { nonNullable: true }),
    /** "Es de uso interno (no se vende)": siempre desmarcado, salvo Insumo */
    internal: new FormControl(false, { nonNullable: true }),
    /** Sigue a la categoría (Accesorio no vence); se cambia en "Más datos" */
    tracksExpiry: new FormControl(true, { nonNullable: true }),
    igv: new FormControl<IgvAffectation>('TAXED', { nonNullable: true }),
    sunatUnit: new FormControl('NIU', {
      nonNullable: true,
      validators: [Validators.pattern(/^[A-Z0-9]{2,3}$/)],
    }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    presentations: new FormArray<PresentationForm>([presentationForm('Tableta', 1)]),
    /** Stock inicial (opcional): se guarda junto con el producto */
    stock: new FormGroup({
      quantity: new FormControl<number | null>(null, [Validators.min(0.001), maxDecimals(3)]),
      presentation: new FormControl(0, { nonNullable: true }),
      expiresAt: new FormControl('', { nonNullable: true }),
      lotNumber: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(40)],
      }),
      cost: new FormControl<number | null>(null, [Validators.min(0), maxDecimals(4)]),
    }),
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  protected readonly baseUnit = computed(() => this.value().baseUnit ?? 'TABLET');
  protected readonly category = computed(() => this.value().category ?? null);
  protected readonly unitPlural = computed(() => this.unitLabels[this.baseUnit()][1]);
  protected readonly isMedicine = computed(() => this.category() === 'MEDICINE');
  protected readonly vence = computed(() => this.value().tracksExpiry ?? true);

  /** Nombres de las presentaciones para elegir en qué viene el stock */
  protected readonly presentationNames = computed(() =>
    (this.value().presentations ?? []).map((p, i) => p.name?.trim() || `Presentación ${i + 1}`),
  );

  // ── Stock inicial ──
  protected readonly hasStock = computed(() => !!this.value().stock?.quantity);
  protected readonly needsLot = computed(() =>
    lotRequired(this.category(), this.value().controlled ?? false),
  );
  protected readonly lotHintText = computed(() =>
    lotHint(this.category(), this.value().controlled ?? false),
  );
  protected readonly lotMissingText = computed(() =>
    lotMissingText(this.category(), this.value().controlled ?? false),
  );
  protected readonly stockPreview = computed(() => {
    const s = this.value().stock;
    const pres = this.value().presentations?.[s?.presentation ?? 0];
    if (!s?.quantity || !pres?.factor) return null;
    const units = Math.round(s.quantity * pres.factor * 1000) / 1000;
    if (pres.factor === 1) return null;
    return `= ${formatQty(units)} ${unitLabel(this.baseUnit(), units)}`;
  });
  protected readonly expiryMissing = computed(
    () => this.tried() && this.hasStock() && this.vence() && !this.value().stock?.expiresAt,
  );
  protected readonly lotMissing = computed(
    () =>
      this.tried() && this.hasStock() && this.needsLot() && !this.value().stock?.lotNumber?.trim(),
  );

  // ── Aviso de repetido ──
  protected readonly duplicate = toSignal(
    this.form.controls.name.valueChanges.pipe(
      map((v) => v.trim()),
      debounceTime(350),
      distinctUntilChanged(),
      switchMap((term) =>
        term.length < 3
          ? of(null)
          : this.inventory.list({ q: term, status: 'all' }).pipe(
              map((page) => page.items.find((p) => same(p.name, term)) ?? null),
              catchError(() => of(null)),
            ),
      ),
    ),
    { initialValue: null as ProductSummary | null },
  );
  protected readonly duplicateStock = computed(() => {
    const d = this.duplicate();
    return d ? `${formatQty(d.totalStock)} ${unitLabel(d.baseUnit, d.totalStock)}` : '';
  });

  constructor() {
    if (!this.isAdmin()) this.form.controls.igv.disable();
    // Si la única presentación sigue con el nombre por defecto, se ajusta a la nueva unidad
    this.form.controls.baseUnit.valueChanges.subscribe((unit) => {
      const rows = this.form.controls.presentations.controls;
      const first = rows[0]?.controls.name;
      if (
        first &&
        (!first.value.trim() || Object.values(DEFAULT_PRESENTATION).includes(first.value))
      )
        first.setValue(DEFAULT_PRESENTATION[unit]);
    });
    // La categoría decide: vence o no, uso interno (insumos) y si puede ser controlado
    this.form.controls.category.valueChanges.subscribe((category) => {
      if (!category) return;
      // Al cambiar de categoría manda la categoría (la nota lo muestra; "Cambiar" para casos raros)
      this.form.controls.tracksExpiry.setValue(defaultTracksExpiry(category));
      const internal = this.form.controls.internal;
      if (!internal.dirty) internal.setValue(!defaultChargeable(category));
      if (category !== 'MEDICINE') this.form.controls.controlled.setValue(false);
    });
  }

  /** Casos raros: la categoría dice que vence y este no (o al revés) */
  protected toggleExpiry(): void {
    const c = this.form.controls.tracksExpiry;
    c.setValue(!c.value);
    c.markAsDirty();
  }

  // ── Presentaciones guiadas ──
  protected readonly unitSingular = computed(() => this.unitLabels[this.baseUnit()][0]);
  protected readonly unitSingularCap = computed(() => {
    const u = this.unitSingular();
    return u.charAt(0).toUpperCase() + u.slice(1);
  });
  protected readonly suggestions = computed(() => SUGGESTIONS[this.baseUnit()]);
  protected readonly example = computed(() => EXAMPLES[this.baseUnit()]);
  /** Un insumo con precio de venta no se podría cobrar: se avisa */
  protected readonly money = money;
  /** El costo viene con IGV (precio final) o sin IGV (valor de la factura) */
  protected readonly costWithIgv = signal(true);
  /** "Se guarda sin IGV: S/ 21.19" cuando se escribe con IGV */
  protected readonly costNet = computed(() => {
    const v = this.value();
    const cost = v.stock?.cost;
    if (cost === null || cost === undefined || !this.costWithIgv() || v.igv !== 'TAXED')
      return null;
    return costWithoutIgv(Number(cost), true, 'TAXED');
  });

  protected setInternal(internal: boolean): void {
    const c = this.form.controls.internal;
    c.setValue(internal);
    c.markAsDirty();
  }

  protected readonly supplyWithPrice = computed(
    () => !!this.value().internal && (this.value().presentations ?? []).some((p) => !!p.price),
  );

  /** Qué le falta a una fila (solo lo que está a medias; una fila vacía se quita al guardar) */
  protected rowError(i: number): string | null {
    this.value();
    const row = this.rows[i];
    if (!row) return null;
    const v = row.getRawValue();
    if (row.controls.price.hasError('decimals'))
      return 'El precio admite hasta 2 decimales (ej.: 0.83)';
    if (row.controls.factor.hasError('decimals')) return '«Trae» admite hasta 3 decimales';
    const name = v.name.trim();
    if (i === 0)
      return this.tried() && !name ? `Escribe el nombre (ej.: ${this.unitSingularCap()})` : null;
    const empty = !name && !v.factor && v.price === null;
    if (empty) return null;
    if (v.factor !== null && v.factor <= 0) return '«Trae» debe ser mayor a 0';
    if (!this.tried() && !row.controls.factor.touched && !row.controls.name.touched) return null;
    if (!name) return 'Falta el nombre (ej.: Caja x 100)';
    if (!v.factor) return `Falta cuántas ${this.unitPlural()} trae «${name}»`;
    return null;
  }

  /** "1 Caja x 100 = 100 tabletas · S/ 1.20 cada tableta" (y aviso si sale más caro que suelto) */
  protected rowSummary(i: number): { text: string; warn: string | null } | null {
    this.value();
    const v = this.rows[i]?.getRawValue();
    if (!v?.factor || !v.name.trim()) return null;
    const units = `${formatQty(v.factor)} ${unitLabel(this.baseUnit(), v.factor)}`;
    let text = `1 ${v.name.trim()} = ${units}`;
    let warn: string | null = null;
    if (v.price !== null && v.price > 0) {
      const each = v.price / v.factor;
      text += ` · S/ ${each.toFixed(2)} cada ${this.unitSingular()}`;
      const base = this.rows[0]?.controls.price.value;
      if (base && v.price > base * v.factor + 0.005)
        warn = `Sale más caro que ${units} sueltas (S/ ${(base * v.factor).toFixed(2)}). ¿Es correcto?`;
    }
    return { text, warn };
  }

  protected get rows(): PresentationForm[] {
    return this.form.controls.presentations.controls;
  }

  /** "+ Caja": fila nueva con el nombre puesto; al escribir cuánto trae se arma "Caja x 100" */
  protected addRow(word?: string): void {
    const row = presentationForm(word ?? '', null);
    row.controls.factor.valueChanges.subscribe((factor) => {
      const name = row.controls.name;
      if (!AUTO_NAME.test(name.value.trim())) return;
      const base = name.value.trim().split(/\s+/)[0];
      name.setValue(factor ? `${base} x ${factor}` : base, { emitEvent: true });
    });
    this.form.controls.presentations.push(row);
    const i = this.rows.length - 1;
    setTimeout(() => document.getElementById(word ? `pr-factor-${i}` : `pr-name-${i}`)?.focus());
  }

  /** Las filas extra completamente vacías no cuentan */
  private dropEmptyRows(): void {
    for (let i = this.rows.length - 1; i > 0; i--) {
      const v = this.rows[i].getRawValue();
      if (!v.name.trim() && !v.factor && v.price === null)
        this.form.controls.presentations.removeAt(i);
    }
  }

  protected removeRow(index: number): void {
    if (this.rows.length < 2) return;
    this.form.controls.presentations.removeAt(index);
    const sel = this.form.controls.stock.controls.presentation;
    if (sel.value >= this.rows.length) sel.setValue(0);
  }

  protected invalid(control: { invalid: boolean; touched: boolean }): boolean {
    return control.invalid && control.touched;
  }

  protected submit(): void {
    if (this.saving()) return;
    this.dropEmptyRows();
    this.rows[0]?.controls.factor.setValue(1);
    this.tried.set(true);
    const rowProblem = this.rows.some((_, i) => !!this.rowError(i));
    if (this.form.invalid || rowProblem || this.expiryMissing() || this.lotMissing()) {
      this.form.markAllAsTouched();
      setTimeout(() => document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus());
      return;
    }
    const v = this.form.getRawValue();
    const s = v.stock;
    this.saving.set(true);
    this.inventory
      .create({
        name: v.name.trim(),
        category: v.category as ProductCategory,
        baseUnit: v.baseUnit,
        code: v.code.trim() || null,
        barcode: v.barcode.trim() || null,
        minStock: v.minStock ?? 0,
        requiresPrescription: v.controlled,
        controlled: v.controlled,
        chargeable: !v.internal,
        tracksExpiry: v.tracksExpiry,
        igv: v.igv,
        sunatUnit: v.sunatUnit,
        notes: v.notes.trim() || null,
        presentations: v.presentations.map((p) => ({
          name: p.name.trim(),
          factor: Number(p.factor),
          price: p.price === null ? null : Number(p.price),
        })),
        initialStock: s.quantity
          ? {
              presentationIndex: s.presentation,
              quantity: Number(s.quantity),
              lotNumber: s.lotNumber.trim() || null,
              expiresAt: v.tracksExpiry ? s.expiresAt || null : null,
              costPerPresentation: costWithoutIgv(
                s.cost === null ? null : Number(s.cost),
                this.costWithIgv(),
                v.igv,
              ),
            }
          : null,
      })
      .subscribe({
        next: (product) => {
          const stock = product.totalStock
            ? `${formatQty(product.totalStock)} ${unitLabel(product.baseUnit, product.totalStock)}`
            : null;
          this.added.update((list) => [{ id: product.id, name: product.name, stock }, ...list]);
          this.toast.success(
            stock ? `${product.name} agregado con ${stock}.` : `${product.name} agregado.`,
          );
          this.resetForNext();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  /** Limpia para el siguiente producto; se quedan la categoría y la unidad (suelen cargar parecidos) */
  private resetForNext(): void {
    const v = this.form.getRawValue();
    this.form.controls.presentations.clear();
    this.form.controls.presentations.push(presentationForm(DEFAULT_PRESENTATION[v.baseUnit], 1));
    this.form.reset({
      name: '',
      category: v.category,
      baseUnit: v.baseUnit,
      code: '',
      barcode: '',
      minStock: null,
      controlled: false,
      internal: v.category ? !defaultChargeable(v.category) : false,
      tracksExpiry: v.category ? defaultTracksExpiry(v.category) : true,
      igv: 'TAXED',
      sunatUnit: 'NIU',
      notes: '',
      presentations: [{ name: DEFAULT_PRESENTATION[v.baseUnit], factor: 1, price: null }],
      stock: { quantity: null, presentation: 0, expiresAt: '', lotNumber: '', cost: null },
    });
    this.tried.set(false);
    this.saving.set(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('p-name')?.focus());
  }
}
