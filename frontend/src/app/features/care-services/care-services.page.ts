import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { CareServicesService } from '../../core/services/care-services.service';
import {
  BaseUnit,
  CareService,
  CareServiceCategory,
  CareServiceInput,
  IGV_LABELS,
  IgvAffectation,
  ProductSummary,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
} from '../../core/services/inventory.models';
import {
  PET_SIZES,
  PET_SIZE_HINTS,
  PET_SIZE_LABELS,
  PetSize,
} from '../../core/services/grooming.models';
import { InventoryService } from '../../core/services/inventory.service';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, money, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { loaded } from '../../shared/utils/resource';

type SupplyGroup = FormGroup<{
  productId: FormControl<number>;
  name: FormControl<string>;
  baseUnit: FormControl<BaseUnit>;
  quantity: FormControl<number | null>;
  /** Último costo sin IGV por unidad mínima (solo para mostrar; no se envía) */
  unitCost: FormControl<number | null>;
}>;

const MAX_SUPPLIES = 20;
const PRICE = /^\d+(\.\d{1,2})?$/;
const sizePrice = () =>
  new FormControl<number | null>(null, [
    Validators.min(0),
    Validators.max(99_999),
    Validators.pattern(PRICE),
  ]);

/**
 * Catálogo de servicios (consulta, vacunación, cirugías…) con su precio y los insumos
 * que descuentan del inventario. Todos lo consultan; solo el administrador lo edita.
 */
/** Dónde aparece cada categoría: la categoría decide en qué pantallas se puede cobrar */
const CATEGORY_WHERE: Record<CareServiceCategory, string> = {
  CONSULTATION: 'Aparece en la Atención, la Caja y los Presupuestos.',
  VACCINATION: 'Aparece en la Atención, la Caja y los Presupuestos.',
  DEWORMING: 'Aparece en la Atención, la Caja y los Presupuestos.',
  SURGERY: 'Aparece en la Atención, la Caja y los Presupuestos.',
  OTHER: 'Aparece en la Atención, la Caja y los Presupuestos.',
  LAB: 'Aparece en Exámenes al pedir un análisis, y también en la Atención y la Caja.',
  GROOMING:
    'Aparece solo en Grooming, al ingresar la mascota al tablero (con precio por tamaño). No sale en la Atención ni en la Caja.',
  HOSPITALIZATION:
    'Aparece al dar de alta en Hospitalización, como cobro por día de estadía; también en la Atención.',
};
const CATEGORY_SHORT: Record<CareServiceCategory, string> = {
  CONSULTATION: 'Atención, Caja y Presupuestos',
  VACCINATION: 'Atención, Caja y Presupuestos',
  DEWORMING: 'Atención, Caja y Presupuestos',
  SURGERY: 'Atención, Caja y Presupuestos',
  OTHER: 'Atención, Caja y Presupuestos',
  LAB: 'Exámenes y Atención',
  GROOMING: 'Solo en Grooming',
  HOSPITALIZATION: 'Alta de hospitalización',
};
/** Sin al menos uno activo de estas, una pantalla se queda sin qué cobrar */
const NEEDED: { category: CareServiceCategory; problem: string }[] = [
  {
    category: 'HOSPITALIZATION',
    problem: 'al dar de alta un internado no podrás cobrar la estadía.',
  },
  { category: 'LAB', problem: 'en Exámenes no habrá análisis para pedir.' },
  { category: 'GROOMING', problem: 'no podrás ingresar mascotas al tablero de Grooming.' },
];

@Component({
  selector: 'app-care-services-page',
  imports: [ReactiveFormsModule, IconComponent, BadgeComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './care-services.page.html',
})
export class CareServicesPage {
  private readonly services = inject(CareServicesService);
  private readonly inventory = inject(InventoryService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly categories = SERVICE_CATEGORIES;
  protected readonly categoryLabels = SERVICE_CATEGORY_LABELS;
  protected readonly igvLabels = IGV_LABELS;
  protected readonly igvTypes = Object.keys(IGV_LABELS) as IgvAffectation[];
  protected readonly money = money;
  protected readonly isAdmin = this.session.isAdmin;
  protected readonly sizes = PET_SIZES;
  protected readonly sizeLabels = PET_SIZE_LABELS;
  protected readonly sizeHints = PET_SIZE_HINTS;
  protected readonly where = CATEGORY_WHERE;
  protected readonly whereShort = CATEGORY_SHORT;

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly showInactive = new FormControl(false, { nonNullable: true });
  private readonly term = toSignal(this.search.valueChanges.pipe(map(normalize)), {
    initialValue: '',
  });
  private readonly withInactive = toSignal(this.showInactive.valueChanges, {
    initialValue: false,
  });

  /** Se pide todo una vez; filtrar y agrupar es local (un catálogo tiene decenas de servicios). */
  protected readonly catalog = rxResource({
    stream: () => this.services.list('all'),
  });
  private readonly items = signal<CareService[] | null>(null);
  private readonly catalogList = loaded(this.catalog);
  protected readonly all = computed(() => this.items() ?? this.catalogList() ?? []);
  protected readonly inactiveCount = computed(() => this.all().filter((s) => !s.active).length);
  /** Categorías clave sin ningún servicio activo (solo cuando el catálogo ya cargó) */
  protected readonly missing = computed(() => {
    const list = this.all();
    if (!list.length) return [];
    return NEEDED.filter((n) => !list.some((s) => s.active && s.category === n.category));
  });

  protected readonly groups = computed(() => {
    const term = this.term();
    const visible = this.all().filter(
      (s) =>
        (this.withInactive() || s.active) &&
        (!term ||
          normalize(s.name).includes(term) ||
          s.supplies.some((x) => normalize(x.name).includes(term))),
    );
    return this.categories
      .map((category) => ({
        category,
        items: visible
          .filter((s) => s.category === category)
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      }))
      .filter((g) => g.items.length > 0);
  });

  // ── Modal ──
  protected readonly open = signal(false);
  protected readonly editing = signal<CareService | null>(null);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    category: this.fb.control<CareServiceCategory | ''>('', Validators.required),
    price: this.fb.control<number | null>(null, [
      Validators.required,
      Validators.min(0),
      Validators.max(999_999),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
    igv: this.fb.control<IgvAffectation>('TAXED'),
    durationMin: this.fb.control<number | null>(null, [
      Validators.min(1),
      Validators.max(1440),
      Validators.pattern(/^\d+$/),
    ]),
    active: [true],
    supplies: this.fb.array<SupplyGroup>([]),
    /** Solo baño y grooming: precio por tamaño (vacío = precio base) */
    sizePrices: new FormGroup({
      SMALL: sizePrice(),
      MEDIUM: sizePrice(),
      LARGE: sizePrice(),
      GIANT: sizePrice(),
    }),
  });

  /** Buscador de insumos: productos activos del inventario. */
  protected readonly supplySearch = new FormControl('', { nonNullable: true });
  protected readonly supplyResults = toSignal(
    this.supplySearch.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<ProductSummary[]>([])
          : this.inventory.list({ q }).pipe(map((page) => page.items.slice(0, 6))),
      ),
    ),
    { initialValue: [] as ProductSummary[] },
  );

  /** Cuánto cuestan los insumos frente al precio sin IGV: ayuda a ver si el precio cubre lo que se gasta */
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  protected readonly supplyCost = computed(() => {
    const v = this.formValue();
    let total = 0;
    let counted = 0;
    const missing: string[] = [];
    for (const s of v.supplies ?? []) {
      const qty = Number(s.quantity);
      if (!(qty > 0)) continue;
      if (s.unitCost === null || s.unitCost === undefined) missing.push(s.name ?? '');
      else {
        total += s.unitCost * qty;
        counted++;
      }
    }
    const price = Number(v.price);
    if (!counted && !missing.length) return null;
    const base =
      v.price === null || Number.isNaN(price) ? null : v.igv === 'TAXED' ? price / 1.18 : price;
    return {
      total,
      missing,
      base,
      margin: base === null ? null : base - total,
      percent: base ? Math.round(((base - total) / base) * 100) : null,
    };
  });

  /** El precio incluye IGV: cuánto es sin IGV y cuánto el impuesto, mientras se escribe */
  protected readonly priceBreakdown = computed(() => {
    const v = this.formValue();
    const price = Number(v.price);
    if (v.price === null || v.price === undefined || !(price > 0)) return null;
    if (v.igv !== 'TAXED') return { base: price, igv: 0 };
    const base = Math.round((price / 1.18) * 100) / 100;
    return { base, igv: Math.round((price - base) * 100) / 100 };
  });

  /** Se está desactivando un servicio que está en presupuestos pendientes */
  protected readonly quotedWarning = computed(() => {
    const s = this.editing();
    const v = this.formValue();
    return s && s.active && v.active === false ? (s.pendingEstimates ?? 0) : 0;
  });

  protected supplyCostOf(group: SupplyGroup): number | null {
    const cost = group.controls.unitCost.value;
    const qty = Number(group.controls.quantity.value);
    return cost === null || !(qty > 0) ? null : cost * qty;
  }

  protected get supplies(): FormArray<SupplyGroup> {
    return this.form.controls.supplies;
  }

  protected supplyLine(s: CareService['supplies'][number]): string {
    return `${s.name} · ${formatQty(s.quantity)} ${unitLabel(s.baseUnit, s.quantity)}`;
  }

  protected unitFor(group: SupplyGroup): string {
    const qty = group.controls.quantity.value ?? 0;
    return unitLabel(group.controls.baseUnit.value, qty);
  }

  /** "P S/ 40 · M S/ 55 · G S/ 70" para la lista */
  protected sizeLine(s: CareService): string | null {
    if (!s.sizePrices.length) return null;
    return PET_SIZES.map((size) => {
      const price = s.sizePrices.find((p) => p.size === size)?.price ?? s.price;
      return `${PET_SIZE_LABELS[size]} ${money(price)}`;
    }).join(' · ');
  }

  protected durationText(min: number | null): string | null {
    if (!min) return null;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  protected openNew(category?: CareServiceCategory): void {
    this.editing.set(null);
    this.resetForm({
      name: '',
      category: category ?? '',
      price: null,
      igv: 'TAXED',
      durationMin: null,
      active: true,
      supplies: [],
      sizePrices: [],
    });
  }

  protected openEdit(service: CareService): void {
    this.editing.set(service);
    this.resetForm({
      name: service.name,
      category: service.category,
      price: service.price,
      igv: service.igv,
      durationMin: service.durationMin,
      active: service.active,
      supplies: service.supplies,
      sizePrices: service.sizePrices,
    });
  }

  protected close(): void {
    if (!this.saving()) this.open.set(false);
  }

  protected addSupply(product: ProductSummary): void {
    this.supplySearch.setValue('');
    if (this.supplies.length >= MAX_SUPPLIES) {
      this.toast.error(`Máximo ${MAX_SUPPLIES} insumos por servicio.`);
      return;
    }
    const existing = this.supplies.controls.findIndex(
      (g) => g.controls.productId.value === product.id,
    );
    if (existing >= 0) {
      this.focusSupply(existing);
      return;
    }
    this.supplies.push(
      this.supplyGroup(product.id, product.name, product.baseUnit, null, product.unitCost ?? null),
    );
    this.focusSupply(this.supplies.length - 1);
  }

  protected removeSupply(index: number): void {
    this.supplies.removeAt(index);
  }

  protected invalid(control: { invalid: boolean; touched: boolean }): boolean {
    return control.invalid && control.touched;
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      setTimeout(() =>
        document.querySelector<HTMLElement>('dialog[open] [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const v = this.form.getRawValue();
    const body: CareServiceInput = {
      name: v.name.trim(),
      category: v.category as CareServiceCategory,
      price: Number(v.price),
      igv: v.igv,
      durationMin: v.durationMin ? Number(v.durationMin) : null,
      supplies: v.supplies.map((s) => ({ productId: s.productId, quantity: Number(s.quantity) })),
      sizePrices:
        v.category === 'GROOMING'
          ? PET_SIZES.flatMap((size) => {
              const price = v.sizePrices[size];
              return price === null || (price as unknown) === ''
                ? []
                : [{ size, price: Number(price) }];
            })
          : [],
    };
    const current = this.editing();
    const request = current
      ? this.services.update(current.id, { ...body, active: v.active })
      : this.services.create(body);

    this.saving.set(true);
    request.subscribe({
      next: (saved) => {
        const list = this.all();
        this.items.set(
          current ? list.map((s) => (s.id === saved.id ? saved : s)) : [...list, saved],
        );
        this.saving.set(false);
        this.open.set(false);
        this.toast.success(current ? 'Servicio actualizado.' : 'Servicio creado.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error, 'No se pudo guardar el servicio.'));
      },
    });
  }

  private resetForm(value: {
    name: string;
    category: CareServiceCategory | '';
    price: number | null;
    igv: IgvAffectation;
    durationMin: number | null;
    active: boolean;
    supplies: CareService['supplies'];
    sizePrices: CareService['sizePrices'];
  }): void {
    this.supplies.clear();
    for (const s of value.supplies)
      this.supplies.push(
        this.supplyGroup(s.productId, s.name, s.baseUnit, s.quantity, s.unitCost ?? null),
      );
    const { supplies: _, sizePrices, ...rest } = value;
    const bySize = Object.fromEntries(
      PET_SIZES.map((size) => [size, sizePrices.find((p) => p.size === size)?.price ?? null]),
    ) as Record<PetSize, number | null>;
    this.form.reset({ ...rest, supplies: this.supplies.getRawValue(), sizePrices: bySize });
    this.supplySearch.setValue('');
    this.open.set(true);
  }

  private supplyGroup(
    productId: number,
    name: string,
    baseUnit: BaseUnit,
    quantity: number | null,
    unitCost: number | null,
  ): SupplyGroup {
    return this.fb.group({
      productId: [productId],
      name: [name],
      baseUnit: this.fb.control<BaseUnit>(baseUnit),
      quantity: this.fb.control<number | null>(quantity, [
        Validators.required,
        Validators.min(0.001),
        Validators.pattern(/^\d+(\.\d{1,3})?$/),
      ]),
      unitCost: this.fb.control<number | null>(unitCost),
    });
  }

  private focusSupply(index: number): void {
    setTimeout(() => document.getElementById(`sup-qty-${index}`)?.focus());
  }
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
