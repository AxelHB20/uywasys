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
import { NgTemplateOutlet } from '@angular/common';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { limaIso, nextSlot, timeSlots } from '../../core/services/appointments.models';
import { SPECIES_LABELS } from '../../core/services/clients.models';
import { CareServicesService } from '../../core/services/care-services.service';
import {
  GroomingTransport,
  PET_SIZES,
  PET_SIZE_HINTS,
  PET_SIZE_LABELS,
  PetSize,
  TRANSPORT_LABELS,
  TRANSPORTS,
  priceForSize,
  sizeForWeight,
} from '../../core/services/grooming.models';
import { GroomingService } from '../../core/services/grooming.service';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { ImmunizationCard } from '../../core/services/medical.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PetPickerComponent, PickedPet } from '../../shared/ui/pet-picker/pet-picker.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { limaToday } from '../../shared/utils/dates';
import { SPECIES_ICONS } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { loaded } from '../../shared/utils/resource';
import { apiErrorMessage } from '../../shared/utils/validators';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import {
  TransportFieldsComponent,
  transportGroup,
  transportInvalid,
  transportValue,
} from '../../shared/ui/transport-fields/transport-fields.component';
import { VisitsService } from '../../core/services/visits.service';
import { map } from 'rxjs';

const FLAGS = [
  { key: 'fleas', label: 'Pulgas' },
  { key: 'ticks', label: 'Garrapatas' },
  { key: 'matting', label: 'Nudos' },
  { key: 'aggressive', label: 'Agresivo' },
] as const;

/**
 * Ingreso a grooming en menos de un minuto: mascota, tamaño, servicios con su precio, el
 * checklist de cómo llega (respaldo ante reclamos), groomer y hora de recojo.
 */
@Component({
  selector: 'app-grooming-check-in-page',
  imports: [
    BackLinkComponent,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    PetPickerComponent,
    NgTemplateOutlet,
    TransportFieldsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-6xl space-y-5">
      <app-back-link fallback="/grooming" fallbackLabel="Tablero de grooming" />
      <header class="flex flex-col gap-1">
        <h1 class="font-display text-2xl font-semibold text-slate-900">Nuevo ingreso a grooming</h1>
        <p class="text-sm text-pretty text-slate-600">
          Lo que anotes de cómo llega la mascota queda en la constancia y ya no se edita.
        </p>
      </header>

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
        novalidate
      >
        <div class="min-w-0 space-y-5">
          <!-- 1. Mascota y tamaño -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="sr-only">Mascota</legend>
            <ng-container
              *ngTemplateOutlet="
                stepHead;
                context: { n: 1, title: 'Mascota y tamaño', done: !!pet() }
              "
            />
            @if (pet(); as p) {
              <div class="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <span
                  class="grid size-12 shrink-0 place-items-center rounded-xl bg-anil-600 text-white"
                  aria-hidden="true"
                >
                  <app-icon [name]="speciesIcons[p.pet.species]" class="size-6" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-slate-900">{{ p.pet.name }}</p>
                  <p class="truncate text-sm text-slate-600">
                    {{ speciesLabels[p.pet.species] }}{{ p.pet.breed ? ' · ' + p.pet.breed : '' }}
                    @if (p.pet.weightKg) {
                      · <span class="tabular-nums">{{ p.pet.weightKg }} kg</span>
                    }
                  </p>
                  <p class="truncate text-xs text-slate-500">
                    <app-icon name="user" class="-mt-0.5 inline size-3.5" /> {{ p.pet.client.name }}
                  </p>
                </div>
                @if (!fromQueue()) {
                  <button
                    type="button"
                    class="btn btn-ghost h-10 px-3 text-sm"
                    (click)="clearPet()"
                  >
                    Cambiar
                  </button>
                }
              </div>
              @if (p.pet.aggressive || p.pet.allergies) {
                <div class="mt-3 space-y-2" role="alert">
                  @if (p.pet.aggressive) {
                    <p
                      class="flex gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200"
                    >
                      <app-icon name="alert" class="mt-0.5 size-4 shrink-0 text-rose-600" />
                      <span
                        ><strong>Agresivo.</strong>
                        {{ p.pet.aggressiveNote ?? 'Manipular con precaución.' }}</span
                      >
                    </p>
                  }
                  @if (p.pet.allergies) {
                    <p
                      class="flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"
                    >
                      <app-icon name="alert" class="mt-0.5 size-4 shrink-0 text-amber-600" />
                      <span><strong>Alergias:</strong> {{ p.pet.allergies }}</span>
                    </p>
                  }
                </div>
              }
            } @else {
              <app-pet-picker inputId="gr-pet" [invalid]="petMissing()" (picked)="pick($event)" />
              @if (petMissing()) {
                <p class="field-error">Elige la mascota</p>
              }
            }

            <div class="mt-5">
              <span id="gr-size" class="field-label">Tamaño</span>
              <div
                class="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4"
                role="radiogroup"
                aria-labelledby="gr-size"
              >
                @for (s of sizes; track s) {
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="size() === s"
                    [attr.data-size]="s"
                    class="relative min-h-14 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors"
                    [class]="
                      size() === s
                        ? 'bg-anil-50 ring-2 ring-anil-600'
                        : 'bg-white ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'
                    "
                    (click)="form.controls.size.setValue(s)"
                  >
                    <span class="block text-sm font-semibold text-slate-900">{{
                      sizeLabels[s]
                    }}</span>
                    <span class="block text-xs text-slate-500">{{ sizeHints[s] }}</span>
                    @if (size() === s) {
                      <app-icon
                        name="check"
                        class="absolute top-2.5 right-2.5 size-4 text-anil-700"
                      />
                    }
                  </button>
                }
              </div>
            </div>
          </fieldset>

          <!-- 2. Servicios -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="sr-only">Servicios</legend>
            <ng-container
              *ngTemplateOutlet="
                stepHead;
                context: { n: 2, title: 'Servicios', done: chosen().length > 0 }
              "
            />
            @if (catalog.isLoading()) {
              <div class="h-24 animate-pulse rounded-xl bg-slate-100" aria-busy="true"></div>
            } @else if (catalog.error()) {
              <p
                class="flex items-center gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200"
                role="alert"
              >
                <span class="flex-1">No se pudieron cargar los servicios.</span>
                <button type="button" class="btn btn-secondary h-9 px-3" (click)="catalog.reload()">
                  Reintentar
                </button>
              </p>
            } @else if (!services().length) {
              <p
                class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200"
              >
                No hay servicios de "Baño y grooming" en el catálogo.
                <a routerLink="/servicios" class="font-semibold underline"
                  >Créalos en Servicios y precios</a
                >.
              </p>
            } @else {
              <p class="-mt-2 mb-3 text-xs text-slate-500">
                Precios para tamaño {{ sizeLabels[size()].toLowerCase() }}.
              </p>
              <div class="grid gap-2 sm:grid-cols-2" role="group" aria-label="Servicios">
                @for (s of services(); track s.id) {
                  <button
                    type="button"
                    role="checkbox"
                    [attr.aria-checked]="chosen().includes(s.id)"
                    [attr.data-service]="s.id"
                    class="flex min-h-14 items-center gap-3 rounded-xl px-3.5 py-2.5 text-left ring-1 transition-colors"
                    [class]="
                      chosen().includes(s.id)
                        ? 'bg-anil-50 ring-2 ring-anil-600'
                        : 'bg-white ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'
                    "
                    (click)="toggle(s.id)"
                  >
                    <span
                      class="grid size-5 shrink-0 place-items-center rounded-md ring-1"
                      [class]="
                        chosen().includes(s.id)
                          ? 'bg-anil-600 text-white ring-anil-600'
                          : 'bg-white ring-slate-300'
                      "
                      aria-hidden="true"
                    >
                      @if (chosen().includes(s.id)) {
                        <app-icon name="check" class="size-3.5" />
                      }
                    </span>
                    <span class="min-w-0 flex-1 text-sm font-medium text-slate-900">{{
                      s.name
                    }}</span>
                    <span class="text-sm font-semibold text-slate-900 tabular-nums">{{
                      money(price(s))
                    }}</span>
                  </button>
                }
              </div>
              @if (servicesMissing()) {
                <p class="field-error">Elige al menos un servicio</p>
              }
            }
          </fieldset>

          <!-- 3. Cómo llega -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="sr-only">Cómo llega</legend>
            <ng-container
              *ngTemplateOutlet="
                stepHead;
                context: { n: 3, title: 'Cómo llega', done: false, hint: 'Respaldo ante reclamos' }
              "
            />
            <div class="flex flex-wrap gap-2" role="group" aria-label="Checklist">
              @for (f of flags; track f.key) {
                <button
                  type="button"
                  role="checkbox"
                  [attr.aria-checked]="form.controls[f.key].value"
                  class="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors"
                  [class]="
                    form.controls[f.key].value
                      ? f.key === 'aggressive'
                        ? 'bg-rose-50 text-rose-800 ring-2 ring-rose-500'
                        : 'bg-amber-50 text-amber-900 ring-2 ring-amber-500'
                      : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
                  "
                  (click)="form.controls[f.key].setValue(!form.controls[f.key].value)"
                >
                  <app-icon
                    [name]="form.controls[f.key].value ? 'check' : 'plus'"
                    class="size-3.5"
                    [class.text-slate-400]="!form.controls[f.key].value"
                  />
                  {{ f.label }}
                </button>
              }
            </div>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label for="gr-skin" class="field-label">Piel, orejas, heridas</label>
                <input
                  id="gr-skin"
                  class="field-input"
                  formControlName="skinNotes"
                  maxlength="300"
                  autocomplete="off"
                  placeholder="Ej.: irritación en la oreja izquierda"
                />
              </div>
              <div>
                <label for="gr-belongings" class="field-label">Pertenencias</label>
                <input
                  id="gr-belongings"
                  class="field-input"
                  formControlName="belongings"
                  maxlength="200"
                  autocomplete="off"
                  placeholder="Ej.: collar rojo, correa"
                />
              </div>
              <div class="sm:col-span-2">
                <label for="gr-instructions" class="field-label">Lo que pide el dueño</label>
                <textarea
                  id="gr-instructions"
                  class="field-input min-h-20"
                  formControlName="instructions"
                  maxlength="300"
                  placeholder="Ej.: corte cachorro, sin perfume, dejar las orejas largas"
                ></textarea>
                @if (lastInstructions(); as last) {
                  <button
                    type="button"
                    class="mt-2 flex w-full items-start gap-2 rounded-xl bg-anil-50/60 px-3 py-2 text-left text-sm text-anil-900 ring-1 ring-anil-200 hover:bg-anil-50"
                    (click)="form.controls.instructions.setValue(last)"
                  >
                    <app-icon name="history" class="mt-0.5 size-4 shrink-0" />
                    <span
                      >Como la última vez: <em>{{ last }}</em></span
                    >
                  </button>
                }
              </div>
            </div>
          </fieldset>

          <!-- 4. Groomer, recojo y movilidad -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="sr-only">Recojo</legend>
            <ng-container
              *ngTemplateOutlet="
                stepHead;
                context: {
                  n: 4,
                  title: 'Groomer y recojo',
                  done: !!form.controls.promisedTime.value,
                }
              "
            />
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label for="gr-groomer" class="field-label">Groomer</label>
                <select id="gr-groomer" class="field-input" formControlName="groomerId">
                  <option [ngValue]="null">Quien lo tome</option>
                  @for (g of groomerList() ?? []; track g.id) {
                    <option [ngValue]="g.id">{{ g.fullName }}</option>
                  }
                </select>
              </div>
              <div>
                <label for="gr-time" class="field-label">Hora de recojo</label>
                <select
                  id="gr-time"
                  class="field-input tabular-nums"
                  formControlName="promisedTime"
                >
                  <option value="">Sin hora</option>
                  @for (t of slots; track t) {
                    <option [value]="t">{{ t }}</option>
                  }
                </select>
              </div>
            </div>
            <app-transport-fields
              class="mt-4"
              prefix="gr"
              [group]="form.controls.move"
              [clientAddress]="clientAddress()"
              [lastPrice]="lastTransportPrice()"
              [submitted]="submitted()"
            />
          </fieldset>
        </div>

        <!-- Resumen -->
        <aside class="card overflow-hidden lg:sticky lg:top-4" aria-labelledby="gr-summary">
          <div class="border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
            <h2 id="gr-summary" class="text-sm font-semibold text-slate-900">
              Resumen del ingreso
            </h2>
          </div>
          <div class="space-y-4 px-5 py-4 text-sm">
            @if (pet(); as p) {
              <div class="flex items-center gap-2.5">
                <span
                  class="grid size-9 shrink-0 place-items-center rounded-lg bg-anil-50 text-anil-700"
                  aria-hidden="true"
                >
                  <app-icon [name]="speciesIcons[p.pet.species]" class="size-5" />
                </span>
                <div class="min-w-0">
                  <p class="truncate font-semibold text-slate-900">{{ p.pet.name }}</p>
                  <p class="truncate text-xs text-slate-500">
                    {{ sizeLabels[size()] }} · {{ p.pet.client.name }}
                  </p>
                </div>
              </div>
            } @else {
              <p class="text-slate-500">Aún no eliges la mascota.</p>
            }

            <div>
              <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Servicios</p>
              @if (chosenServices().length) {
                <ul class="mt-1.5 space-y-1" role="list">
                  @for (s of chosenServices(); track s.id) {
                    <li class="flex justify-between gap-3">
                      <span class="min-w-0 text-slate-700">{{ s.name }}</span>
                      <span class="text-slate-900 tabular-nums">{{ money(price(s)) }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="mt-1 text-slate-500">Ninguno elegido</p>
              }
            </div>

            <dl class="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
              <div>
                <dt class="text-xs text-slate-500">Recojo</dt>
                <dd class="font-medium text-slate-900 tabular-nums">
                  {{ form.controls.promisedTime.value || 'Sin hora' }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-slate-500">Groomer</dt>
                <dd class="truncate font-medium text-slate-900">{{ groomerName() }}</dd>
              </div>
              @if (move().transport !== 'NONE') {
                <div class="col-span-2">
                  <dt class="text-xs text-slate-500">Movilidad</dt>
                  <dd class="flex justify-between gap-3 font-medium text-slate-900">
                    <span>{{ transportLabels[move().transport] }}</span>
                    <span class="tabular-nums">{{
                      move().transportPrice ? money(move().transportPrice!) : 'Sin cobro'
                    }}</span>
                  </dd>
                </div>
              }
            </dl>

            @if (activeFlags().length) {
              <div class="flex flex-wrap gap-1">
                @for (f of activeFlags(); track f.key) {
                  <span
                    class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold"
                    [class]="
                      f.key === 'aggressive'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    "
                    ><app-icon name="alert" class="size-3" />{{ f.label }}</span
                  >
                }
              </div>
            }
          </div>
          <div class="border-t border-slate-100 px-5 py-4">
            <div class="flex items-baseline justify-between">
              <span class="text-sm text-slate-600">Total</span>
              <span class="font-display text-2xl font-semibold text-slate-900 tabular-nums">{{
                money(total())
              }}</span>
            </div>
            <p class="mt-0.5 text-xs text-slate-500">Se cobra al entregar en Caja.</p>
            <button type="submit" class="btn btn-primary mt-4 w-full" [disabled]="saving()">
              @if (saving()) {
                <app-icon name="loader" class="size-4 animate-spin" />
              }
              Registrar ingreso · {{ money(total()) }}
            </button>
            <a routerLink="/grooming" class="btn btn-ghost mt-2 w-full text-sm">Cancelar</a>
          </div>
        </aside>
      </form>
    </section>

    <ng-template #stepHead let-n="n" let-title="title" let-done="done" let-hint="hint">
      <div class="mb-4 flex items-center gap-3">
        <span
          class="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold"
          [class]="
            done ? 'bg-emerald-600 text-white' : 'bg-anil-50 text-anil-800 ring-1 ring-anil-200'
          "
          aria-hidden="true"
        >
          @if (done) {
            <app-icon name="check" class="size-4" />
          } @else {
            {{ n }}
          }
        </span>
        <h2 class="font-display text-base font-semibold text-slate-900">{{ title }}</h2>
        @if (hint) {
          <span class="ml-auto text-xs text-slate-500">{{ hint }}</span>
        }
      </div>
    </ng-template>
  `,
})
export class GroomingCheckInPage {
  private readonly api = inject(GroomingService);
  private readonly catalogApi = inject(CareServicesService);
  private readonly petsApi = inject(ImmunizationsService);
  private readonly router = inject(Router);
  private readonly visitsApi = inject(VisitsService);
  private readonly toast = inject(ToastService);

  // ?petId=&cola= (desde la cola, una cita o la ficha)
  readonly petId = input<string>();
  readonly cola = input<string>();
  /** Movilidad acordada en la cita (desde la cola) */
  readonly movilidad = input<string>();
  readonly direccion = input<string>();
  readonly precio = input<string>();

  protected readonly sizes = PET_SIZES;
  protected readonly sizeLabels = PET_SIZE_LABELS;
  protected readonly sizeHints = PET_SIZE_HINTS;
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly flags = FLAGS;
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly money = money;
  protected readonly slots = timeSlots();

  protected readonly catalog = rxResource({ stream: () => this.catalogApi.list('active') });
  protected readonly groomers = rxResource({ stream: () => this.api.groomers() });
  protected readonly groomerList = loaded(this.groomers);
  private readonly catalogList = loaded(this.catalog);
  protected readonly services = computed(() =>
    (this.catalogList() ?? []).filter((s) => s.category === 'GROOMING'),
  );

  protected readonly pet = signal<ImmunizationCard | null>(null);
  protected readonly lastInstructions = signal<string | null>(null);
  /** Dirección registrada del dueño: se propone al elegir recojo o entrega */
  protected readonly clientAddress = signal('');
  protected readonly chosen = signal<number[]>([]);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly fromQueue = computed(() => Boolean(this.cola()));

  protected readonly form = new FormGroup({
    size: new FormControl<PetSize>('SMALL', { nonNullable: true }),
    fleas: new FormControl(false, { nonNullable: true }),
    ticks: new FormControl(false, { nonNullable: true }),
    matting: new FormControl(false, { nonNullable: true }),
    aggressive: new FormControl(false, { nonNullable: true }),
    skinNotes: new FormControl('', { nonNullable: true, validators: Validators.maxLength(300) }),
    belongings: new FormControl('', { nonNullable: true, validators: Validators.maxLength(200) }),
    instructions: new FormControl('', { nonNullable: true, validators: Validators.maxLength(300) }),
    groomerId: new FormControl<number | null>(null),
    promisedTime: new FormControl('', { nonNullable: true }),
    move: transportGroup(),
  });

  private readonly sizeValue = signal<PetSize>('SMALL');
  protected readonly size = this.sizeValue.asReadonly();
  /** Movilidad con su precio (se suma al total) */
  protected readonly move = toSignal(
    this.form.controls.move.valueChanges.pipe(map(() => transportValue(this.form.controls.move))),
    { initialValue: transportValue(this.form.controls.move) },
  );
  protected readonly lastTransportPrice = signal<number | null>(null);
  protected readonly total = computed(() => {
    const size = this.size();
    return (
      this.services()
        .filter((s) => this.chosen().includes(s.id))
        .reduce((sum, s) => sum + priceForSize(s, size), 0) + (this.move().transportPrice ?? 0)
    );
  });
  protected readonly chosenServices = computed(() =>
    this.services().filter((s) => this.chosen().includes(s.id)),
  );
  private readonly flagValues = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly activeFlags = computed(() => {
    const v = this.flagValues();
    return FLAGS.filter((f) => v[f.key]);
  });
  private readonly groomerId = toSignal(this.form.controls.groomerId.valueChanges, {
    initialValue: null,
  });
  protected readonly groomerName = computed(() => {
    const id = this.groomerId();
    return (this.groomerList() ?? []).find((g) => g.id === id)?.fullName ?? 'Quien lo tome';
  });
  protected readonly petMissing = computed(() => this.submitted() && !this.pet());
  protected readonly servicesMissing = computed(() => this.submitted() && !this.chosen().length);

  constructor() {
    this.form.controls.size.valueChanges.subscribe((s) => this.sizeValue.set(s));
    effect(() => {
      const id = Number(this.petId());
      if (id) untracked(() => this.loadPet(id));
    });
    effect(() => {
      const transport = this.movilidad() as GroomingTransport | undefined;
      if (!transport || !TRANSPORTS.includes(transport) || transport === 'NONE') return;
      const address = this.direccion() ?? '';
      const price = Number(this.precio());
      untracked(() =>
        this.form.controls.move.setValue({
          transport,
          transportAddress: address,
          transportPrice: Number.isFinite(price) && price > 0 ? price : null,
        }),
      );
    });
  }

  protected price(s: { price: number; sizePrices: { size: PetSize; price: number }[] }): number {
    return priceForSize(s, this.size());
  }

  protected pick(picked: PickedPet | null): void {
    if (picked) this.loadPet(picked.petId);
  }

  protected clearPet(): void {
    this.pet.set(null);
    this.lastInstructions.set(null);
    this.setClientAddress('');
    this.lastTransportPrice.set(null);
  }

  /** Propone la dirección del dueño si el campo está vacío o tenía la propuesta anterior */
  private setClientAddress(next: string): void {
    const control = this.form.controls.move.controls.transportAddress;
    const previous = this.clientAddress();
    this.clientAddress.set(next);
    if (control.value.trim() === previous) control.setValue(next);
  }

  protected toggle(id: number): void {
    this.chosen.update((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );
  }

  protected submit(): void {
    this.submitted.set(true);
    const p = this.pet();
    const v = this.form.getRawValue();
    if (
      !p ||
      !this.chosen().length ||
      transportInvalid(this.form.controls.move) ||
      this.form.invalid ||
      this.saving()
    ) {
      setTimeout(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"], .field-error')?.scrollIntoView({
          block: 'center',
        }),
      );
      return;
    }
    const queueEntryId = Number(this.cola()) || undefined;
    this.saving.set(true);
    this.api
      .checkIn({
        petId: p.pet.id,
        queueEntryId,
        size: v.size,
        groomerId: v.groomerId,
        promisedAt: v.promisedTime ? limaIso(limaToday(), v.promisedTime) : null,
        services: this.chosen().map((careServiceId) => ({ careServiceId, quantity: 1 })),
        fleas: v.fleas,
        ticks: v.ticks,
        matting: v.matting,
        aggressive: v.aggressive,
        skinNotes: v.skinNotes.trim() || null,
        belongings: v.belongings.trim() || null,
        instructions: v.instructions.trim() || null,
        ...transportValue(this.form.controls.move),
        signerName: null,
        signature: null,
      })
      .subscribe({
        next: (session) => {
          this.toast.success(`${session.pet.name} ingresó al tablero (${session.code}).`);
          void this.router.navigate(['/grooming'], { replaceUrl: true });
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  private loadPet(petId: number): void {
    this.petsApi.card(petId).subscribe({
      next: (card) => {
        this.pet.set(card);
        const c = card.pet.client;
        this.setClientAddress([c.address, c.district].filter(Boolean).join(', '));
        this.visitsApi.lastTransportPrice(c.id).subscribe({
          next: ({ price }) => this.lastTransportPrice.set(price),
          error: () => this.lastTransportPrice.set(null),
        });
        this.form.patchValue({
          aggressive: card.pet.aggressive,
          size: sizeForWeight(card.pet.weightKg ? Number(card.pet.weightKg) : null),
          promisedTime: this.form.controls.promisedTime.value || this.defaultPickup(),
        });
        // Lo de la última vez: tamaño e indicaciones
        this.api.forPet(petId).subscribe({
          next: (history) => {
            const last = history.find((h) => h.status === 'DELIVERED') ?? history[0];
            if (!last) return;
            this.form.controls.size.setValue(last.size);
            this.lastInstructions.set(last.instructions);
          },
          error: () => undefined,
        });
      },
      error: (error: unknown) =>
        this.toast.error(apiErrorMessage(error, 'No se pudo cargar la mascota.')),
    });
  }

  /** Por defecto, unas 2 horas desde ahora */
  private defaultPickup(): string {
    const soon = nextSlot(new Date(Date.now() + 2 * 3600_000));
    return soon ?? '';
  }
}
