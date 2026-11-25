import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { CATEGORY_LABELS, ProductSummary } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

interface Used {
  name: string;
  label: string;
}

/**
 * Insumos usados en una atención, sin cobrar (una venda más, guantes, algodón): salen del
 * inventario como "uso interno" anotado a la mascota. Los controlados tienen su propio registro.
 */
@Component({
  selector: 'app-used-supplies',
  imports: [ReactiveFormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      title="Insumos usados (sin cobrar)"
      description="Salen del inventario y quedan anotados para este paciente. No se le cobran."
      [dismissible]="false"
      (closed)="close()"
    >
      @if (picked(); as p) {
        <div class="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <app-icon name="package" class="size-5 shrink-0 text-slate-500" />
          <div class="min-w-0 flex-1">
            <p class="font-medium text-slate-900">{{ p.name }}</p>
            <p class="text-sm text-slate-500">
              Hay {{ qty(p.totalStock) }} {{ unit(p, p.totalStock) }}
            </p>
          </div>
          <button type="button" class="btn btn-ghost h-10 px-3" (click)="picked.set(null)">
            Cambiar
          </button>
        </div>
        <form
          id="used-supplies-form"
          class="mt-4 grid grid-cols-2 gap-3"
          (submit)="$event.preventDefault(); save()"
          novalidate
        >
          <div>
            <label for="us-qty" class="field-label">Cantidad</label>
            <input
              id="us-qty"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              [formControl]="quantity"
              class="field-input tabular-nums"
              [attr.aria-invalid]="quantity.touched && quantity.invalid"
            />
          </div>
          <div>
            <label for="us-unit" class="field-label">En</label>
            <select id="us-unit" [formControl]="unitChoice" class="field-input">
              <option value="base">{{ unit(p, 2) }}</option>
              @for (pr of bigPresentations(); track pr.id) {
                <option [value]="pr.id">
                  {{ pr.name }} ({{ qty(pr.factor) }} {{ unit(p, pr.factor) }})
                </option>
              }
            </select>
          </div>
          @if (quantity.touched && quantity.invalid) {
            <p class="field-error col-span-2">Indica una cantidad mayor a 0</p>
          }
        </form>
      } @else {
        <div class="relative">
          <label for="us-search" class="sr-only">Buscar insumo</label>
          <app-icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-slate-400"
          />
          <input
            id="us-search"
            type="search"
            [formControl]="search"
            class="field-input mt-0 pl-10"
            autocomplete="off"
            placeholder="Busca el insumo: guantes, gasa, jeringa…"
          />
        </div>
        <ul class="mt-2 space-y-1" aria-live="polite">
          @for (p of results(); track p.id) {
            <li>
              <button
                type="button"
                class="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-anil-50"
                (click)="pick(p)"
              >
                <span class="min-w-0">
                  <span class="block font-medium text-slate-900">{{ p.name }}</span>
                  <span class="block text-xs text-slate-500">{{ categories[p.category] }}</span>
                </span>
                <span class="shrink-0 text-xs text-slate-500 tabular-nums"
                  >{{ qty(p.totalStock) }} {{ unit(p, p.totalStock) }}</span
                >
              </button>
            </li>
          }
        </ul>
        @if (searched() && !results().length) {
          <p class="py-2 text-sm text-slate-500">No encontramos «{{ search.value }}».</p>
        }
      }

      @if (done().length) {
        <div
          class="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200"
        >
          <p class="font-medium">Anotado en esta atención</p>
          <ul class="mt-1 space-y-0.5">
            @for (d of done(); track $index) {
              <li class="flex items-center gap-2">
                <app-icon name="check" class="size-4 text-emerald-600" /> {{ d.label }} de
                {{ d.name }}
              </li>
            }
          </ul>
        </div>
      }

      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="close()">
          {{ done().length ? 'Listo' : 'Volver' }}
        </button>
        @if (picked()) {
          <button
            type="submit"
            form="used-supplies-form"
            class="btn btn-primary"
            [disabled]="saving()"
          >
            {{ saving() ? 'Guardando…' : 'Anotar sin cobrar' }}
          </button>
        }
      </ng-container>
    </app-modal>
  `,
})
export class UsedSuppliesComponent {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly petId = input.required<number>();
  readonly petName = input.required<string>();
  readonly closed = output<void>();

  protected readonly categories = CATEGORY_LABELS;
  protected readonly qty = formatQty;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly quantity = new FormControl<number | null>(1, [
    Validators.required,
    Validators.min(0.001),
  ]);
  protected readonly unitChoice = new FormControl('base', { nonNullable: true });
  protected readonly picked = signal<ProductSummary | null>(null);
  protected readonly saving = signal(false);
  protected readonly done = signal<Used[]>([]);
  protected readonly searched = signal(false);

  protected readonly results = toSignal(
    this.search.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) => {
        this.searched.set(q.length >= 2);
        return q.length < 2
          ? of<ProductSummary[]>([])
          : this.inventory.list({ q }).pipe(
              // Los controlados piden receta y colegiatura: van por su propio registro
              map((page) => page.items.filter((p) => !p.controlled).slice(0, 6)),
              catchError(() => of<ProductSummary[]>([])),
            );
      }),
    ),
    { initialValue: [] as ProductSummary[] },
  );

  /** Las presentaciones grandes (caja, frasco) además de la unidad mínima */
  protected readonly bigPresentations = computed(
    () => this.picked()?.presentations.filter((pr) => pr.factor > 1) ?? [],
  );

  protected unit(p: ProductSummary, n: number): string {
    return unitLabel(p.baseUnit, n);
  }

  protected pick(p: ProductSummary): void {
    this.picked.set(p);
    this.quantity.reset(1);
    this.unitChoice.setValue('base');
  }

  protected save(): void {
    const p = this.picked();
    if (!p || this.saving()) return;
    if (this.quantity.invalid) {
      this.quantity.markAsTouched();
      return;
    }
    const quantity = Number(this.quantity.value);
    const choice = this.unitChoice.value;
    const presentation =
      choice === 'base' ? null : (p.presentations.find((pr) => String(pr.id) === choice) ?? null);
    this.saving.set(true);
    this.inventory
      .outflow(p.id, {
        type: 'TREATMENT',
        quantity,
        presentationId: presentation?.id ?? null,
        batchId: null,
        reason: `Usado en la atención de ${this.petName()}`.slice(0, 200),
        petId: this.petId(),
        prescriptionRef: null,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          const label = presentation
            ? `${formatQty(quantity)} × ${presentation.name}`
            : `${formatQty(quantity)} ${unitLabel(p.baseUnit, quantity)}`;
          this.done.update((d) => [...d, { name: p.name, label }]);
          this.toast.success('Anotado. Salió del inventario sin cobrar.');
          this.picked.set(null);
          this.search.setValue('');
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  protected close(): void {
    this.picked.set(null);
    this.search.setValue('');
    this.done.set([]);
    this.closed.emit();
  }
}
