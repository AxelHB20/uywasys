import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, of } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  DOC_TYPE_LABELS,
  PurchaseStatus,
  PurchaseSummary,
} from '../../core/services/purchases.models';
import { PurchasesService } from '../../core/services/purchases.service';
import { reportRange } from '../../core/services/reports.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { saveBlob } from '../../shared/utils/download';
import { loaded } from '../../shared/utils/resource';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { InventoryTabsComponent } from '../inventory/inventory-tabs.component';

type Period = 'month' | 'lastMonth' | 'last90' | 'year' | 'all';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'last90', label: 'Últimos 90 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
  { value: 'year', label: 'Este año' },
  { value: 'all', label: 'Todo el historial' },
];
/** Lo reciente sin cortar en el día 1 del mes (a inicio de mes "Este mes" sale vacío) */
const DEFAULT_PERIOD: Period = 'last90';
const STATUS_PARAM: Record<PurchaseStatus, string> = { RECEIVED: 'recibidas', VOIDED: 'anuladas' };

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Compras: las fichas de proveedor registradas, con su total y de quién fueron. */
@Component({
  selector: 'app-purchases-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, InventoryTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './purchases.page.html',
})
export class PurchasesPage {
  private readonly api = inject(PurchasesService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly periods = PERIODS;
  protected readonly docLabels = DOC_TYPE_LABELS;
  protected readonly money = money;
  protected readonly isAdmin = computed(() => this.session.role() === 'ADMIN');
  private readonly today = limaToday();

  protected readonly search = new FormControl(this.url.get('q') ?? '', { nonNullable: true });
  protected readonly q = signal(this.search.value.trim());
  protected readonly period = signal<Period>(
    PERIODS.find((p) => p.value === this.url.get('periodo'))?.value ?? DEFAULT_PERIOD,
  );
  protected readonly supplierId = signal<number | null>(Number(this.url.get('proveedor')) || null);
  protected readonly status = signal<PurchaseStatus | null>(
    (Object.keys(STATUS_PARAM) as PurchaseStatus[]).find(
      (k) => STATUS_PARAM[k] === this.url.get('estado'),
    ) ?? null,
  );
  protected readonly page = signal(Math.max(1, Number(this.url.get('pagina')) || 1));
  protected readonly downloading = signal(false);

  protected readonly range = computed(() => this.rangeOf(this.period()));

  protected readonly suppliersRes = rxResource({
    stream: () => this.api.suppliers({ all: true }).pipe(catchError(() => of([]))),
  });
  protected readonly suppliers = computed(() => loaded(this.suppliersRes)() ?? []);

  protected readonly list = rxResource({
    params: () => ({
      q: this.q() || undefined,
      supplierId: this.supplierId() ?? undefined,
      status: this.status() ?? undefined,
      ...this.range(),
      page: this.page(),
    }),
    stream: ({ params }) => this.api.list(params),
  });
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  protected readonly data = loaded(this.list);
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly summary = computed(() => this.data()?.summary ?? null);
  protected readonly pages = computed(() => {
    const v = this.data();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });
  protected readonly rangeText = computed(() => {
    const v = this.data();
    if (!v?.total) return '';
    const from = (v.page - 1) * v.pageSize + 1;
    const to = Math.min(v.total, from + v.items.length - 1);
    return `Mostrando ${from}–${to} de ${v.total} ${v.total === 1 ? 'compra' : 'compras'}`;
  });
  protected readonly filtered = computed(
    () => !!this.q() || !!this.supplierId() || !!this.status() || this.period() !== DEFAULT_PERIOD,
  );

  constructor() {
    this.search.valueChanges
      .pipe(
        map((v) => v.trim()),
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((q) => {
        this.q.set(q);
        this.page.set(1);
      });

    effect(() => {
      const status = this.status();
      const queryParams = {
        q: this.q() || null,
        periodo: this.period() === DEFAULT_PERIOD ? null : this.period(),
        proveedor: this.supplierId(),
        estado: status ? STATUS_PARAM[status] : null,
        pagina: this.page() > 1 ? this.page() : null,
      };
      untracked(() => this.router.navigate([], { queryParams, replaceUrl: true }));
    });
  }

  protected setPeriod(value: string): void {
    this.period.set((PERIODS.find((p) => p.value === value)?.value ?? DEFAULT_PERIOD) as Period);
    this.page.set(1);
  }

  protected setSupplier(value: string): void {
    this.supplierId.set(Number(value) || null);
    this.page.set(1);
  }

  protected setStatus(value: string): void {
    this.status.set(value === 'RECEIVED' || value === 'VOIDED' ? value : null);
    this.page.set(1);
  }

  protected clear(): void {
    this.search.setValue('', { emitEvent: false });
    this.q.set('');
    this.supplierId.set(null);
    this.status.set(null);
    this.period.set(DEFAULT_PERIOD);
    this.page.set(1);
  }

  protected docText(p: PurchaseSummary): string {
    return `${this.docLabels[p.docType]} ${p.docNumber}`;
  }

  protected date(day: string): string {
    return formatDate(day, 'calendar');
  }

  protected rowLabel(p: PurchaseSummary): string {
    return [
      `Compra ${p.code}`,
      this.docText(p),
      p.supplier.name,
      `del ${this.date(p.issuedAt)}`,
      `${p.lines} ${p.lines === 1 ? 'producto' : 'productos'}`,
      `total ${money(p.total)}`,
      p.status === 'VOIDED' ? 'anulada' : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** Registro de compras del período para el contador (solo el administrador) */
  protected downloadExcel(): void {
    const { from, to } = this.range();
    const start = from ?? '2000-01-01';
    const end = to ?? this.today;
    this.downloading.set(true);
    this.api
      .excel(start, end)
      .pipe(finalize(() => this.downloading.set(false)))
      .subscribe({
        next: (blob) => saveBlob(blob, `compras-${start}-a-${end}.xlsx`),
        error: (error) => this.toast.error(apiErrorMessage(error, 'No se pudo generar el Excel')),
      });
  }

  private rangeOf(period: Period): { from?: string; to?: string } {
    if (period === 'all') return {};
    if (period === 'last90') return { from: addDays(this.today, -89), to: this.today };
    return reportRange(period, this.today);
  }
}
