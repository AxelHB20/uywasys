import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  Signal,
} from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
  Observable,
} from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  CATEGORIES,
  CATEGORY_ICON,
  CATEGORY_LABELS,
  CATEGORY_TINT,
  ProductCategory,
  ProductPage,
  ProductSummary,
  STOCK_ROLES,
  StockFilter,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import {
  baseTotal,
  EXPIRY_BADGE,
  expiryText,
  money,
  readableStock,
} from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { InventoryTabsComponent } from './inventory-tabs.component';
import { ShortagesPanelComponent } from './shortages-panel.component';

type LoadState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: ProductPage };

const FILTERS: StockFilter[] = ['low', 'expiring', 'expired', 'exp30', 'exp60'];

@Component({
  selector: 'app-inventory-page',
  imports: [
    FechaPipe,
    InventoryTabsComponent,
    ShortagesPanelComponent,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.page.html',
})
export class InventoryPage {
  private readonly inventory = inject(InventoryService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);

  /** Query params: ?q=&categoria=&filtro=&estado=&page= */
  readonly q = input<string>();
  readonly estado = input<string>();
  readonly categoria = input<string>();
  readonly filtro = input<string>();
  readonly page = input<string>();

  protected readonly categories = CATEGORIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly expiryBadge = EXPIRY_BADGE;
  protected readonly expiryText = expiryText;
  protected readonly money = money;
  protected readonly categoryIcon = CATEGORY_ICON;
  protected readonly categoryTint = CATEGORY_TINT;
  protected readonly canManage = computed(() =>
    STOCK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
  protected readonly isAdmin = computed(() => this.session.role() === 'ADMIN');

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly category = new FormControl<ProductCategory | ''>('', { nonNullable: true });
  private readonly retry = signal(0);

  private readonly query = computed(() => ({
    q: (this.q() ?? '').trim(),
    category: (CATEGORIES as string[]).includes(this.categoria() ?? '')
      ? (this.categoria() as ProductCategory)
      : null,
    filter: (FILTERS.includes(this.filtro() as StockFilter) ? this.filtro() : 'all') as StockFilter,
    // Inactivos solo para quien gestiona el inventario
    status: (this.canManage() && (this.estado() === 'inactivos' || this.estado() === 'todos')
      ? { inactivos: 'inactive', todos: 'all' }[this.estado()!]
      : 'active') as 'active' | 'inactive' | 'all',
    page: Math.max(1, Number(this.page()) || 1),
    retry: this.retry(),
  }));
  protected readonly filter = computed(() => this.query().filter);
  protected readonly status = computed(() => this.query().status);
  protected readonly filterLabels: Record<StockFilter, string> = {
    all: '',
    low: 'Stock bajo',
    expiring: 'Por vencer (60 días) o vencidos',
    expired: 'Lotes vencidos',
    exp30: 'Vencen en 30 días',
    exp60: 'Vencen en 31 a 60 días',
  };

  protected readonly state: Signal<LoadState> = toSignal(
    toObservable(this.query).pipe(
      switchMap((query): Observable<LoadState> => {
        const request = this.inventory.list(query).pipe(
          map((data): LoadState => ({ kind: 'ready', data })),
          catchError((error: unknown) =>
            of<LoadState>({
              kind: 'error',
              message: apiErrorMessage(error, 'No se pudo cargar el inventario.'),
            }),
          ),
        );
        // Solo la primera vez se muestra "cargando": al filtrar, la lista anterior se queda hasta
        // que llega la nueva (la página no se achica ni salta arriba)
        return this.state?.().kind === 'ready'
          ? request
          : request.pipe(startWith<LoadState>({ kind: 'loading' }));
      }),
    ),
    { initialValue: { kind: 'loading' } as LoadState },
  );

  protected readonly alerts = rxResource({ stream: () => this.inventory.alerts() });
  /** Productos activos sin stock (aviso "Cargar stock"); solo quien maneja el inventario */
  private readonly pending = rxResource({
    params: () => (this.canManage() ? true : undefined),
    stream: () => this.inventory.pendingStock(),
  });
  protected readonly pendingStock = computed(() =>
    this.pending.hasValue() ? (this.pending.value()?.total ?? 0) : 0,
  );
  protected readonly alertData = computed(() =>
    this.alerts.hasValue() ? this.alerts.value() : null,
  );

  protected readonly alertCards = computed(() => {
    const a = this.alertData();
    const cards: {
      label: string;
      value: number | null;
      filter: StockFilter;
      icon: IconName;
      tint: string;
    }[] = [
      {
        label: 'Lotes vencidos',
        value: a?.expired ?? null,
        filter: 'expired',
        icon: 'alert',
        tint: 'bg-rose-50 text-rose-700',
      },
      {
        label: 'Vencen en 30 días',
        value: a?.red ?? null,
        filter: 'exp30',
        icon: 'clock',
        tint: 'bg-rose-50 text-rose-700',
      },
      {
        label: 'Vencen en 31 a 60 días',
        value: a?.yellow ?? null,
        filter: 'exp60',
        icon: 'clock',
        tint: 'bg-maiz-100 text-amber-800',
      },
      {
        label: 'Con stock bajo',
        value: a?.lowStock ?? null,
        filter: 'low',
        icon: 'package',
        tint: 'bg-anil-50 text-anil-700',
      },
    ];
    return cards;
  });

  protected readonly range = computed(() => {
    const s = this.state();
    if (s.kind !== 'ready' || s.data.total === 0) return null;
    const from = (s.data.page - 1) * s.data.pageSize + 1;
    return { from, to: from + s.data.items.length - 1, total: s.data.total };
  });
  protected readonly hasNext = computed(() => {
    const s = this.state();
    return s.kind === 'ready' && s.data.page * s.data.pageSize < s.data.total;
  });
  protected readonly filtering = computed(
    () =>
      !!this.query().q ||
      !!this.query().category ||
      this.query().filter !== 'all' ||
      this.query().status !== 'active',
  );

  constructor() {
    effect(() => {
      const { q, category } = this.query();
      if (this.search.value !== q) this.search.setValue(q, { emitEvent: false });
      if (this.category.value !== (category ?? ''))
        this.category.setValue(category ?? '', { emitEvent: false });
    });
    this.search.valueChanges
      .pipe(
        map((v) => v.trim()),
        debounceTime(300),
        distinctUntilChanged(),
      )
      .subscribe((q) => this.navigate({ q: q || null, page: null }));
    this.category.valueChanges.subscribe((c) =>
      this.navigate({ categoria: c || null, page: null }),
    );
  }

  protected setStatus(value: string): void {
    this.navigate({
      estado: value === 'inactive' ? 'inactivos' : value === 'all' ? 'todos' : null,
      page: null,
    });
  }

  protected setFilter(filter: StockFilter): void {
    this.navigate({ filtro: filter === 'all' ? null : filter, page: null });
  }

  protected goTo(page: number): void {
    this.navigate({ page: page > 1 ? page : null });
    window.scrollTo?.({ top: 0 });
  }

  protected reload(): void {
    this.retry.update((n) => n + 1);
  }

  protected clear(): void {
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  protected stock(p: ProductSummary): string {
    return readableStock(p.totalStock, p.baseUnit, p.presentations);
  }

  /** "200 tabletas" debajo de "2 cajas" (null si ya está en la unidad mínima) */
  protected total(p: ProductSummary): string | null {
    return baseTotal(p.totalStock, p.baseUnit, p.presentations);
  }

  /** Precio de la presentación más chica: lo que se vende suelto */
  protected cheapest(p: ProductSummary): { price: number; name: string } | null {
    const smallest = [...p.presentations]
      .filter((x) => x.price !== null)
      .sort((a, b) => a.factor - b.factor)[0];
    return smallest ? { price: smallest.price!, name: smallest.name } : null;
  }

  private navigate(params: Record<string, string | number | null>): void {
    this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
