import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, map, merge } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  CUSTOMER_DOC_LABELS,
  DOC_TYPE_LABELS,
  DocumentFilters,
  DocumentSummary,
  DocumentType,
  statusLabel,
} from '../../core/services/billing.models';
import { BillingService } from '../../core/services/billing.service';
import { ReportPreset, reportRange } from '../../core/services/reports.models';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { limaDate } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { loaded } from '../../shared/utils/resource';
import { apiErrorMessage } from '../../shared/utils/validators';
import {
  BuyerFieldsComponent,
  buyerForm,
  buyerPayload,
} from '../../shared/ui/buyer-fields/buyer-fields.component';

type StatusFilter = NonNullable<DocumentFilters['status']>;

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null;
const isDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
type Period = Extract<ReportPreset, 'today' | 'last7' | 'month' | 'lastMonth'> | 'all' | 'custom';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'last7', label: '7 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
  { value: 'all', label: 'Todo' },
  { value: 'custom', label: 'Fechas' },
];

/** Cómo se ve cada comprobante en la lista: color del tipo y estado en palabras (nunca solo color) */
export type RowState =
  'ok' | 'simulated' | 'annulled' | 'pending' | 'sent' | 'error' | 'rejected' | 'replaced';
type MenuAction = 'pdf' | 'factura' | 'void';

const STATE_STYLE: Record<RowState, { label: string; chip: string; dot: string }> = {
  ok: {
    label: 'Aceptado',
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  // Gris: no es "Aceptado por SUNAT" (el verde es solo para lo válido)
  simulated: {
    label: 'Simulado',
    chip: 'bg-slate-50 text-slate-700 ring-slate-300',
    dot: 'bg-slate-400',
  },
  annulled: {
    label: 'Anulado',
    chip: 'bg-slate-100 text-slate-700 ring-slate-300',
    dot: 'bg-slate-500',
  },
  pending: {
    label: 'Por enviar',
    chip: 'bg-slate-50 text-slate-700 ring-slate-200',
    dot: 'bg-slate-400',
  },
  sent: {
    label: 'Esperando a SUNAT',
    chip: 'bg-sky-50 text-sky-800 ring-sky-200',
    dot: 'bg-sky-500',
  },
  error: {
    label: 'Error de envío',
    chip: 'bg-amber-50 text-amber-900 ring-amber-200',
    dot: 'bg-amber-500',
  },
  rejected: {
    label: 'Rechazado',
    chip: 'bg-rose-50 text-rose-800 ring-rose-200',
    dot: 'bg-rose-500',
  },
  replaced: {
    label: 'Rechazado · corregido',
    chip: 'bg-slate-100 text-slate-700 ring-slate-300',
    dot: 'bg-slate-500',
  },
};

const TYPE_STYLE: Record<DocumentType, string> = {
  BOLETA: 'bg-anil-50 text-anil-800',
  FACTURA: 'bg-violet-50 text-violet-800',
  CREDIT_NOTE: 'bg-rose-50 text-rose-800',
};

/** Boletas, facturas y notas de crédito: su estado ante SUNAT, anulaciones, reintentos y el Excel del contador. */
@Component({
  host: {
    '(document:click)': 'onDocClick($event)',
    '(document:keydown.escape)': 'closeMenu()',
  },
  selector: 'app-documents-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    FechaPipe,
    IconComponent,
    ModalComponent,
    BuyerFieldsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents.page.html',
})
export class DocumentsPage {
  private readonly billing = inject(BillingService);
  private readonly toast = inject(ToastService);
  protected readonly isAdmin = inject(SessionService).isAdmin;
  protected readonly isSupport = inject(SessionService).isSupport;

  /** ?estado=PROBLEMS (desde la campana) */
  readonly estado = input<string>();

  protected readonly money = money;
  protected readonly typeLabels = DOC_TYPE_LABELS;
  protected readonly typeStyle = TYPE_STYLE;
  protected readonly stateStyle = STATE_STYLE;
  protected readonly customerDoc = CUSTOMER_DOC_LABELS;
  protected readonly periods = PERIODS;
  protected readonly typeTabs: { value: DocumentType | null; label: string }[] = [
    { value: null, label: 'Todos' },
    { value: 'BOLETA', label: 'Boletas' },
    { value: 'FACTURA', label: 'Facturas' },
    { value: 'CREDIT_NOTE', label: 'Notas de crédito' },
  ];
  protected readonly statuses: [StatusFilter, string][] = [
    ['ACCEPTED', 'Vigentes'],
    ['ANNULLED', 'Anulados'],
    ['PROBLEMS', 'Con problemas'],
    ['LATE', 'Sin aceptar hace más de 1 día'],
    ['PENDING', 'Por enviar'],
    ['SENT', 'Esperando a SUNAT'],
  ];

  private readonly router = inject(Router);
  private readonly today = limaDate(new Date());
  /** Los filtros viven en la dirección: al volver de un ticket o una nota, la lista sigue igual */
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly filters = new FormGroup({
    q: new FormControl(this.url.get('q') ?? '', { nonNullable: true }),
    type: new FormControl<DocumentType | null>(
      oneOf(this.url.get('tipo'), ['BOLETA', 'FACTURA', 'CREDIT_NOTE'] as const),
    ),
    status: new FormControl<StatusFilter | null>(
      oneOf(this.url.get('estado'), [
        'ACCEPTED',
        'ANNULLED',
        'PROBLEMS',
        'LATE',
        'PENDING',
        'SENT',
      ] as const),
    ),
    period: new FormControl<Period>(
      oneOf(
        this.url.get('periodo'),
        PERIODS.map((p) => p.value),
      ) ?? 'month',
      { nonNullable: true },
    ),
    from: new FormControl<string | null>(isDay(this.url.get('desde'))),
    to: new FormControl<string | null>(isDay(this.url.get('hasta'))),
  });
  protected readonly page = signal(Math.max(1, Number(this.url.get('pagina')) || 1));
  private readonly values = toSignal(
    merge(
      this.filters.controls.q.valueChanges.pipe(debounceTime(300)),
      this.filters.controls.type.valueChanges,
      this.filters.controls.status.valueChanges,
      this.filters.controls.period.valueChanges,
      this.filters.controls.from.valueChanges,
      this.filters.controls.to.valueChanges,
    ).pipe(
      map(() => this.filters.getRawValue()),
      // Un cambio de varios campos a la vez (o la búsqueda que llega después) consulta una sola vez
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      map((v) => {
        this.page.set(1);
        return v;
      }),
    ),
    { initialValue: this.filters.getRawValue() },
  );

  /** El rango que se consulta según el periodo elegido */
  protected readonly range = computed(() => {
    const v = this.values();
    if (v.period === 'all') return { from: null, to: null };
    if (v.period === 'custom') return { from: v.from || null, to: v.to || null };
    return reportRange(v.period, this.today);
  });

  protected readonly status = rxResource({ stream: () => this.billing.status() });
  protected readonly list = rxResource({
    params: () => {
      const v = this.values();
      return { q: v.q, type: v.type, status: v.status, ...this.range(), page: this.page() };
    },
    stream: ({ params }) => this.billing.documents(params),
  });
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  protected readonly data = loaded(this.list);
  protected readonly sunat = loaded(this.status);
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly summary = computed(() => this.data()?.summary ?? null);
  protected readonly pages = computed(() => {
    const v = this.data();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });
  protected readonly filtered = computed(() => {
    const v = this.values();
    return !!(v.q.trim() || v.type || v.status || v.period !== 'month');
  });
  protected readonly periodLabel = computed(() => {
    const v = this.values();
    if (v.period === 'all') return 'todo el historial';
    const r = this.range();
    if (v.period === 'custom') return r.from || r.to ? 'las fechas elegidas' : 'todo el historial';
    return PERIODS.find((p) => p.value === v.period)!.label.toLowerCase();
  });

  protected readonly retrying = signal<number | null>(null);
  /** Boleta que se está cambiando por factura */
  protected readonly changing = signal<DocumentSummary | null>(null);
  protected readonly changeSaving = signal(false);
  protected readonly buyer = buyerForm();
  protected readonly exporting = signal(false);
  protected readonly reportFrom = new FormControl(this.today.slice(0, 8) + '01', {
    nonNullable: true,
  });
  protected readonly reportTo = new FormControl(this.today, { nonNullable: true });
  protected readonly downloading = signal(false);

  constructor() {
    // La campana abre la lista filtrada ("Con problemas" o "Sin aceptar"), de cualquier fecha
    effect(() => {
      const estado = this.estado();
      if ((estado === 'PROBLEMS' || estado === 'LATE') && !this.url.has('periodo'))
        untracked(() => this.filters.patchValue({ status: estado, period: 'all' }));
    });
    // Cada cambio de filtro o de página queda en la dirección, sin sumar pasos al historial
    effect(() => {
      const v = this.values();
      const page = this.page();
      untracked(() =>
        this.router.navigate([], {
          queryParams: {
            q: v.q.trim() || null,
            tipo: v.type,
            estado: v.status,
            periodo: v.period === 'month' ? null : v.period,
            desde: v.period === 'custom' ? v.from : null,
            hasta: v.period === 'custom' ? v.to : null,
            pagina: page > 1 ? page : null,
          },
          replaceUrl: true,
        }),
      );
    });
  }

  protected state(d: DocumentSummary): RowState {
    if (d.annulledBy) return 'annulled';
    switch (d.status) {
      case 'ACCEPTED':
        return d.provider === 'SIMULATED' ? 'simulated' : 'ok';
      case 'PENDING':
        return 'pending';
      case 'SENT':
        return 'sent';
      case 'ERROR':
        return 'error';
      default:
        return d.replacedAt ? 'replaced' : 'rejected';
    }
  }

  protected stateLabel(d: DocumentSummary): string {
    const s = this.state(d);
    return s === 'ok' ? statusLabel(d.status, d.provider) : STATE_STYLE[s].label;
  }

  protected canRetry(d: DocumentSummary): boolean {
    return (
      this.isAdmin() && (d.status === 'ERROR' || d.status === 'SENT' || d.status === 'PENDING')
    );
  }

  /** Qué está pasando con el envío, en una línea */
  protected detail(d: DocumentSummary): string | null {
    if (d.status === 'REJECTED' && d.replacedAt)
      return 'Se emitió otro comprobante para este cobro';
    if (d.status === 'REJECTED') return d.sunatDescription ?? 'SUNAT lo rechazó';
    if (d.status === 'ERROR')
      return `${d.lastError ?? 'No se pudo enviar'}${d.nextAttemptAt ? '' : ' · reintenta cuando lo corrijas'}`;
    if (d.status === 'SENT')
      return 'El PSE lo recibió; SUNAT confirma en unas horas (boletas por resumen diario)';
    return null;
  }

  /** Ver el comprobante relacionado (la boleta que anula una nota, o la nota que anuló una boleta) */
  protected find(code: string): void {
    this.filters.patchValue({ q: code, type: null, status: null, period: 'all' });
  }

  protected setPeriod(p: Period): void {
    this.filters.controls.period.setValue(p);
  }

  protected setType(t: DocumentType | null): void {
    this.filters.controls.type.setValue(t);
  }

  protected readonly retryingAll = signal(false);

  /** Reenvía todos los que no se pudieron enviar (p. ej. tras actualizar el token del PSE) */
  protected retryAll(): void {
    if (this.retryingAll()) return;
    this.retryingAll.set(true);
    this.billing.retryAll().subscribe({
      next: ({ count }) => {
        this.retryingAll.set(false);
        if (!count) {
          this.toast.info(
            'No hay comprobantes por reenviar: los rechazados por SUNAT se corrigen emitiendo de nuevo.',
          );
          return;
        }
        this.toast.success(
          `${count} ${count === 1 ? 'comprobante se volverá' : 'comprobantes se volverán'} a enviar en unos segundos.`,
        );
        setTimeout(() => this.list.reload(), 3000);
      },
      error: (error: unknown) => {
        this.retryingAll.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected retry(d: DocumentSummary): void {
    this.retrying.set(d.id);
    this.billing.retry(d.id).subscribe({
      next: () => {
        this.retrying.set(null);
        this.toast.success(`${d.code} se volverá a enviar en unos segundos.`);
        setTimeout(() => this.list.reload(), 3000);
      },
      error: (error: unknown) => {
        this.retrying.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Boleta vigente (sin nota de crédito) de un cobro: el cliente puede pedir factura después */
  protected canChangeToFactura(d: DocumentSummary): boolean {
    return d.type === 'BOLETA' && !d.annulledBy && !!d.receiptId && !d.replacedAt;
  }

  /** Una boleta válida cambia a factura solo en su mes (el anterior ya se declaró); una rechazada, siempre */
  protected sameMonth(d: DocumentSummary): boolean {
    return d.status === 'REJECTED' || d.issueDate.slice(0, 7) === this.today.slice(0, 7);
  }

  /** Rechazado por SUNAT que nadie corrigió: se emite otro con los datos corregidos */
  protected canReissue(d: DocumentSummary): boolean {
    return (
      d.status === 'REJECTED' &&
      !d.replacedAt &&
      d.type !== 'CREDIT_NOTE' &&
      !!d.receiptId &&
      !d.annulledBy
    );
  }

  // ── Menú ⋯ de cada fila ──
  protected readonly menuFor = signal<number | null>(null);
  /** Cerca del borde de abajo, el menú se abre hacia arriba (en el celular no se corta) */
  protected readonly menuUp = signal(false);

  protected menuItems(d: DocumentSummary): MenuAction[] {
    const items: MenuAction[] = [];
    if (d.pdfUrl) items.push('pdf');
    if (this.canChangeToFactura(d)) items.push('factura');
    // Anular es del administrador y se hace en el ticket (ahí está la nota de crédito)
    if (this.isAdmin() && d.receiptId && !d.annulledBy && d.type !== 'CREDIT_NOTE')
      items.push('void');
    return items;
  }

  protected toggleMenu(id: number, event: Event): void {
    if (this.menuFor() === id) {
      this.menuFor.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuUp.set(rect.bottom > window.innerHeight - 220);
    this.menuFor.set(id);
  }

  protected closeMenu(): void {
    const id = this.menuFor();
    if (id === null) return;
    this.menuFor.set(null);
    // El foco vuelve al botón ⋯
    document.querySelector<HTMLElement>(`[aria-controls="doc-menu-${id}"]`)?.focus();
  }

  protected onDocClick(event: Event): void {
    if (this.menuFor() === null) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-doc-menu]')) this.menuFor.set(null);
  }

  // ── Corregir un rechazado ──
  protected readonly reissuing = signal<DocumentSummary | null>(null);
  protected readonly reissueText = computed(() => {
    const d = this.reissuing();
    if (!d) return '';
    return `SUNAT rechazó ${d.code}${d.sunatDescription ? ` («${d.sunatDescription}»)` : ''}. Corrige los datos: se emite otro comprobante para el mismo cobro; el pago y la caja no cambian.`;
  });

  protected openReissue(d: DocumentSummary): void {
    const matches = (d.type === 'FACTURA') === (d.customerDocType === '6');
    this.reissuing.set(d);
    // El formulario se arma al abrir (queda vacío): después se ponen los datos que tenía
    if (matches)
      setTimeout(() =>
        this.buyer.patchValue({
          docNumber: d.customerDocNumber.replace(/\D/g, ''),
          name: d.customerName,
        }),
      );
  }

  protected confirmReissue(): void {
    const d = this.reissuing();
    if (!d || this.changeSaving()) return;
    if (this.buyer.invalid) {
      this.buyer.markAllAsTouched();
      return;
    }
    const buyer = buyerPayload(this.buyer, d.type === 'FACTURA' ? 'RUC' : 'DNI', false);
    if (!buyer) return;
    this.changeSaving.set(true);
    this.billing.reissue(d.id, buyer).subscribe({
      next: (r) => {
        this.changeSaving.set(false);
        this.reissuing.set(null);
        this.toast.success(`Se emitió ${r.code} con los datos corregidos.`);
        this.list.reload();
      },
      error: (error: unknown) => {
        this.changeSaving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected openChange(d: DocumentSummary): void {
    this.changing.set(d);
  }

  protected confirmChange(): void {
    const d = this.changing();
    if (!d || this.changeSaving()) return;
    if (this.buyer.invalid) {
      this.buyer.markAllAsTouched();
      return;
    }
    const buyer = buyerPayload(this.buyer, 'RUC', false);
    if (!buyer) return;
    this.changeSaving.set(true);
    this.billing.toFactura(d.id, buyer).subscribe({
      next: (r) => {
        this.changeSaving.set(false);
        this.changing.set(null);
        this.toast.success(
          `${d.code} se anuló con nota de crédito y se emitió la factura ${r.code}.`,
        );
        this.list.reload();
      },
      error: (error: unknown) => {
        this.changeSaving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected openExport(): void {
    const r = this.range();
    this.reportFrom.setValue(r.from ?? this.today.slice(0, 8) + '01');
    this.reportTo.setValue(r.to ?? this.today);
    this.exporting.set(true);
  }

  protected download(): void {
    const from = this.reportFrom.value;
    const to = this.reportTo.value;
    if (!from || !to || from > to) {
      this.toast.error('Revisa el periodo: la fecha inicial va antes que la final.');
      return;
    }
    this.downloading.set(true);
    this.billing.report(from, to).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ventas-${from}-a-${to}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error: unknown) => {
        this.downloading.set(false);
        this.toast.error(apiErrorMessage(error, 'No se pudo generar el Excel.'));
      },
    });
  }

  protected clear(): void {
    this.filters.reset({ q: '', type: null, status: null, period: 'month', from: null, to: null });
  }
}
