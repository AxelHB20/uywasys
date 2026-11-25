import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { Supplier } from '../../core/services/purchases.models';
import { PurchasesService } from '../../core/services/purchases.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate } from '../../shared/utils/dates';
import { formatPhone, whatsappLink } from '../../shared/utils/peru';
import { loaded } from '../../shared/utils/resource';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { InventoryTabsComponent } from '../inventory/inventory-tabs.component';
import { SupplierFormComponent } from './supplier-form.component';

/** Proveedores de la clínica: a quién se le compra, su RUC y contacto, y cuánto se le compró. */
@Component({
  selector: 'app-suppliers-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    ModalComponent,
    InventoryTabsComponent,
    SupplierFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './suppliers.page.html',
})
export class SuppliersPage {
  private readonly api = inject(PurchasesService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);

  protected readonly money = money;
  protected readonly isAdmin = computed(() => this.session.role() === 'ADMIN');
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly q = signal('');
  protected readonly showInactive = signal(false);

  protected readonly list = rxResource({
    params: () => ({ q: this.q() || undefined, all: true }),
    stream: ({ params }) => this.api.suppliers(params),
  });
  protected readonly data = loaded(this.list);
  protected readonly all = computed(() => this.data() ?? []);
  protected readonly inactiveCount = computed(() => this.all().filter((s) => !s.active).length);
  protected readonly items = computed(() =>
    this.showInactive() ? this.all() : this.all().filter((s) => s.active),
  );

  // Crear / editar
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Supplier | null>(null);

  // Unir repetidos (administrador)
  protected readonly merging = signal<Supplier | null>(null);
  protected readonly mergeInto = new FormControl<number | null>(null, Validators.required);
  protected readonly mergeError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly mergeOptions = computed(() => {
    const from = this.merging();
    return this.all().filter((s) => s.id !== from?.id);
  });

  constructor() {
    this.search.valueChanges
      .pipe(
        map((v) => v.trim()),
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((q) => this.q.set(q));
  }

  protected phone(s: Supplier): string {
    return s.phone ? formatPhone(s.phone) : '';
  }

  /** Solo los celulares (9 dígitos que empiezan en 9) se abren en WhatsApp */
  protected whatsapp(s: Supplier): string | null {
    const digits = s.phone?.replace(/^\+?51/, '') ?? '';
    return /^9\d{8}$/.test(digits) ? whatsappLink(digits) : null;
  }

  protected last(s: Supplier): string {
    return s.lastPurchaseAt ? formatDate(s.lastPurchaseAt, 'calendar') : '';
  }

  protected create(): void {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  protected edit(s: Supplier): void {
    this.editing.set(s);
    this.formOpen.set(true);
  }

  protected saved(s: Supplier): void {
    const wasEditing = !!this.editing();
    this.formOpen.set(false);
    this.editing.set(null);
    this.list.reload();
    this.toast.success(wasEditing ? `${s.name} actualizado` : `Proveedor ${s.name} agregado`);
  }

  protected openMerge(s: Supplier): void {
    this.merging.set(s);
    this.mergeInto.reset(null);
    this.mergeError.set(null);
  }

  protected confirmMerge(): void {
    const from = this.merging();
    const into = this.mergeInto.value;
    if (!from || !into || this.saving()) {
      this.mergeInto.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.mergeError.set(null);
    this.api
      .mergeSupplier(from.id, into)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (kept) => {
          this.merging.set(null);
          this.list.reload();
          this.toast.success(`${from.name} quedó unido a ${kept.name}`);
        },
        error: (error) =>
          this.mergeError.set(apiErrorMessage(error, 'No se pudieron unir los proveedores')),
      });
  }

  protected closeMerge(): void {
    if (!this.saving()) this.merging.set(null);
  }
}
