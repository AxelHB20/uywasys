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
import { Router, RouterLink } from '@angular/router';
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

interface Line {
  key: number;
  option: CatalogOption;
  quantity: number;
  discount: number;
}

const VALIDITY = [7, 15, 30];

/** Armar un presupuesto: paciente, título, vigencia y líneas del catálogo con su descuento. */
@Component({
  selector: 'app-new-estimate-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, PetPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <a
        routerLink="/presupuestos"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <app-icon name="chevron-left" class="size-4" /> Presupuestos
      </a>
      <header>
        <h1 class="font-display text-2xl font-semibold text-slate-900">Nuevo presupuesto</h1>
        <p class="mt-1 text-sm text-slate-600">
          Con los precios del catálogo. El precio presupuestado se respeta al cargarlo, aunque el
          catálogo cambie.
        </p>
      </header>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-start">
        <div class="min-w-0 space-y-6">
          <!-- Datos -->
          <section class="card space-y-4 p-5 sm:p-6" aria-labelledby="est-data">
            <h2 id="est-data" class="font-display text-lg font-semibold text-slate-900">Datos</h2>
            <div>
              <span class="field-label"
                >Paciente <span class="text-rose-600" aria-hidden="true">*</span></span
              >
              <div class="mt-1.5">
                @if (pet(); as p) {
                  <div
                    class="flex items-center gap-3 rounded-xl bg-anil-50 p-3 ring-1 ring-anil-200"
                  >
                    <app-icon name="paw" class="size-5 shrink-0 text-anil-700" />
                    <div class="min-w-0 flex-1">
                      <p class="font-medium text-slate-900">{{ p.petName }}</p>
                      <p class="truncate text-sm text-slate-600">{{ p.clientName }}</p>
                    </div>
                    <button type="button" class="btn btn-ghost h-10 px-3" (click)="pet.set(null)">
                      Cambiar
                    </button>
                  </div>
                } @else {
                  <app-pet-picker
                    inputId="est-pet"
                    [invalid]="petMissing()"
                    (picked)="pet.set($event); petMissing.set(false)"
                  />
                }
              </div>
              @if (petMissing()) {
                <p class="field-error">Elige el paciente</p>
              }
            </div>
            <form [formGroup]="form" class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <label for="est-title" class="field-label"
                  >Título <span class="text-rose-600" aria-hidden="true">*</span></label
                >
                <input
                  id="est-title"
                  formControlName="title"
                  class="field-input"
                  maxlength="150"
                  autocomplete="off"
                  placeholder="Ej.: Castración canina con exámenes prequirúrgicos"
                  [attr.aria-invalid]="bad('title')"
                />
                @if (bad('title')) {
                  <p class="field-error">Escribe el título (mínimo 3 letras)</p>
                }
              </div>
              <div>
                <span id="est-validity" class="field-label">Vigencia</span>
                <div
                  class="mt-1.5 inline-flex h-11 rounded-xl bg-slate-100 p-1"
                  role="radiogroup"
                  aria-labelledby="est-validity"
                >
                  @for (d of validity; track d) {
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="form.controls.validDays.value === d"
                      class="rounded-lg px-3.5 text-sm font-medium transition-colors"
                      [class]="
                        form.controls.validDays.value === d
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      "
                      (click)="form.controls.validDays.setValue(d)"
                    >
                      {{ d }} días
                    </button>
                  }
                </div>
              </div>
              <div class="sm:col-span-2">
                <label for="est-notes" class="field-label">Notas para el dueño</label>
                <textarea
                  id="est-notes"
                  formControlName="notes"
                  rows="2"
                  maxlength="1000"
                  class="field-input h-auto py-2.5"
                  placeholder="Ej.: incluye anestesia y control post operatorio. Ayuno de 12 horas."
                ></textarea>
              </div>
            </form>
          </section>

          <!-- Líneas -->
          <section class="card p-5 sm:p-6" aria-labelledby="est-lines">
            <h2 id="est-lines" class="font-display text-lg font-semibold text-slate-900">
              Servicios y productos
            </h2>
            <div class="relative mt-4">
              <label for="est-search" class="sr-only">Buscar servicio o producto</label>
              <app-icon
                name="search"
                class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="est-search"
                type="search"
                [formControl]="search"
                class="field-input mt-0 pl-10"
                placeholder="Agregar: busca un servicio o producto"
                autocomplete="off"
                role="combobox"
                aria-controls="est-results"
                [attr.aria-expanded]="options().length > 0"
              />
              @if (options().length) {
                <ul
                  id="est-results"
                  role="listbox"
                  class="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200"
                >
                  @for (o of options(); track o.key) {
                    <li role="option" aria-selected="false">
                      <button
                        type="button"
                        class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50"
                        (click)="add(o)"
                      >
                        <span class="min-w-0">
                          <span class="block truncate font-medium text-slate-900">{{
                            o.description
                          }}</span>
                          <span class="block truncate text-xs text-slate-500">
                            {{ o.kind === 'SERVICE' ? 'Servicio' : 'Producto' }}
                            @if (o.detail) {
                              · {{ o.detail }}
                            }
                          </span>
                        </span>
                        <span class="shrink-0 text-sm text-slate-600 tabular-nums">{{
                          money(o.unitPrice)
                        }}</span>
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>

            @if (lines().length) {
              <div class="mt-4 overflow-x-auto">
                <table class="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr
                      class="border-b border-slate-200 text-left text-xs text-slate-500 uppercase"
                    >
                      <th scope="col" class="py-2 pr-3 font-medium">Descripción</th>
                      <th scope="col" class="w-20 py-2 pr-3 font-medium">Cant.</th>
                      <th scope="col" class="w-24 py-2 pr-3 text-right font-medium">Precio</th>
                      <th scope="col" class="w-28 py-2 pr-3 font-medium">Descuento</th>
                      <th scope="col" class="w-24 py-2 text-right font-medium">Importe</th>
                      <th scope="col" class="w-10 py-2"><span class="sr-only">Quitar</span></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (l of lines(); track l.key; let i = $index) {
                      <tr class="align-middle">
                        <td class="py-2.5 pr-3">
                          <p class="font-medium text-slate-900">{{ l.option.description }}</p>
                          @if (l.option.controlled) {
                            <p class="text-xs text-rose-700">
                              Lleva controlado: al cargarlo pide receta
                            </p>
                          }
                        </td>
                        <td class="py-2.5 pr-3">
                          <label [for]="'est-qty-' + i" class="sr-only">Cantidad</label>
                          <input
                            [id]="'est-qty-' + i"
                            type="number"
                            inputmode="decimal"
                            min="1"
                            step="1"
                            class="field-input mt-0 h-10 tabular-nums"
                            [value]="l.quantity"
                            (input)="setQty(l.key, $any($event.target).value)"
                            [attr.aria-invalid]="!(l.quantity > 0)"
                          />
                        </td>
                        <td class="py-2.5 pr-3 text-right text-slate-600 tabular-nums">
                          {{ money(l.option.unitPrice) }}
                        </td>
                        <td class="py-2.5 pr-3">
                          <label [for]="'est-disc-' + i" class="sr-only">Descuento en soles</label>
                          <input
                            [id]="'est-disc-' + i"
                            type="number"
                            inputmode="decimal"
                            min="0"
                            step="0.5"
                            class="field-input mt-0 h-10 tabular-nums"
                            placeholder="0.00"
                            [value]="l.discount || ''"
                            (input)="setDiscount(l.key, $any($event.target).value)"
                            [attr.aria-invalid]="l.discount > gross(l)"
                          />
                        </td>
                        <td class="py-2.5 text-right font-medium text-slate-900 tabular-nums">
                          {{ money(lineTotal(l)) }}
                        </td>
                        <td class="py-2.5 pl-1">
                          <button
                            type="button"
                            class="grid size-10 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            [attr.aria-label]="'Quitar ' + l.option.description"
                            (click)="remove(l.key)"
                          >
                            <app-icon name="x" class="size-4" />
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p
                class="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200"
              >
                Busca los servicios y productos que incluye: cirugía, anestesia, exámenes,
                medicación, hospitalización…
              </p>
            }
          </section>
        </div>

        <!-- Resumen -->
        <aside class="card p-5 lg:sticky lg:top-6" aria-labelledby="est-summary">
          <h2 id="est-summary" class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Resumen
          </h2>
          <dl class="mt-3 space-y-2 text-sm">
            <div class="flex justify-between">
              <dt class="text-slate-600">Subtotal</dt>
              <dd class="text-slate-900 tabular-nums">{{ money(totals().gross) }}</dd>
            </div>
            @if (totals().discount) {
              <div class="flex justify-between">
                <dt class="text-slate-600">Descuentos</dt>
                <dd class="text-emerald-700 tabular-nums">− {{ money(totals().discount) }}</dd>
              </div>
            }
            <div class="flex items-baseline justify-between border-t border-slate-100 pt-3">
              <dt class="font-medium text-slate-900">Total</dt>
              <dd class="font-display text-2xl font-semibold text-slate-900 tabular-nums">
                {{ money(totals().total) }}
              </dd>
            </div>
          </dl>
          <p class="mt-1 text-right text-xs text-slate-500">Precios con IGV</p>
          <p class="mt-4 text-sm text-slate-600">
            Vence el <span class="font-medium text-slate-900">{{ until() }}</span>
          </p>
          @if (invalidLines()) {
            <p class="field-error">Revisa cantidades y descuentos</p>
          }
          <button
            type="button"
            class="btn btn-primary mt-4 w-full"
            [disabled]="saving() || !lines().length"
            (click)="submit()"
          >
            @if (saving()) {
              <app-icon name="loader" class="size-4 animate-spin" />
            }
            Emitir presupuesto
          </button>
        </aside>
      </div>
    </section>
  `,
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
          : this.inventory.list({ q }).pipe(
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
      : [...toServiceOptions(this.catalog(), this.term()), ...this.productOptions()],
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
    this.lines.update((list) => [
      ...list,
      { key: this.nextKey++, option, quantity: 1, discount: 0 },
    ]);
    this.search.setValue('');
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
          void this.router.navigate(['/presupuestos', e.id]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }
}
