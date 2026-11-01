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
import { Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { BillingStatus, DocumentChoice, documentOptions } from '../../core/services/billing.models';
import { BillingService } from '../../core/services/billing.service';
import { CashService } from '../../core/services/cash.service';
import { PendingClient, SessionSummary } from '../../core/services/cash.models';
import { CareServicesService } from '../../core/services/care-services.service';
import { ClientSummary } from '../../core/services/clients.models';
import { ClientsService } from '../../core/services/clients.service';
import { CareService } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { Charge, ClientAccount } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import {
  CatalogOption,
  toProductOptions,
  toServiceOptions,
} from '../../shared/catalog/catalog-options';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { DocumentChoiceComponent } from '../../shared/ui/document-choice/document-choice.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import {
  PaymentGroup,
  PaymentLinesComponent,
  paymentForm,
  paymentsError,
  paymentsValue,
} from '../../shared/ui/payment-lines/payment-lines.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { relativeDay } from '../../shared/utils/records';
import { formatQty, money, unitLabel } from '../../shared/utils/stock';
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
@Component({
  selector: 'app-cash-page',
  imports: [
    FechaPipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    PaymentLinesComponent,
    DocumentChoiceComponent,
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
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly billing = inject(BillingService);

  /** ?cobrar=<clientId>: abre el cobro de ese cliente (desde la ficha o la atención) */
  readonly cobrar = input<string>();

  protected readonly money = money;
  protected readonly relativeDay = relativeDay;
  protected readonly isAdmin = this.session.isAdmin;

  /** Facturación electrónica: si está activa, cada cobro elige boleta, factura o nota de venta */
  protected readonly billingStatus = signal<BillingStatus | null>(null);
  protected readonly documentChoice = new FormControl<DocumentChoice>('NOTE', {
    nonNullable: true,
  });
  protected readonly current = signal<SessionSummary | null>(null);
  protected readonly lastClosed = signal<SessionSummary | null>(null);
  protected readonly pending = signal<PendingClient[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly modal = signal<Modal>(null);

  protected readonly openForm = new FormGroup({
    openingAmount: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0),
      Validators.max(100000),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
  });

  protected readonly methodsWithMoney = computed(
    () => this.current()?.byMethod.filter((m) => m.collected || m.refunded) ?? [],
  );

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
    return acc.pending.filter((c) => ids.has(c.id)).reduce((s, c) => s + cents(c.balance), 0) / 100;
  });
  protected readonly collectTotal = computed(() => Number(this.amountValue()) || 0);
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
    toServiceOptions(this.catalog(), this.itemTerm(), 4),
  );
  protected readonly productOptions = toSignal(
    this.itemSearch.valueChanges.pipe(
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
  protected readonly saleLines = new FormArray<SaleLine>([]);
  private readonly saleVersion = signal(0);
  protected readonly saleTotal = computed(() => {
    this.saleVersion();
    return (
      this.saleLines.controls.reduce(
        (s, g) =>
          s + cents((Number(g.controls.quantity.value) || 0) * g.controls.option.value.unitPrice),
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
  protected readonly anonymousTooBig = computed(
    () => !this.saleClient() && this.saleTotal() >= ANONYMOUS_LIMIT,
  );

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
    // Pago parcial: con un solo medio, su monto sigue al monto a cobrar
    this.amount.valueChanges.subscribe((value) => {
      if (this.payments.length === 1)
        this.payments.at(0).controls.amount.setValue(Number(value) || null, { emitEvent: false });
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
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la caja.'));
      },
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
    this.account.set(null);
    this.resetDocument();
    this.requestKey = crypto.randomUUID();
    this.modal.set('collect');
    this.visits.account(clientId).subscribe({
      next: (acc) => {
        this.account.set(acc);
        this.selected.set(new Set(acc.pending.map((c) => c.id)));
        this.amount.setValue(acc.pendingTotal || null);
        this.payments = paymentForm(acc.pendingTotal);
      },
      error: (error: unknown) => {
        this.modal.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected toggleCharge(charge: Charge): void {
    const next = new Set(this.selected());
    if (next.has(charge.id)) next.delete(charge.id);
    else next.add(charge.id);
    this.selected.set(next);
    this.amount.setValue(this.selectedTotal() || null);
    this.payments = paymentForm(this.selectedTotal());
  }

  protected collect(): void {
    const acc = this.account();
    if (!acc || this.saving()) return;
    const total = this.collectTotal();
    if (this.amount.invalid || total <= 0) {
      this.amount.markAsTouched();
      return;
    }
    if (cents(total) > cents(this.selectedTotal())) {
      this.toast.error(`El monto supera lo seleccionado (${money(this.selectedTotal())}).`);
      return;
    }
    const problem = paymentsError(this.payments, total);
    if (problem) {
      this.toast.error(problem);
      return;
    }
    this.saving.set(true);
    const ids = acc.pending.filter((c) => this.selected().has(c.id)).map((c) => c.id);
    this.cash
      .collect({
        requestKey: this.requestKey,
        clientId: acc.client.id,
        chargeIds: ids,
        amount: total,
        payments: paymentsValue(this.payments),
        document: this.documentChoice.value,
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
    this.resetDocument();
    this.saleClient.set(null);
    this.clientSearch.setValue('');
    this.itemSearch.setValue('');
    this.saleLines.clear();
    this.saleVersion.update((v) => v + 1);
    this.payments = paymentForm(0);
    this.modal.set('counter');
  }

  protected pickClient(client: ClientSummary): void {
    this.saleClient.set(client);
    this.clientSearch.setValue('');
  }

  protected addSaleLine(option: CatalogOption): void {
    this.itemSearch.setValue('');
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

  protected removeSaleLine(index: number): void {
    this.saleLines.removeAt(index);
    this.onSaleChange();
  }

  private onSaleChange(): void {
    this.saleVersion.update((v) => v + 1);
    this.payments = paymentForm(this.saleTotal());
  }

  protected lineTotal(g: SaleLine): number {
    return (
      cents((Number(g.controls.quantity.value) || 0) * g.controls.option.value.unitPrice) / 100
    );
  }

  protected sell(): void {
    if (this.saving()) return;
    if (!this.saleLines.length || this.saleLines.invalid) {
      this.saleLines.markAllAsTouched();
      this.toast.error('Agrega al menos un producto o servicio con su cantidad.');
      return;
    }
    if (this.saleLines.controls.some((g) => g.controls.option.value.controlled)) {
      this.toast.error('Un controlado se registra en la atención del paciente, con su receta.');
      return;
    }
    if (this.anonymousTooBig()) return;
    const problem = paymentsError(this.payments, this.saleTotal());
    if (problem) {
      this.toast.error(problem);
      return;
    }
    this.saving.set(true);
    this.cash
      .counterSale({
        requestKey: this.requestKey,
        clientId: this.saleClient()?.id,
        items: this.saleLines.getRawValue().map((l) => ({
          careServiceId: l.option.careServiceId,
          productId: l.option.productId,
          presentationId: l.option.presentationId,
          quantity: Number(l.quantity),
        })),
        payments: paymentsValue(this.payments),
        document: this.documentChoice.value,
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

  protected openExpense(): void {
    this.expenseForm.reset({ amount: null, reason: '' });
    this.modal.set('expense');
  }

  protected saveExpense(): void {
    if (this.saving()) return;
    if (this.expenseForm.invalid) {
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
        this.toast.success('Egreso registrado.');
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
        this.toast.success('Egreso anulado.');
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Cierre ──

  protected openClose(): void {
    this.closeForm.reset({ countedCash: null, note: '' });
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
        this.toast.success('Caja cerrada.');
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
