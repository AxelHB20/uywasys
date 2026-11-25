import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import {
  ClinicalTemplate,
  ClinicalTemplatesService,
  PrescriptionContent,
} from '../../core/services/clinical-templates.service';
import { ProductDetail } from '../../core/services/inventory.models';
import { SaveTemplateComponent } from '../templates/save-template.component';
import { TemplatePickerComponent } from '../templates/template-picker.component';
import { InventoryService } from '../../core/services/inventory.service';
import {
  DURATION_OPTIONS,
  FREQUENCY_OPTIONS,
  suggestedUnits,
  PrescriptionPrint,
  ROUTE_OPTIONS,
} from '../../core/services/medical.models';
import { PrescriptionsService } from '../../core/services/prescriptions.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, money, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

/** Un medicamento del inventario, en una de sus presentaciones */
interface DrugOption {
  key: string;
  productId: number;
  presentationId: number;
  drug: string;
  presentation: string;
  price: number;
  stock: string;
  controlled: boolean;
  /** Unidades base que trae (tableta = 1, caja de 100 = 100) */
  factor: number;
}

type ItemGroup = FormGroup<{
  productId: FormControl<number | null>;
  presentationId: FormControl<number | null>;
  presentation: FormControl<string>;
  price: FormControl<number>;
  controlled: FormControl<boolean>;
  factor: FormControl<number>;
  drug: FormControl<string>;
  dose: FormControl<string>;
  route: FormControl<string>;
  frequency: FormControl<string>;
  duration: FormControl<string>;
  instructions: FormControl<string>;
  dispense: FormControl<boolean>;
  quantity: FormControl<number | null>;
}>;

const text = (max: number, required = false) =>
  new FormControl('', {
    nonNullable: true,
    validators: required
      ? [Validators.required, Validators.maxLength(max)]
      : [Validators.maxLength(max)],
  });

/**
 * Nueva receta: medicamentos del inventario (se pueden entregar en la clínica y se cargan a la
 * cuenta) o escritos a mano (para comprar en farmacia). Cada uno con dosis, vía, frecuencia
 * y duración.
 */
@Component({
  selector: 'app-prescription-form',
  imports: [ReactiveFormsModule, IconComponent, TemplatePickerComponent, SaveTemplateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="space-y-4">
      <!-- Recetas frecuentes: un clic llena los medicamentos -->
      @if (frequent().length) {
        <div>
          <p id="rx-frequent-label" class="text-sm font-medium text-slate-800">
            Recetas frecuentes
          </p>
          <div class="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="rx-frequent-label">
            @for (t of frequent().slice(0, 5); track t.id) {
              <button
                type="button"
                class="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-anil-50 px-3.5 text-sm font-medium text-anil-800 ring-1 ring-anil-200 transition-colors hover:bg-anil-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anil-500 disabled:opacity-60"
                [disabled]="applying()"
                (click)="applyRx(t)"
                [attr.aria-label]="'Usar receta frecuente ' + t.name"
              >
                <app-icon name="pill" class="size-3.5" /> {{ t.name }}
              </button>
            }
            @if (frequent().length > 5) {
              <button
                type="button"
                class="inline-flex min-h-10 items-center rounded-full px-3.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                (click)="picking.set(true)"
              >
                Ver todas ({{ frequent().length }})
              </button>
            }
          </div>
        </div>
      }

      <!-- Buscar o escribir el medicamento -->
      <div class="relative">
        <label for="rx-search" class="field-label">Agregar medicamento</label>
        <div class="relative mt-1.5">
          <app-icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-500"
          />
          <input
            id="rx-search"
            type="search"
            [formControl]="search"
            class="field-input mt-0 pl-10"
            placeholder="Busca en el inventario o escribe el nombre y presiona Enter"
            autocomplete="off"
            maxlength="150"
            (keydown.enter)="$event.preventDefault(); addFree()"
            role="combobox"
            aria-controls="rx-results"
            [attr.aria-expanded]="options().length > 0"
          />
        </div>
        @if (search.value.trim().length >= 2) {
          <ul
            id="rx-results"
            role="listbox"
            class="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200"
          >
            @for (o of options(); track o.key) {
              <li role="option" aria-selected="false">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50"
                  (click)="addProduct(o)"
                >
                  <span class="min-w-0">
                    <span class="block font-medium text-slate-900">
                      {{ o.drug }}
                      @if (o.controlled) {
                        <span
                          class="ml-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700"
                          >Controlado</span
                        >
                      }
                    </span>
                    <span class="block text-xs text-slate-500"
                      >{{ o.presentation }} · {{ o.stock }}</span
                    >
                  </span>
                  <span class="shrink-0 text-sm text-slate-600 tabular-nums">{{
                    money(o.price)
                  }}</span>
                </button>
              </li>
            }
            <li role="option" aria-selected="false">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-anil-700 hover:bg-anil-50"
                (click)="addFree()"
              >
                <app-icon name="plus" class="size-4" />
                Recetar «{{ search.value.trim() }}» (para comprar en farmacia)
              </button>
            </li>
          </ul>
        }
      </div>

      @if (items.length) {
        <ol class="space-y-3">
          @for (g of items.controls; track g; let i = $index) {
            <li class="rounded-2xl bg-white p-4 ring-1 ring-slate-200" [formGroup]="g">
              <div class="flex items-start gap-3">
                <span
                  class="grid size-7 shrink-0 place-items-center rounded-lg bg-anil-600 font-display text-xs font-bold text-white"
                  aria-hidden="true"
                  >{{ i + 1 }}</span
                >
                <div class="min-w-0 flex-1">
                  @if (g.controls.productId.value) {
                    <p class="font-semibold text-slate-900">
                      {{ g.controls.drug.value }}
                      @if (g.controls.controlled.value) {
                        <span
                          class="ml-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700"
                          >Controlado · receta retenida</span
                        >
                      }
                    </p>
                    <p class="text-xs text-slate-500">Del inventario</p>
                  } @else {
                    <label [for]="'rx-drug-' + i" class="sr-only">Medicamento</label>
                    <input
                      [id]="'rx-drug-' + i"
                      formControlName="drug"
                      class="field-input mt-0 h-10 font-semibold"
                      maxlength="150"
                      [attr.aria-invalid]="bad(g.controls.drug)"
                    />
                  }
                </div>
                <button
                  type="button"
                  class="grid size-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                  [attr.aria-label]="'Quitar ' + g.controls.drug.value"
                  (click)="items.removeAt(i)"
                >
                  <app-icon name="x" class="size-4" />
                </button>
              </div>

              <div
                class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.6fr)_minmax(0,0.9fr)]"
              >
                <div>
                  <label [for]="'rx-dose-' + i" class="field-label">
                    Dosis <span class="text-rose-600" aria-hidden="true">*</span>
                  </label>
                  <input
                    [id]="'rx-dose-' + i"
                    formControlName="dose"
                    class="field-input"
                    maxlength="80"
                    placeholder="1 tableta"
                    [attr.aria-invalid]="bad(g.controls.dose)"
                  />
                </div>
                <div>
                  <label [for]="'rx-route-' + i" class="field-label">Vía</label>
                  <input
                    [id]="'rx-route-' + i"
                    formControlName="route"
                    class="field-input"
                    maxlength="40"
                    list="rx-routes"
                  />
                </div>
                <div>
                  <label [for]="'rx-freq-' + i" class="field-label">
                    Frecuencia <span class="text-rose-600" aria-hidden="true">*</span>
                  </label>
                  <input
                    [id]="'rx-freq-' + i"
                    formControlName="frequency"
                    class="field-input"
                    maxlength="60"
                    list="rx-frequencies"
                    [attr.aria-invalid]="bad(g.controls.frequency)"
                  />
                </div>
                <div>
                  <label [for]="'rx-dur-' + i" class="field-label">
                    Duración <span class="text-rose-600" aria-hidden="true">*</span>
                  </label>
                  <input
                    [id]="'rx-dur-' + i"
                    formControlName="duration"
                    class="field-input"
                    maxlength="60"
                    list="rx-durations"
                    [attr.aria-invalid]="bad(g.controls.duration)"
                  />
                </div>
              </div>
              @if (bad(g.controls.dose) || bad(g.controls.frequency) || bad(g.controls.duration)) {
                <p class="field-error">Completa dosis, frecuencia y duración</p>
              }
              <label [for]="'rx-ins-' + i" class="sr-only">Indicaciones</label>
              <input
                [id]="'rx-ins-' + i"
                formControlName="instructions"
                class="field-input mt-3"
                maxlength="300"
                placeholder="Indicaciones: con comida, partir la tableta…"
              />

              @if (g.controls.productId.value) {
                <div
                  class="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200"
                >
                  <label
                    class="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      formControlName="dispense"
                      class="size-4 accent-anil-600"
                    />
                    Se entrega en la clínica
                  </label>
                  @if (g.controls.dispense.value) {
                    <div class="flex items-center gap-2">
                      <label [for]="'rx-qty-' + i" class="sr-only">Cantidad</label>
                      <input
                        [id]="'rx-qty-' + i"
                        type="number"
                        inputmode="decimal"
                        step="1"
                        min="1"
                        formControlName="quantity"
                        class="field-input mt-0 h-10 w-20 tabular-nums"
                        [attr.aria-invalid]="bad(g.controls.quantity)"
                      />
                      <span class="text-sm text-slate-600">
                        × {{ g.controls.presentation.value }}
                        <span class="tabular-nums">
                          = {{ money((g.controls.quantity.value ?? 0) * g.controls.price.value) }}
                        </span>
                      </span>
                    </div>
                    @if (suggestion(g); as s) {
                      <p class="mt-1 basis-full text-xs text-slate-500 tabular-nums">
                        @if (g.controls.quantity.dirty) {
                          Según la receta: {{ s.text }}.
                          <button
                            type="button"
                            class="font-medium text-anil-700 hover:text-anil-900"
                            (click)="
                              g.controls.quantity.setValue(s.packs);
                              g.controls.quantity.markAsPristine()
                            "
                          >
                            Usar {{ s.packs }}
                          </button>
                        } @else {
                          Calculado según la receta: {{ s.text }}
                        }
                      </p>
                    }
                  }
                </div>
              }
            </li>
          }
        </ol>
        <datalist id="rx-routes">
          @for (r of routes; track r) {
            <option [value]="r"></option>
          }
        </datalist>
        <datalist id="rx-frequencies">
          @for (f of frequencies; track f) {
            <option [value]="f"></option>
          }
        </datalist>
        <datalist id="rx-durations">
          @for (d of durations; track d) {
            <option [value]="d"></option>
          }
        </datalist>

        <div>
          <label for="rx-notes" class="field-label">Indicaciones generales</label>
          <textarea
            id="rx-notes"
            formControlName="notes"
            rows="2"
            maxlength="1000"
            class="field-input h-auto py-2.5"
            placeholder="Dieta, cuidados en casa, cuándo volver"
          ></textarea>
        </div>
        @if (dispensedTotal() > 0) {
          <p class="text-sm text-slate-600">
            Lo que se entrega se carga a la cuenta:
            <strong class="tabular-nums">{{ money(dispensedTotal()) }}</strong>
          </p>
        }
      } @else {
        <p class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
          Busca el medicamento en el inventario para entregarlo y cobrarlo aquí, o escribe su nombre
          si el dueño lo comprará en una farmacia.
        </p>
      }

      <div class="flex flex-wrap items-center justify-end gap-2">
        @if (items.length && canSaveFrequent()) {
          <button type="button" class="btn btn-ghost mr-auto" (click)="askSaveFrequent()">
            <app-icon name="save" class="size-4" /> Guardar como receta frecuente
          </button>
        }
        <button type="button" class="btn btn-secondary" (click)="cancelled.emit()">Cancelar</button>
        <button type="submit" class="btn btn-primary" [disabled]="saving() || !items.length">
          @if (saving()) {
            <app-icon name="loader" class="size-4 animate-spin" />
          }
          Emitir receta
        </button>
      </div>
    </form>

    <app-template-picker
      kind="PRESCRIPTION"
      [open]="picking()"
      (picked)="picking.set(false); applyRx($event.template)"
      (closed)="picking.set(false)"
    />
    <app-save-template
      kind="PRESCRIPTION"
      [open]="savingFrequent() !== null"
      [prescription]="savingFrequent()"
      (saved)="onFrequentSaved($event)"
      (closed)="savingFrequent.set(null)"
    />
  `,
})
export class PrescriptionFormComponent {
  private readonly api = inject(PrescriptionsService);
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly templates = inject(ClinicalTemplatesService);

  readonly visitId = input.required<number>();
  readonly saved = output<PrescriptionPrint>();
  readonly cancelled = output<void>();
  /** Guardar recetas frecuentes: veterinario o administrador */
  readonly canSaveFrequent = input(true);

  protected readonly frequent = signal<ClinicalTemplate[]>([]);
  protected readonly applying = signal(false);
  protected readonly picking = signal(false);
  protected readonly savingFrequent = signal<PrescriptionContent | null>(null);

  protected readonly money = money;
  protected readonly routes = ROUTE_OPTIONS;
  protected readonly frequencies = FREQUENCY_OPTIONS;
  protected readonly durations = DURATION_OPTIONS;
  protected readonly saving = signal(false);

  protected readonly items = new FormArray<ItemGroup>([]);
  protected readonly form = new FormGroup({
    items: this.items,
    notes: text(1000),
  });
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly options = toSignal(
    this.search.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<DrugOption[]>([])
          : this.inventory.list({ q }).pipe(
              map((page) =>
                page.items
                  .flatMap((p) =>
                    p.presentations
                      .filter((pr) => pr.active && pr.price !== null)
                      // La unidad más chica primero: se entrega lo que pide la dosis, no una caja
                      .sort((a, b) => a.factor - b.factor)
                      .map((pr) => ({
                        key: `p${pr.id}`,
                        productId: p.id,
                        presentationId: pr.id,
                        drug: p.name,
                        presentation: pr.name,
                        price: pr.price as number,
                        stock: `stock ${formatQty(p.totalStock)} ${unitLabel(p.baseUnit, p.totalStock)}`,
                        controlled: p.controlled,
                        factor: pr.factor || 1,
                      })),
                  )
                  .slice(0, 6),
              ),
              catchError(() => of<DrugOption[]>([])),
            ),
      ),
    ),
    { initialValue: [] as DrugOption[] },
  );
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected dispensedTotal(): number {
    this.values();
    return this.items.controls.reduce(
      (sum, g) =>
        g.controls.dispense.value
          ? sum + (Number(g.controls.quantity.value) || 0) * g.controls.price.value
          : sum,
      0,
    );
  }

  constructor() {
    this.templates.list('PRESCRIPTION').subscribe({
      next: (list) => this.frequent.set(list),
      error: () => this.frequent.set([]),
    });
  }

  /**
   * Agrega los medicamentos de una receta frecuente. Los del inventario se vuelven a leer
   * (precio y stock de hoy); si ya no existen o no tienen precio, quedan para farmacia.
   */
  protected applyRx(t: ClinicalTemplate): void {
    const content = t.prescription;
    if (!content || this.applying()) return;
    const productIds = [
      ...new Set(content.items.map((i) => i.productId).filter((id): id is number => !!id)),
    ];
    this.applying.set(true);
    const lookups = productIds.map((id) =>
      this.inventory.get(id).pipe(catchError(() => of(null as ProductDetail | null))),
    );
    (lookups.length ? forkJoin(lookups) : of([] as (ProductDetail | null)[])).subscribe(
      (products) => {
        let pharmacy = 0;
        for (const item of content.items) {
          const product = products.find((p) => p?.id === item.productId) ?? null;
          const presentation = product?.presentations.find(
            (pr) => pr.id === item.presentationId && pr.active && pr.price !== null,
          );
          const fromStock = product && product.active && presentation;
          if (item.productId && !fromStock) pharmacy++;
          const group = fromStock
            ? this.row({
                productId: product.id,
                presentationId: presentation.id,
                presentation: presentation.name,
                price: presentation.price as number,
                controlled: product.controlled,
                factor: presentation.factor || 1,
                drug: product.name,
                dispense: item.dispenseQuantity != null,
              })
            : this.row({ drug: item.drug, dispense: false });
          // La cantidad guardada en la plantilla manda sobre el cálculo
          if (item.dispenseQuantity != null) group.controls.quantity.markAsDirty();
          group.patchValue({
            dose: item.dose,
            route: item.route ?? (fromStock ? 'Oral' : ''),
            frequency: item.frequency,
            duration: item.duration,
            instructions: item.instructions ?? '',
            quantity: item.dispenseQuantity ?? 1,
          });
          this.items.push(group);
        }
        if (content.notes && !this.form.controls.notes.value.trim())
          this.form.controls.notes.setValue(content.notes);
        this.applying.set(false);
        this.templates.used(t.id).subscribe({ error: () => undefined });
        this.toast.success(
          pharmacy
            ? `Receta «${t.name}» agregada. ${pharmacy} medicamento(s) ya no está(n) en inventario: quedan para farmacia.`
            : `Receta «${t.name}» agregada: ajusta la dosis al peso si hace falta.`,
        );
      },
    );
  }

  protected askSaveFrequent(): void {
    const v = this.form.getRawValue();
    const items = v.items.filter(
      (i) => i.drug.trim() && i.dose.trim() && i.frequency.trim() && i.duration.trim(),
    );
    if (items.length !== v.items.length) {
      this.form.markAllAsTouched();
      this.toast.error('Completa dosis, frecuencia y duración de cada medicamento.');
      return;
    }
    this.savingFrequent.set({
      notes: v.notes.trim() || null,
      items: items.map((i) => ({
        productId: i.productId,
        presentationId: i.presentationId,
        drug: i.drug.trim(),
        dose: i.dose.trim(),
        route: i.route.trim() || null,
        frequency: i.frequency.trim(),
        duration: i.duration.trim(),
        instructions: i.instructions.trim() || null,
        dispenseQuantity:
          i.productId && i.dispense && i.presentationId ? Number(i.quantity) || null : null,
      })),
    });
  }

  protected onFrequentSaved(t: ClinicalTemplate): void {
    this.savingFrequent.set(null);
    this.frequent.update((list) => [...list, t]);
  }

  protected addProduct(o: DrugOption): void {
    this.items.push(
      this.row({
        productId: o.productId,
        presentationId: o.presentationId,
        presentation: o.presentation,
        price: o.price,
        controlled: o.controlled,
        factor: o.factor,
        drug: o.drug,
        dispense: true,
      }),
    );
    this.search.setValue('');
    this.focusDose();
  }

  protected addFree(): void {
    const name = this.search.value.trim();
    if (name.length < 2) return;
    this.items.push(this.row({ drug: name, dispense: false }));
    this.search.setValue('');
    this.focusDose();
  }

  /** "1 × 2 al día × 5 días = 10" y cuántas presentaciones son (10 tabletas, o 1 caja de 100) */
  protected suggestion(g: ItemGroup): { total: number; packs: number; text: string } | null {
    const v = g.getRawValue();
    if (!v.productId) return null;
    const s = suggestedUnits(v.dose, v.frequency, v.duration);
    if (!s) return null;
    const factor = v.factor || 1;
    const packs = Math.max(1, Math.ceil(s.total / factor));
    const perDay = s.days === 1 && s.perDay === 1 ? '' : ` × ${s.perDay} al día × ${s.days} días`;
    return { total: s.total, packs, text: `${s.perDose}${perDay} = ${s.total}` };
  }

  protected bad(control: { invalid: boolean; touched: boolean }): boolean {
    return control.invalid && control.touched;
  }

  protected submit(): void {
    if (this.saving() || !this.items.length) return;
    for (const g of this.items.controls) {
      const qty = Number(g.controls.quantity.value);
      g.controls.quantity.setErrors(
        g.controls.dispense.value && !(qty > 0) ? { required: true } : null,
      );
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Completa dosis, frecuencia y duración de cada medicamento.');
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.api
      .create(this.visitId(), {
        notes: v.notes.trim() || null,
        items: v.items.map((i) => ({
          productId: i.productId ?? undefined,
          presentationId: i.dispense ? (i.presentationId ?? undefined) : undefined,
          drug: i.drug.trim(),
          dose: i.dose.trim(),
          route: i.route.trim() || null,
          frequency: i.frequency.trim(),
          duration: i.duration.trim(),
          instructions: i.instructions.trim() || null,
          dispenseQuantity: i.productId && i.dispense ? Number(i.quantity) : null,
        })),
      })
      .subscribe({
        next: (rx) => {
          this.saving.set(false);
          this.items.clear();
          this.form.reset();
          this.toast.success(`Receta ${rx.code} emitida.`);
          this.saved.emit(rx);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  private row(init: {
    productId?: number;
    presentationId?: number;
    presentation?: string;
    price?: number;
    controlled?: boolean;
    factor?: number;
    drug: string;
    dispense: boolean;
  }): ItemGroup {
    const group: ItemGroup = new FormGroup({
      productId: new FormControl<number | null>(init.productId ?? null),
      presentationId: new FormControl<number | null>(init.presentationId ?? null),
      presentation: new FormControl(init.presentation ?? '', { nonNullable: true }),
      price: new FormControl(init.price ?? 0, { nonNullable: true }),
      controlled: new FormControl(init.controlled ?? false, { nonNullable: true }),
      factor: new FormControl(init.factor ?? 1, { nonNullable: true }),
      drug: new FormControl(init.drug, {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(2), Validators.maxLength(150)],
      }),
      dose: text(80, true),
      route: new FormControl(init.productId ? 'Oral' : '', {
        nonNullable: true,
        validators: [Validators.maxLength(40)],
      }),
      frequency: text(60, true),
      duration: text(60, true),
      instructions: text(300),
      dispense: new FormControl(init.dispense, { nonNullable: true }),
      quantity: new FormControl<number | null>(1, [Validators.min(0.001), Validators.max(999)]),
    });
    // Mientras no la cambie a mano, la cantidad a entregar sigue a la dosis, frecuencia y días
    group.valueChanges.subscribe(() => {
      const q = group.controls.quantity;
      if (!group.controls.dispense.value || q.dirty) return;
      const units = this.suggestion(group);
      if (units && q.value !== units.packs) q.setValue(units.packs, { emitEvent: false });
    });
    return group;
  }

  private focusDose(): void {
    const index = this.items.length - 1;
    setTimeout(() => document.getElementById(`rx-dose-${index}`)?.focus());
  }
}
