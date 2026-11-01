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

type SupplyGroup = FormGroup<{
  productId: FormControl<number>;
  name: FormControl<string>;
  baseUnit: FormControl<BaseUnit>;
  quantity: FormControl<number | null>;
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
  protected readonly all = computed(() => this.items() ?? this.catalog.value() ?? []);
  protected readonly inactiveCount = computed(() => this.all().filter((s) => !s.active).length);

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
    this.supplies.push(this.supplyGroup(product.id, product.name, product.baseUnit, null));
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
      this.supplies.push(this.supplyGroup(s.productId, s.name, s.baseUnit, s.quantity));
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
    });
  }

  private focusSupply(index: number): void {
    setTimeout(() => document.getElementById(`sup-qty-${index}`)?.focus());
  }
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
