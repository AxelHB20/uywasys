import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  DOCUMENT,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { BillingStatus, DocumentChoice, documentOptions } from '../../core/services/billing.models';
import { BillingService } from '../../core/services/billing.service';
import { CashService } from '../../core/services/cash.service';
import {
  NEEDS_CODE,
  PENDING_SOURCE_LABELS,
  PendingClient,
  PendingSource,
  SessionSummary,
} from '../../core/services/cash.models';
import { CareServicesService } from '../../core/services/care-services.service';
import { ClientSummary } from '../../core/services/clients.models';
import { ClientsService } from '../../core/services/clients.service';
import { CareService } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { Charge, ChargeItemInput, ClientAccount } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import {
  CatalogOption,
  toProductOptions,
  toServiceOptions,
} from '../../shared/catalog/catalog-options';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { DocumentChoiceComponent } from '../../shared/ui/document-choice/document-choice.component';
import {
  BuyerFieldsComponent,
  BuyerMode,
  buyerForm,
  buyerPayload,
} from '../../shared/ui/buyer-fields/buyer-fields.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { DiscountFieldsComponent } from '../../shared/ui/discount-fields/discount-fields.component';
import { discountProblem } from '../../shared/ui/discount-fields/discount';
import { ClinicService } from '../../core/services/clinic.service';
import {
  PaymentGroup,
  PaymentLinesComponent,
  paymentForm,
  syncPaymentsTotal,
  paymentsError,
  paymentsValue,
} from '../../shared/ui/payment-lines/payment-lines.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { limaDate, relativeDay } from '../../shared/utils/records';
import { limaToday } from '../../shared/utils/dates';
import { formatQty, money, unitLabel } from '../../shared/utils/stock';
import { TRANSPORT_MAX_PRICE } from '../../shared/ui/transport-fields/transport-fields.component';
import { apiErrorMessage } from '../../shared/utils/validators';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';

type Modal = 'collect' | 'counter' | 'expense' | 'close' | 'void-expense' | null;

/** Desde este monto el comprobante exige identificar al cliente (igual que el backend) */
const ANONYMOUS_LIMIT = 700;

type SaleLine = FormGroup<{
  option: FormControl<CatalogOption>;
  quantity: FormControl<number | null>;
}>;

const cents = (n: number) => Math.round(n * 100);

/**
 * Caja: apertura, "por cobrar", cobros con varios medios, venta de mostrador,
 * egresos y cierre con arqueo. Sin caja abierta no se mueve dinero.
 */
/** Para buscar sin tildes ni mayúsculas */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

@Component({
  selector: 'app-cash-page',
  host: { '(document:keydown)': 'onShortcut($event)' },
  imports: [
    FechaPipe,
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    PaymentLinesComponent,
    DocumentChoiceComponent,
    BuyerFieldsComponent,
    DiscountFieldsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash.page.html',
})
export class CashPage {
  private readonly cash = inject(CashService);
  private readonly visits = inject(VisitsService);
  private readonly clients = inject(ClientsService);
  private readonly services = inject(CareServicesService);
  private readonly inventory = inject(InventoryService);
  private readonly clinicService = inject(ClinicService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly billing = inject(BillingService);

  /** ?cobrar=<clientId>: abre el cobro de ese cliente (desde la ficha o la atención) */
  readonly cobrar = input<string>();

  protected readonly money = money;
  protected readonly sourceLabels = PENDING_SOURCE_LABELS;
  protected readonly sourceTone: Record<PendingSource, string> = {
    CONSULTATION: 'bg-anil-50 text-anil-800',
    GROOMING: 'bg-violet-50 text-violet-800',
    HOSPITALIZATION: 'bg-rose-50 text-rose-800',
    COUNTER: 'bg-slate-100 text-slate-700',
  };
  protected readonly relativeDay = relativeDay;
  protected readonly isAdmin = this.session.isAdmin;
  protected readonly isSupport = this.session.isSupport;
  /** Quien está usando el sistema: sus cobros quedan a su nombre en la caja abierta */
  protected readonly myName = this.session.fullName;
  protected readonly myInitials = this.session.initials;
  protected readonly myId = computed(() => this.session.user()?.id ?? null);

  /** Facturación electrónica: si está activa, cada cobro elige boleta, factura o nota de venta */
  protected readonly billingStatus = signal<BillingStatus | null>(null);
  protected readonly documentChoice = new FormControl<DocumentChoice>('NOTE', {
    nonNullable: true,
  });
  private readonly documentValue = toSignal(this.documentChoice.valueChanges, {
    initialValue: this.documentChoice.value,
  });
  /** Datos del comprador escritos en el cobro (RUC de la factura, DNI de la boleta de más de S/ 700) */
  protected readonly buyer = buyerForm();
  protected readonly current = signal<SessionSummary | null>(null);
  protected readonly lastClosed = signal<SessionSummary | null>(null);
  protected readonly pending = signal<PendingClient[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly modal = signal<Modal>(null);
  /** Problema del pago, mostrado junto a "Recibido" (no como aviso flotante) */
  protected readonly payError = signal<string | null>(null);
  /** Abono: el monto a cobrar se edita solo si el cliente paga una parte */
  protected readonly partial = signal(false);

  protected readonly openForm = new FormGroup({
    openingAmount: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0),
      Validators.max(100000),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
  });

  protected readonly methodsWithMoney = computed(
    // Solo medios con dinero; si todo se devolvió (cobro anulado), igual sale con su devolución
    () => this.current()?.byMethod.filter((m) => m.net !== 0 || m.refunded) ?? [],
  );
  protected readonly methodColor: Record<string, string> = {
    CASH: 'bg-emerald-500',
    YAPE: 'bg-anil-500',
    PLIN: 'bg-sky-500',
    CARD: 'bg-amber-500',
    TRANSFER: 'bg-slate-400',
  };
  /** Participación de cada medio en lo cobrado (barra apilada) */
  protected readonly methodShare = computed(() => {
    const list = this.methodsWithMoney().filter((m) => m.net > 0);
    const total = list.reduce((s, m) => s + m.net, 0);
    return list.map((m) => ({
      ...m,
      percent: total ? Math.round((m.net / total) * 1000) / 10 : 0,
    }));
  });
  /** De dónde sale el efectivo esperado: inicial + efectivo cobrado − egresos */
  protected readonly cashFlow = computed(() => {
    const s = this.current();
    if (!s) return null;
    const cash = s.byMethod.find((m) => m.method === 'CASH')?.net ?? 0;
    return { opening: s.openingAmount, cash, expenses: s.expenses };
  });
  /** Lo que no pasa por el cajón: se revisa contra la app de Yape/Plin, el POS o el banco */
  protected readonly digitalMethods = computed(() =>
    this.methodsWithMoney().filter((m) => m.method !== 'CASH'),
  );

  /** "Efectivo" o, si se dividió, "Efectivo S/ 50.00 + Yape S/ 30.00" */
  protected paidWith(r: SessionSummary['receipts'][number]): string {
    const list = r.payments ?? [];
    if (list.length < 2) return list[0]?.label ?? '';
    return list.map((p) => `${p.label} ${money(p.amount)}`).join(' + ');
  }

  /** Yape, Plin o transferencia que entró sin código de operación */
  protected uncoded(r: SessionSummary['receipts'][number]): boolean {
    return (r.payments ?? []).some((p) => NEEDS_CODE.includes(p.method) && !p.hasCode);
  }

  /** Falta lo recibido en efectivo: lleva el foco a ese campo */
  private focusMissingTendered(): void {
    const field = [
      ...this.document.querySelectorAll<HTMLInputElement>(
        'dialog[open] input[id*="-tendered-"][aria-required="true"]',
      ),
    ].find((input) => !input.value);
    field?.focus();
  }

  /** "Consulta general, Vacuna y 1 más" */
  protected owedNames(p: PendingClient): string {
    const names = p.names ?? [];
    if (!names.length) return `${p.charges} por cobrar`;
    const rest = p.charges - names.length;
    if (rest <= 0) return names.length === 2 ? `${names[0]} y ${names[1]}` : names[0];
    return `${names.join(', ')} y ${rest} más`;
  }

  protected readonly averageTicket = computed(() => {
    const t = this.current()?.totals;
    return t && t.receipts ? Math.round((t.net / t.receipts) * 100) / 100 : 0;
  });
  /** La caja se abrió otro día (no se cerró al terminar la jornada) */
  protected readonly openedEarlier = computed(() => {
    const s = this.current();
    return !!s && limaToday(new Date(s.openedAt)) !== limaToday();
  });
  protected readonly pendingTotal = computed(
    () => Math.round(this.pending().reduce((s, p) => s + p.balance * 100, 0)) / 100,
  );
  /** Búsqueda en "Por cobrar" (nombre del dueño o de la mascota, sin tildes) */
  protected readonly pendingQuery = signal('');
  protected readonly filteredPending = computed(() => {
    const q = plain(this.pendingQuery().trim());
    if (!q) return this.pending();
    return this.pending().filter((p) => plain(`${p.client.name} ${p.pets.join(' ')}`).includes(q));
  });
  /**
   * "De hoy" arriba (el último en terminar primero: suele ser quien está en el mostrador) y
   * "Saldos anteriores" debajo, del más antiguo al más reciente.
   */
  protected readonly pendingGroups = computed(() => {
    const today = limaToday();
    const list = this.filteredPending();
    const fresh = list
      .filter((p) => limaToday(new Date(p.last)) === today)
      .sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
    const older = list.filter((p) => !fresh.includes(p));
    return [
      { key: 'today', title: 'De hoy', items: fresh },
      { key: 'older', title: 'Saldos anteriores', items: older },
    ].filter((g) => g.items.length);
  });
  /** Pestaña del panel derecho */
  protected readonly activity = signal<'receipts' | 'movements'>('receipts');
  protected readonly receiptsDesc = computed(
    () => this.current()?.receipts.slice().reverse() ?? [],
  );

  /** Días desde una fecha ISO (para resaltar deudas antiguas) */
  protected daysSince(iso: string): number {
    return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  }

  /** "de ayer" / "del 12 nov. (hace 6 días)": de qué día es la caja abierta */
  protected openedDay(iso: string): string {
    const days = Math.round(
      (Date.parse(limaDate(new Date())) - Date.parse(limaDate(new Date(iso)))) / 86_400_000,
    );
    return days <= 1 ? 'de ayer' : `del ${relativeDay(iso)} (hace ${days} días)`;
  }

  /** "5 h 20 min" desde que se abrió la caja */
  protected openFor(iso: string): string {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  }

  /** Celular: el resumen de la caja se abre al tocar */
  protected readonly summaryOpen = signal(false);

  // ── Descuento: un monto para todo el cobro (se reparte entre las líneas para la boleta) ──
  protected readonly maxDiscount = toSignal(
    this.clinicService.discountLimit().pipe(
      map((r) => r.maxDiscountPercent),
      catchError(() => of(10)),
    ),
    { initialValue: 10 },
  );
  protected readonly discount = signal<{ open: boolean; amount: number | null; reason: string }>({
    open: false,
    amount: null,
    reason: '',
  });
  /** Mostrar "falta el motivo" después de intentar cobrar */
  protected readonly discountErrors = signal(false);

  /** A qué se le reparte: lo marcado (lo que falta de cada línea) y lo agregado o vendido */
  private readonly discountTargets = computed(() => {
    this.saleVersion();
    const acc = this.modal() === 'collect' ? this.account() : null;
    const sel = this.selected();
    const charges = acc
      ? acc.pending
          .filter((c) => sel.has(c.id) && c.balance > 0)
          .map((c) => ({
            key: `c${c.id}`,
            // Con abono, el descuento sale de lo que falta
            base: c.balance,
            price: (cents(c.total) + cents(c.discount ?? 0)) / 100,
          }))
      : [];
    const lines = this.saleLines.controls.map((g, i) => ({
      key: `l${i}`,
      base: this.lineGross(g),
      price: this.lineGross(g),
    }));
    return [...charges, ...lines];
  });

  /** Sobre cuánto se puede descontar */
  protected readonly discountBase = computed(
    () => this.discountTargets().reduce((s, t) => s + cents(t.base), 0) / 100,
  );

  /** Sobre qué se mide el tope: el precio de las líneas */
  protected readonly discountCapBase = computed(
    () => this.discountTargets().reduce((s, t) => s + cents(t.price), 0) / 100,
  );

  /** Monto del descuento que se está dando (0 si está cerrado o no es válido) */
  protected readonly discountAmount = computed(() => {
    const d = this.discount();
    if (!d.open) return 0;
    const amount = Number(d.amount) || 0;
    // Si pasa del tope o no se entiende, el total no cambia hasta corregirlo
    const problem = discountProblem(
      this.discountBase(),
      amount,
      'ok',
      this.maxDiscount(),
      this.isAdmin(),
      this.discountCapBase(),
    );
    return amount > 0 && !problem ? amount : 0;
  });

  /** El descuento repartido según el importe de cada línea (lo que sobra, a las más grandes) */
  private readonly discountShares = computed(() => {
    const targets = this.discountTargets();
    const total = cents(this.discountAmount());
    const shares = new Map<string, number>();
    const sum = targets.reduce((s, t) => s + cents(t.base), 0);
    if (!total || !sum) return shares;
    const parts = targets.map((t) => Math.floor((total * cents(t.base)) / sum));
    let rest = total - parts.reduce((s, x) => s + x, 0);
    const order = targets.map((_, i) => i).sort((x, y) => targets[y].base - targets[x].base);
    for (let i = 0; rest > 0; i++, rest--) parts[order[i % order.length]]++;
    targets.forEach((t, i) => shares.set(t.key, parts[i] / 100));
    return shares;
  });

  private shareOf(key: string): number {
    return this.discountShares().get(key) ?? 0;
  }

  protected openDiscount(): void {
    this.discount.set({ open: true, amount: null, reason: '' });
    setTimeout(() =>
      (this.document.getElementById('disc-amt') as HTMLInputElement | null)?.focus(),
    );
  }

  protected setDiscount(patch: Partial<{ amount: number | null; reason: string }>): void {
    this.discount.update((d) => ({ ...d, ...patch }));
    this.afterDiscountChange();
  }

  protected closeDiscount(): void {
    this.discount.set({ open: false, amount: null, reason: '' });
    this.afterDiscountChange();
  }

  private afterDiscountChange(): void {
    if (this.modal() === 'collect' && !this.partial())
      this.amount.setValue(this.selectedTotal() || null);
    if (this.modal() === 'counter') syncPaymentsTotal(this.payments, this.saleTotal());
  }

  /** El descuento abierto está mal (pasa del tope, falta el motivo…) */
  private discountsInvalid(): boolean {
    const d = this.discount();
    if (!d.open || !d.amount) return false;
    const bad =
      discountProblem(
        this.discountBase(),
        d.amount,
        d.reason,
        this.maxDiscount(),
        this.isAdmin(),
        this.discountCapBase(),
      ) !== null;
    if (bad) {
      this.discountErrors.set(true);
      this.toast.error('Revisa el descuento: el monto o el motivo.');
    }
    return bad;
  }

  // ── Cobrar ──
  protected readonly account = signal<ClientAccount | null>(null);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly amount = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(0.01),
    Validators.pattern(/^\d+(\.\d{1,2})?$/),
  ]);
  private readonly amountValue = toSignal(this.amount.valueChanges, { initialValue: null });
  protected readonly selectedTotal = computed(() => {
    const acc = this.account();
    if (!acc) return 0;
    const ids = this.selected();
    return (
      acc.pending
        .filter((c) => ids.has(c.id))
        .reduce((s, c) => s + cents(c.balance) - cents(this.shareOf(`c${c.id}`)), 0) / 100
    );
  });
  /** Lo que se cobra: lo marcado (o el abono) + lo agregado en caja, que se paga completo */
  protected readonly collectTotal = computed(
    () =>
      (cents(this.selected().size ? Number(this.amountValue()) || 0 : 0) +
        cents(this.saleTotal())) /
      100,
  );
  /** "5 cargos + 2 nuevos" */
  protected readonly collectCount = computed(() => {
    this.saleVersion();
    const n = this.selected().size;
    const added = this.saleLines.length;
    if (!added) return '';
    return n ? `${n} + ${added} ${added === 1 ? 'agregado' : 'agregados'}` : '';
  });
  protected payments: FormArray<PaymentGroup> = paymentForm(0);
  private requestKey = '';
  /** Cliente cuyo cobro ya se abrió solo por ?cobrar=: al cerrar el modal no se vuelve a abrir */
  private autoOpened = 0;

  // ── Venta de mostrador ──
  private readonly catalog = signal<CareService[]>([]);
  protected readonly saleClient = signal<ClientSummary | null>(null);
  protected readonly clientSearch = new FormControl('', { nonNullable: true });
  protected readonly clientResults = toSignal(
    this.clientSearch.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<ClientSummary[]>([])
          : this.clients.list({ q }).pipe(
              map((page) => page.items.slice(0, 5)),
              catchError(() => of<ClientSummary[]>([])),
            ),
      ),
    ),
    { initialValue: [] as ClientSummary[] },
  );
  protected readonly itemSearch = new FormControl('', { nonNullable: true });
  private readonly itemTerm = toSignal(this.itemSearch.valueChanges, { initialValue: '' });
  protected readonly serviceOptions = computed(() =>
    toServiceOptions(
      this.catalog().filter((s) => s.category !== 'GROOMING'),
      this.itemTerm(),
      4,
    ),
  );
  protected readonly productOptions = toSignal(
    this.itemSearch.valueChanges.pipe(
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
  /** Resultados del buscador de la venta (servicios y productos) y el resaltado con ↑/↓ */
  protected readonly saleOptions = computed(() =>
    this.serviceOptions().concat(this.productOptions()),
  );
  protected readonly activeOption = signal(0);
  private enterQueued = false;

  /** ↑/↓ recorren la lista, Enter agrega (o espera el resultado si aún busca), Esc la cierra */
  protected onItemKey(event: KeyboardEvent): void {
    const options = this.saleOptions();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeOption.set((this.activeOption() + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.itemSearch.value.trim().length < 2) return;
      if (options.length)
        this.addSaleLine(
          this.activeOption() ? options[this.activeOption()] : this.bestOption(options),
        );
      else this.enterQueued = true;
    } else if (event.key === 'Escape' && this.itemSearch.value) {
      event.preventDefault();
      event.stopPropagation();
      this.itemSearch.setValue('');
    }
  }

  /** Si coincide un código de barras exacto, ese; si no, el primero de la lista */
  private bestOption(options: CatalogOption[]): CatalogOption {
    const term = this.itemSearch.value.trim();
    return options.find((o) => o.barcode && o.barcode === term) ?? options[0];
  }

  protected readonly saleLines = new FormArray<SaleLine>([]);
  private readonly saleVersion = signal(0);
  protected readonly saleTotal = computed(() => {
    this.saleVersion();
    return (
      this.saleLines.controls.reduce(
        (s, g, i) => s + cents(this.lineGross(g)) - cents(this.shareOf(`l${i}`)),
        0,
      ) / 100
    );
  });
  protected readonly collectDocuments = computed(() =>
    documentOptions(this.billingStatus(), this.account()?.client ?? null, this.collectTotal()),
  );
  protected readonly saleDocuments = computed(() =>
    documentOptions(
      this.billingStatus(),
      this.saleClient() ?? { docType: null, walkIn: true },
      this.saleTotal(),
    ),
  );
  /** Qué datos del comprador pide este cobro: RUC (factura), DNI (boleta de más de S/ 700 sin documento) */
  private buyerModeFor(client: { docType: string | null } | null, total: number): BuyerMode | null {
    const doc = this.documentValue();
    if (doc === 'FACTURA') return 'RUC';
    if (doc === 'BOLETA' && total > ANONYMOUS_LIMIT && !client?.docType) return 'DNI';
    return null;
  }
  protected readonly collectBuyerMode = computed(() => {
    const client = this.account()?.client ?? null;
    return this.buyerModeFor(client && client.number !== 0 ? client : null, this.collectTotal());
  });
  protected readonly saleBuyerMode = computed(() =>
    this.buyerModeFor(this.saleClient(), this.saleTotal()),
  );
  /** Nota de venta a "cliente varios" de más de S/ 700: SUNAT exige identificarlo (boleta con DNI) */
  protected readonly anonymousTooBig = computed(
    () =>
      !this.saleClient() && this.saleTotal() > ANONYMOUS_LIMIT && this.documentValue() === 'NOTE',
  );

  /** Si faltan datos del comprador, los marca y avisa. true = se puede cobrar */
  private buyerReady(mode: BuyerMode | null): boolean {
    if (!mode || this.buyer.disabled || this.buyer.valid) return true;
    // El error queda debajo de cada campo; se lleva el foco al primero que falta
    this.buyer.markAllAsTouched();
    setTimeout(() =>
      this.document
        .querySelector<HTMLElement>('dialog[open] [data-testid="buyer-form"] [aria-invalid="true"]')
        ?.focus(),
    );
    return false;
  }

  // ── Egreso, cierre ──
  protected readonly expenseForm = new FormGroup({
    amount: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0.01),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    }),
  });
  protected readonly closeForm = new FormGroup({
    countedCash: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
  });
  private readonly counted = toSignal(this.closeForm.controls.countedCash.valueChanges, {
    initialValue: null,
  });
  protected readonly difference = computed(() => {
    const counted = this.counted();
    const s = this.current();
    if (counted === null || (counted as unknown) === '' || !s) return null;
    return (cents(Number(counted)) - cents(s.expectedCash)) / 100;
  });
  /** Contar por billetes y monedas: el total pasa a "Efectivo contado" */
  protected readonly denominations = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];
  protected readonly counting = signal(false);
  protected readonly countForm = new FormGroup(
    Object.fromEntries(
      this.denominations.map((d) => [
        String(cents(d)),
        new FormControl<number | null>(null, [Validators.min(0), Validators.pattern(/^\d+$/)]),
      ]),
    ),
  );
  private readonly countValues = toSignal(this.countForm.valueChanges, {
    initialValue: this.countForm.getRawValue(),
  });
  protected readonly countTotal = computed(() => {
    const v = this.countValues();
    return (
      this.denominations.reduce(
        (sum, d) => sum + cents(d) * Math.max(0, Math.floor(Number(v[String(cents(d))]) || 0)),
        0,
      ) / 100
    );
  });

  protected toggleCounting(): void {
    this.counting.update((v) => !v);
    if (this.counting()) this.countForm.reset();
  }

  protected applyCount(): void {
    this.closeForm.controls.countedCash.setValue(this.countTotal());
    this.closeForm.controls.countedCash.markAsTouched();
  }

  protected denominationKey(d: number): string {
    return String(cents(d));
  }

  protected denominationLabel(d: number): string {
    return d >= 10 ? `S/ ${d}` : d >= 1 ? `S/ ${d}` : `${Math.round(d * 100)} cént.`;
  }

  protected readonly voidingExpense = signal<SessionSummary['movements'][number] | null>(null);
  protected readonly voidReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    this.load();
    this.billing.status().subscribe({
      next: (status) => this.billingStatus.set(status),
      error: () => this.billingStatus.set(null),
    });
    this.services.list('active').subscribe({
      next: (list) => this.catalog.set(list),
      error: () => this.catalog.set([]),
    });
    // Los medios siguen a lo que se cobra (abono o algo agregado; dividido, se ajusta el primero)
    effect(() => {
      if (this.modal() !== 'collect') return;
      const total = this.collectTotal();
      untracked(() => syncPaymentsTotal(this.payments, total));
    });
    // "Por cobrar" al día sin F5: cada 30 s y al volver a la pestaña (nunca con un modal abierto)
    const tick = setInterval(() => this.refreshQuiet(), 30_000);
    const onVisible = () => {
      if (this.document.visibilityState === 'visible') this.refreshQuiet();
    };
    this.document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      this.document.removeEventListener('visibilitychange', onVisible);
    });
    // Al cambiar lo escrito, el resaltado vuelve al primero
    effect(() => {
      this.itemTerm();
      this.activeOption.set(0);
    });
    // Lector de códigos o Enter apenas se escribe: se agrega el primer resultado cuando llega
    effect(() => {
      const options = this.saleOptions();
      if (this.enterQueued && options.length) {
        this.enterQueued = false;
        this.addSaleLine(this.bestOption(options));
      }
    });
    // ?cobrar=<id> abre el cobro en cuanto la caja está cargada y abierta
    effect(() => {
      const id = Number(this.cobrar());
      if (id && id !== this.autoOpened && this.current() && !this.modal()) {
        this.autoOpened = id;
        this.openCollect(id);
      }
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.cash.current().subscribe({
      next: (session) => {
        this.current.set(session);
        this.loading.set(false);
        if (session) this.loadPending();
        else this.loadLastClosed();
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la caja.'));
      },
    });
  }

  /** Con la caja cerrada: el último cierre (para revisarlo, imprimirlo y repetir el inicial) */
  private loadLastClosed(): void {
    if (this.lastClosed()) return;
    this.cash.sessions(1).subscribe({
      next: (page) => {
        const last = page.items.find((s) => s.status === 'CLOSED');
        if (last)
          this.cash.session(last.id).subscribe({
            next: (s) => this.lastClosed.set(s),
            error: () => undefined,
          });
      },
      error: () => undefined,
    });
  }

  /** "Igual que la última vez": el mismo sencillo con que empezó la caja anterior */
  protected useLastOpening(): void {
    const last = this.lastClosed();
    if (!last) return;
    this.openForm.controls.openingAmount.setValue(last.openingAmount);
    this.openForm.controls.openingAmount.markAsDirty();
  }

  /** Actualiza caja y "Por cobrar" en silencio (sin esqueleto ni errores a la vista) */
  private refreshQuiet(): void {
    if (this.modal() || !this.current() || this.document.visibilityState !== 'visible') return;
    this.cash.current().subscribe({
      next: (session) => {
        if (this.modal()) return;
        this.current.set(session);
        if (session) this.loadPending();
        else this.loadLastClosed();
      },
      error: () => undefined,
    });
  }

  private loadPending(): void {
    this.cash.pending().subscribe({
      next: (list) => this.pending.set(list),
      error: () => this.pending.set([]),
    });
  }

  private refreshSession(session: SessionSummary): void {
    this.current.set(session);
    this.loadPending();
  }

  // ── Apertura ──

  protected openSession(): void {
    if (this.saving()) return;
    if (this.openForm.invalid) {
      this.openForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.cash.open(Number(this.openForm.getRawValue().openingAmount)).subscribe({
      next: (session) => {
        this.saving.set(false);
        this.lastClosed.set(null);
        this.refreshSession(session);
        this.toast.success('Caja abierta.');
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Cobrar ──

  /** Boleta por defecto si la clínica factura electrónicamente */
  private resetDocument(): void {
    this.documentChoice.setValue(this.billingStatus()?.enabled ? 'BOLETA' : 'NOTE');
  }

  protected openCollect(clientId: number): void {
    // Lo agregado en caja empieza vacío en cada cobro
    this.itemSearch.setValue('');
    this.saleLines.clear();
    this.saleVersion.update((v) => v + 1);
    this.account.set(null);
    this.discount.set({ open: false, amount: null, reason: '' });
    this.discountErrors.set(false);
    this.partial.set(false);
    this.payError.set(null);
    this.resetDocument();
    this.requestKey = crypto.randomUUID();
    this.modal.set('collect');
    this.visits.account(clientId).subscribe({
      next: (acc) => {
        this.account.set(acc);
        this.selected.set(new Set(acc.pending.map((c) => c.id)));
        this.amount.setValue(acc.pendingTotal || null);
        this.payments = paymentForm(acc.pendingTotal);
        this.payments.valueChanges.subscribe(() => this.payError.set(null));
      },
      error: (error: unknown) => {
        this.modal.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Marca o desmarca todos los cargos */
  protected toggleAll(): void {
    const acc = this.account();
    if (!acc) return;
    const all = this.selected().size === acc.pending.length;
    this.selected.set(new Set(all ? [] : acc.pending.map((c) => c.id)));
    this.amount.setValue(this.selectedTotal() || null);
  }

  /** Atajos: F2 busca producto en la venta; Ctrl+Enter cobra (cobro o venta abiertos) */
  protected onShortcut(event: KeyboardEvent): void {
    const modal = this.modal();
    if (event.key === 'F2' && (modal === 'counter' || modal === 'collect')) {
      event.preventDefault();
      this.document.getElementById(modal === 'counter' ? 'sale-search' : 'collect-search')?.focus();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      if (modal === 'collect') {
        event.preventDefault();
        this.collect();
      } else if (modal === 'counter') {
        event.preventDefault();
        this.sell();
      }
    }
  }

  /** Abre o cierra el abono; al cerrarlo se vuelve a cobrar todo lo marcado */
  protected togglePartial(): void {
    const on = !this.partial();
    this.partial.set(on);
    if (!on) this.amount.setValue(this.selectedTotal() || null);
    else
      setTimeout(() =>
        (this.document.getElementById('collect-amount') as HTMLInputElement | null)?.select(),
      );
  }

  // ── Movilidad: su precio se corrige aquí mientras no se cobre ──
  protected readonly editingPrice = signal<number | null>(null);
  protected readonly priceSaving = signal(false);
  protected readonly transportPrice = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(0.01),
    Validators.max(TRANSPORT_MAX_PRICE),
  ]);
  protected readonly maxTransport = TRANSPORT_MAX_PRICE;

  protected startPrice(charge: Charge): void {
    this.transportPrice.reset(charge.total);
    this.editingPrice.set(charge.id);
    setTimeout(() =>
      (this.document.getElementById(`mov-price-${charge.id}`) as HTMLInputElement | null)?.select(),
    );
  }

  protected savePrice(charge: Charge): void {
    if (this.priceSaving()) return;
    if (this.transportPrice.invalid) {
      this.transportPrice.markAsTouched();
      return;
    }
    const price = Number(this.transportPrice.value);
    if (price === charge.total) {
      this.editingPrice.set(null);
      return;
    }
    this.priceSaving.set(true);
    this.visits.changeTransportPrice(charge.id, price).subscribe({
      next: (updated) => {
        this.priceSaving.set(false);
        this.editingPrice.set(null);
        this.account.update((acc) => {
          if (!acc) return acc;
          const pending = acc.pending.map((c) => (c.id === updated.id ? updated : c));
          return {
            ...acc,
            pending,
            pendingTotal: Math.round(pending.reduce((sum, c) => sum + c.balance, 0) * 100) / 100,
          };
        });
        this.amount.setValue(this.selectedTotal() || null);
        this.toast.success(`Movilidad: ${money(price)}`);
      },
      error: (error: unknown) => {
        this.priceSaving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected toggleCharge(charge: Charge): void {
    const next = new Set(this.selected());
    if (next.has(charge.id)) next.delete(charge.id);
    else next.add(charge.id);
    this.selected.set(next);
    // El monto sigue a los cargos marcados y los medios de pago al monto (sin perder la división)
    this.amount.setValue(this.selectedTotal() || null);
  }

  protected collect(): void {
    const acc = this.account();
    if (!acc || this.saving()) return;
    const total = this.collectTotal();
    const marked = this.selected().size > 0;
    if (!marked && !this.saleLines.length) {
      this.toast.error('Marca lo que paga o agrega un producto.');
      return;
    }
    const part = Number(this.amountValue()) || 0;
    if (marked && (this.amount.invalid || part <= 0)) {
      this.amount.markAsTouched();
      this.partial.set(true);
      this.toast.error('Escribe cuánto paga hoy.');
      return;
    }
    if (marked && cents(part) > cents(this.selectedTotal())) {
      this.toast.error(`El monto supera lo seleccionado (${money(this.selectedTotal())}).`);
      return;
    }
    if (this.saleLines.invalid) {
      this.saleLines.markAllAsTouched();
      this.toast.error('Revisa la cantidad de lo agregado.');
      return;
    }
    if (this.saleLines.controls.some((g) => g.controls.option.value.controlled)) {
      this.toast.error('Un psicotrópico se registra en la atención del paciente, con su receta.');
      return;
    }
    if (this.discountsInvalid()) return;
    if (!this.buyerReady(this.collectBuyerMode())) return;
    const problem = paymentsError(this.payments, total);
    if (problem) {
      this.payError.set(problem);
      this.focusMissingTendered();
      return;
    }
    this.saving.set(true);
    const ids = acc.pending.filter((c) => this.selected().has(c.id)).map((c) => c.id);
    this.cash
      .collect({
        requestKey: this.requestKey,
        clientId: acc.client.id,
        chargeIds: ids,
        discounts: this.discountsPayload(ids),
        items: this.saleLines.length ? this.saleItems() : undefined,
        amount: total,
        payments: paymentsValue(this.payments),
        document: this.documentChoice.value,
        buyer: buyerPayload(this.buyer, this.collectBuyerMode(), acc.client.number !== 0),
      })
      .subscribe({
        next: (ticket) => {
          this.saving.set(false);
          this.modal.set(null);
          this.toast.success(`Cobro ${ticket.document?.code ?? ticket.code} registrado.`);
          void this.router.navigate(['/caja/tickets', ticket.id]);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Venta de mostrador ──

  protected openCounter(): void {
    this.requestKey = crypto.randomUUID();
    this.discount.set({ open: false, amount: null, reason: '' });
    this.discountErrors.set(false);
    this.resetDocument();
    this.saleClient.set(null);
    this.clientSearch.setValue('');
    this.itemSearch.setValue('');
    this.saleLines.clear();
    this.saleVersion.update((v) => v + 1);
    this.payments = paymentForm(0);
    this.payments.valueChanges.subscribe(() => this.payError.set(null));
    this.payError.set(null);
    this.modal.set('counter');
  }

  protected pickClient(client: ClientSummary): void {
    this.saleClient.set(client);
    this.clientSearch.setValue('');
  }

  protected addSaleLine(option: CatalogOption): void {
    this.itemSearch.setValue('');
    this.activeOption.set(0);
    this.enterQueued = false;
    const existing = this.saleLines.controls.find(
      (g) => g.controls.option.value.key === option.key,
    );
    if (existing) {
      existing.controls.quantity.setValue((Number(existing.controls.quantity.value) || 0) + 1);
    } else {
      const group: SaleLine = new FormGroup({
        option: new FormControl(option, { nonNullable: true }),
        quantity: new FormControl<number | null>(1, [
          Validators.required,
          Validators.min(0.001),
          Validators.pattern(/^\d+(\.\d{1,3})?$/),
        ]),
      });
      group.controls.quantity.valueChanges.subscribe(() => this.onSaleChange());
      this.saleLines.push(group);
    }
    this.onSaleChange();
  }

  protected stepSaleLine(g: SaleLine, delta: number): void {
    const next = Math.max(1, Math.round((Number(g.controls.quantity.value) || 0) + delta));
    g.controls.quantity.setValue(next);
  }

  protected removeSaleLine(index: number): void {
    this.saleLines.removeAt(index);
    this.onSaleChange();
  }

  private onSaleChange(): void {
    this.saleVersion.update((v) => v + 1);
    syncPaymentsTotal(this.payments, this.saleTotal());
  }

  /** "7 ítems · 2 servicios y 5 productos" */
  protected saleSummary(): string {
    const lines = this.saleLines.controls.map((g) => g.controls.option.value.kind);
    const services = lines.filter((k) => k === 'SERVICE').length;
    const products = lines.length - services;
    const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const detail = [
      services && part(services, 'servicio', 'servicios'),
      products && part(products, 'producto', 'productos'),
    ]
      .filter(Boolean)
      .join(' y ');
    return `${part(lines.length, 'ítem', 'ítems')} · ${detail}`;
  }

  /** Aviso antes de cobrar: sin stock registrado, no alcanza o quedan pocos (en esa presentación) */
  protected stockWarning(g: SaleLine): string | null {
    const o = g.controls.option.value;
    if (o.kind !== 'PRODUCT' || o.stockBase === undefined) return null;
    const available = Math.floor(o.stockBase / (o.factor || 1));
    const qty = Number(g.controls.quantity.value) || 0;
    if (available <= 0) return 'Sin stock registrado';
    if (qty > available) return `Solo hay ${available}`;
    if (available - qty <= 2) return `Quedan ${available}`;
    return null;
  }

  /** Lo vendido o agregado, como lo pide el servidor */
  private saleItems(): ChargeItemInput[] {
    const reason = this.discount().reason.trim();
    return this.saleLines.getRawValue().map((l, i) => {
      const discount = this.shareOf(`l${i}`);
      return {
        careServiceId: l.option.careServiceId,
        productId: l.option.productId,
        presentationId: l.option.presentationId,
        quantity: Number(l.quantity),
        ...(discount > 0 ? { discount, discountReason: reason } : {}),
      };
    });
  }

  /** El descuento repartido en lo que ya estaba por cobrar (se suma al que traía de la atención) */
  private discountsPayload(ids: number[]) {
    const acc = this.account();
    const reason = this.discount().reason.trim();
    if (!acc || !this.discountAmount()) return undefined;
    const list = acc.pending
      .filter((c) => ids.includes(c.id) && this.shareOf(`c${c.id}`) > 0)
      .map((c) => ({
        chargeId: c.id,
        discount: (cents(c.discount ?? 0) + cents(this.shareOf(`c${c.id}`))) / 100,
        discountReason: (c.discountReason ? `${c.discountReason}; ${reason}` : reason).slice(
          0,
          120,
        ),
      }));
    return list.length ? list : undefined;
  }

  protected lineGross(g: SaleLine): number {
    return (
      cents((Number(g.controls.quantity.value) || 0) * g.controls.option.value.unitPrice) / 100
    );
  }

  protected lineTotal(g: SaleLine): number {
    return this.lineGross(g);
  }

  protected sell(): void {
    if (this.saving()) return;
    if (!this.saleLines.length || this.saleLines.invalid) {
      this.saleLines.markAllAsTouched();
      this.toast.error('Agrega al menos un producto o servicio con su cantidad.');
      return;
    }
    if (this.saleLines.controls.some((g) => g.controls.option.value.controlled)) {
      this.toast.error('Un psicotrópico se registra en la atención del paciente, con su receta.');
      return;
    }
    if (this.anonymousTooBig()) return;
    if (this.discountsInvalid()) return;
    if (!this.buyerReady(this.saleBuyerMode())) return;
    const problem = paymentsError(this.payments, this.saleTotal());
    if (problem) {
      this.payError.set(problem);
      this.focusMissingTendered();
      return;
    }
    this.saving.set(true);
    this.cash
      .counterSale({
        requestKey: this.requestKey,
        clientId: this.saleClient()?.id,
        items: this.saleItems(),
        payments: paymentsValue(this.payments),
        document: this.documentChoice.value,
        buyer: buyerPayload(this.buyer, this.saleBuyerMode(), !!this.saleClient()),
      })
      .subscribe({
        next: ({ receipt, shortages }) => {
          this.saving.set(false);
          this.modal.set(null);
          if (shortages.length)
            this.toast.info(
              `Venta ${receipt.code} registrada. Se usó sin stock registrado: ${shortages
                .map(
                  (s) =>
                    `${formatQty(s.quantity)} ${unitLabel(s.baseUnit, s.quantity)} de ${s.product}`,
                )
                .join(', ')}.`,
            );
          else this.toast.success(`Venta ${receipt.code} registrada.`);
          void this.router.navigate(['/caja/tickets', receipt.id]);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Egresos ──

  /** Motivos frecuentes: un toque llena el motivo (se puede editar) */
  protected readonly expenseReasons = [
    'Agua',
    'Movilidad',
    'Limpieza',
    'Compras menores',
    'Retiro del dueño',
    'Depósito al banco',
  ];
  /** Efectivo que hay en el cajón: un egreso no puede ser mayor */
  protected readonly cashAvailable = computed(() => this.current()?.expectedCash ?? 0);
  private readonly expenseAmount = toSignal(this.expenseForm.controls.amount.valueChanges, {
    initialValue: null,
  });
  protected readonly expenseTooBig = computed(() => {
    const amount = Number(this.expenseAmount());
    return amount > 0 && cents(amount) > cents(this.cashAvailable());
  });

  protected openExpense(): void {
    this.expenseForm.reset({ amount: null, reason: '' });
    this.modal.set('expense');
  }

  protected pickReason(reason: string): void {
    this.expenseForm.controls.reason.setValue(reason);
    this.expenseForm.controls.reason.markAsDirty();
  }

  protected saveExpense(): void {
    if (this.saving()) return;
    if (this.expenseForm.invalid || this.expenseTooBig()) {
      this.expenseForm.markAllAsTouched();
      return;
    }
    const v = this.expenseForm.getRawValue();
    this.saving.set(true);
    this.cash.expense(Number(v.amount), v.reason.trim()).subscribe({
      next: (session) => {
        this.saving.set(false);
        this.modal.set(null);
        this.refreshSession(session);
        this.toast.success('Salida de dinero registrada.');
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected askVoidExpense(movement: SessionSummary['movements'][number]): void {
    this.voidingExpense.set(movement);
    this.voidReason.reset('');
    this.modal.set('void-expense');
  }

  protected confirmVoidExpense(): void {
    const movement = this.voidingExpense();
    if (!movement || this.saving()) return;
    if (this.voidReason.invalid) {
      this.voidReason.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.cash.voidExpense(movement.id, this.voidReason.value.trim()).subscribe({
      next: (session) => {
        this.saving.set(false);
        this.modal.set(null);
        this.refreshSession(session);
        this.toast.success('Salida de dinero anulada.');
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Cierre ──

  protected openClose(): void {
    this.closeForm.reset({ countedCash: null, note: '' });
    this.counting.set(false);
    this.countForm.reset();
    this.modal.set('close');
  }

  protected closeSession(): void {
    const session = this.current();
    if (!session || this.saving()) return;
    if (this.closeForm.invalid) {
      this.closeForm.markAllAsTouched();
      return;
    }
    const v = this.closeForm.getRawValue();
    const diff = this.difference() ?? 0;
    if (diff !== 0 && !v.note.trim()) {
      this.closeForm.controls.note.setErrors({ required: true });
      this.closeForm.controls.note.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.cash.close(session.id, Number(v.countedCash), v.note.trim() || null).subscribe({
      next: (closed) => {
        this.saving.set(false);
        this.modal.set(null);
        this.current.set(null);
        this.pending.set([]);
        this.lastClosed.set(closed);
        this.openForm.reset({ openingAmount: null });
        this.toast.success('Caja cerrada. Puedes imprimir el reporte de cierre.');
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

  private fail(error: unknown): void {
    this.saving.set(false);
    this.toast.error(apiErrorMessage(error));
  }
}
