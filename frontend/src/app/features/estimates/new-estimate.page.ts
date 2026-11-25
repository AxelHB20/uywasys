import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { CareServicesService } from '../../core/services/care-services.service';
import { EstimatesService } from '../../core/services/estimates.service';
import { CareService } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import {
  CatalogOption,
  toProductOptions,
  toServiceOptions,
} from '../../shared/catalog/catalog-options';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PetPickerComponent, PickedPet } from '../../shared/ui/pet-picker/pet-picker.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { addDays } from '../../core/services/medical.models';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';

interface Line {
  key: number;
  option: CatalogOption;
  quantity: number;
  discount: number;
}

const VALIDITY = [7, 15, 30];

/**
 * Armar un presupuesto en tres pasos (paciente, detalle, servicios y productos) con el resumen
 * siempre a la vista: subtotal, descuentos, total y lo que falta para emitirlo.
 */
@Component({
  selector: 'app-new-estimate-page',
  imports: [BackLinkComponent, ReactiveFormsModule, IconComponent, PetPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-estimate.page.html',
})
export class NewEstimatePage implements OnInit {
  private readonly api = inject(EstimatesService);
  private readonly services = inject(CareServicesService);
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // ?petId=…&mascota=…&cliente=…
  readonly petId = input<string>();
  readonly mascota = input<string>();
  readonly cliente = input<string>();

  protected readonly money = money;
  protected readonly validity = VALIDITY;
  protected readonly pet = signal<PickedPet | null>(null);
  protected readonly petMissing = signal(false);
  protected readonly saving = signal(false);
  protected readonly lines = signal<Line[]>([]);
  private nextKey = 1;

  protected readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(150)],
    }),
    validDays: new FormControl(15, { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
  });
  private readonly validDays = toSignal(this.form.controls.validDays.valueChanges, {
    initialValue: 15,
  });
  protected readonly until = computed(() =>
    formatDate(addDays(limaToday(), this.validDays()), 'calendar'),
  );

  // Catálogo
  private readonly catalog = signal<CareService[]>([]);
  protected readonly search = new FormControl('', { nonNullable: true });
  private readonly term = toSignal(this.search.valueChanges, { initialValue: '' });
  private readonly productOptions = toSignal(
    this.search.valueChanges.pipe(
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
  protected readonly options = computed(() =>
    this.term().trim().length < 2
      ? []
      : [
          ...toServiceOptions(
            this.catalog().filter((s) => s.category !== 'GROOMING'),
            this.term(),
          ),
          ...this.productOptions(),
        ],
  );

  protected readonly totals = computed(() => {
    let gross = 0;
    let discount = 0;
    for (const l of this.lines()) {
      gross += this.gross(l);
      discount += l.discount || 0;
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    return { gross: r(gross), discount: r(discount), total: r(gross - discount) };
  });
  /** Opción resaltada con el teclado en la lista de resultados */
  protected readonly active = signal(0);
  protected readonly searchOpen = computed(() => this.options().length > 0);
  protected readonly checklist = computed(() => [
    { label: 'Paciente', done: !!this.pet() },
    { label: 'Título', done: this.titleOk() },
    { label: 'Al menos un servicio o producto', done: this.lines().length > 0 },
  ]);
  private readonly titleValue = toSignal(this.form.controls.title.valueChanges, {
    initialValue: '',
  });
  private readonly titleOk = computed(() => this.titleValue().trim().length >= 3);
  protected readonly ready = computed(
    () => this.checklist().every((c) => c.done) && !this.invalidLines(),
  );

  protected readonly invalidLines = computed(() =>
    this.lines().some((l) => !(l.quantity > 0) || l.discount < 0 || l.discount > this.gross(l)),
  );

  ngOnInit(): void {
    this.services.list('active').subscribe({
      next: (list) => this.catalog.set(list),
      error: () => this.catalog.set([]),
    });
    const id = Number(this.petId());
    if (id && this.mascota())
      this.pet.set({ petId: id, petName: this.mascota()!, clientName: this.cliente() ?? '' });
  }

  protected gross(l: Line): number {
    return Math.round((l.quantity || 0) * l.option.unitPrice * 100) / 100;
  }

  protected lineTotal(l: Line): number {
    return Math.max(0, Math.round((this.gross(l) - (l.discount || 0)) * 100) / 100);
  }

  protected add(option: CatalogOption): void {
    // El mismo ítem otra vez suma cantidad en vez de duplicar la línea
    const existing = this.lines().find((l) => l.option.key === option.key);
    if (existing) this.step(existing.key, 1);
    else
      this.lines.update((list) => [
        ...list,
        { key: this.nextKey++, option, quantity: 1, discount: 0 },
      ]);
    this.search.setValue('');
    this.active.set(0);
  }

  protected step(key: number, delta: number): void {
    this.lines.update((list) =>
      list.map((l) =>
        l.key === key ? { ...l, quantity: Math.max(1, Math.round((l.quantity || 0) + delta)) } : l,
      ),
    );
  }

  /** Flechas, Enter y Escape en el buscador */
  protected onSearchKey(event: KeyboardEvent): void {
    const count = this.options().length;
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.active.set((this.active() + delta + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.add(this.options()[Math.min(this.active(), count - 1)]);
    } else if (event.key === 'Escape') {
      this.search.setValue('');
    }
  }

  protected remove(key: number): void {
    this.lines.update((list) => list.filter((l) => l.key !== key));
  }

  protected setQty(key: number, value: string): void {
    this.lines.update((list) =>
      list.map((l) => (l.key === key ? { ...l, quantity: Number(value) } : l)),
    );
  }

  protected setDiscount(key: number, value: string): void {
    this.lines.update((list) =>
      list.map((l) => (l.key === key ? { ...l, discount: Number(value) || 0 } : l)),
    );
  }

  protected bad(name: 'title'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected submit(): void {
    if (this.saving()) return;
    const pet = this.pet();
    if (!pet) this.petMissing.set(true);
    this.form.markAllAsTouched();
    if (!pet || this.form.invalid || this.invalidLines() || !this.lines().length) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.api
      .create({
        petId: pet.petId,
        title: v.title.trim(),
        validDays: v.validDays,
        notes: v.notes.trim() || null,
        items: this.lines().map((l) => ({
          careServiceId: l.option.careServiceId,
          productId: l.option.productId,
          presentationId: l.option.presentationId,
          quantity: l.quantity,
          discount: l.discount || 0,
        })),
      })
      .subscribe({
        next: (e) => {
          this.toast.success(`Presupuesto ${e.code} emitido.`);
          void this.router.navigate(['/presupuestos', e.id], { replaceUrl: true });
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }
}
