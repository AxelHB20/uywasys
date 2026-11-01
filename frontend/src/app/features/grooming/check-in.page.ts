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
import { rxResource } from '@angular/core/rxjs-interop';
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
  priceForSize,
  sizeForWeight,
} from '../../core/services/grooming.models';
import { GroomingService } from '../../core/services/grooming.service';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { ImmunizationCard } from '../../core/services/medical.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PetPickerComponent, PickedPet } from '../../shared/ui/pet-picker/pet-picker.component';
import { SignaturePadComponent } from '../../shared/ui/signature-pad/signature-pad.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { limaToday } from '../../shared/utils/dates';
import { SPECIES_ICONS } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

const TRANSPORTS = Object.keys(TRANSPORT_LABELS) as GroomingTransport[];
const FLAGS = [
  { key: 'fleas', label: 'Pulgas' },
  { key: 'ticks', label: 'Garrapatas' },
  { key: 'matting', label: 'Nudos' },
  { key: 'aggressive', label: 'Agresivo' },
] as const;

/**
 * Ingreso a grooming en menos de un minuto: mascota, tamaño, servicios con su precio, el
 * checklist de cómo llega (respaldo ante reclamos) y, si se puede, la firma del dueño.
 */
@Component({
  selector: 'app-grooming-check-in-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    PetPickerComponent,
    SignaturePadComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl space-y-6">
      <a
        routerLink="/grooming"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <app-icon name="chevron-left" class="size-4" /> Tablero de grooming
      </a>
      <header>
        <h1 class="font-display text-2xl font-semibold text-slate-900">Ingreso a grooming</h1>
        <p class="mt-1 text-sm text-slate-500">
          Lo que anotes de cómo llega la mascota queda en la constancia y ya no se edita.
        </p>
      </header>

      <form [formGroup]="form" (ngSubmit)="submit()" class="space-y-6" novalidate>
        <!-- 1. Mascota y tamaño -->
        <fieldset class="card p-5 sm:p-6">
          <legend class="soap-legend"><span class="soap-letter">1</span> Mascota</legend>
          @if (pet(); as p) {
            <div class="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <span
                class="grid size-11 shrink-0 place-items-center rounded-xl bg-anil-600 text-white"
                aria-hidden="true"
              >
                <app-icon [name]="speciesIcons[p.pet.species]" class="size-6" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-slate-900">{{ p.pet.name }}</p>
                <p class="truncate text-sm text-slate-500">
                  {{ speciesLabels[p.pet.species] }}{{ p.pet.breed ? ' · ' + p.pet.breed : '' }}
                  @if (p.pet.weightKg) {
                    · <span class="tabular-nums">{{ p.pet.weightKg }} kg</span>
                  }
                  · {{ p.pet.client.name }}
                </p>
              </div>
              @if (!fromQueue()) {
                <button type="button" class="btn btn-ghost h-10 px-3" (click)="clearPet()">
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
            @if (lastInstructions(); as last) {
              <button
                type="button"
                class="mt-3 flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-sm text-anil-800 ring-1 ring-anil-200 hover:bg-anil-50"
                (click)="form.controls.instructions.setValue(last)"
              >
                <app-icon name="history" class="mt-0.5 size-4 shrink-0" />
                <span
                  >Como la última vez: <em>{{ last }}</em></span
                >
              </button>
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
                  class="rounded-xl px-3 py-2.5 text-left ring-1 transition-colors"
                  [class]="
                    size() === s
                      ? 'bg-anil-50 ring-2 ring-anil-600'
                      : 'bg-white ring-slate-200 hover:ring-slate-300'
                  "
                  (click)="form.controls.size.setValue(s)"
                >
                  <span class="block text-sm font-semibold text-slate-900">{{
                    sizeLabels[s]
                  }}</span>
                  <span class="block text-xs text-slate-500">{{ sizeHints[s] }}</span>
                </button>
              }
            </div>
          </div>
        </fieldset>

        <!-- 2. Servicios -->
        <fieldset class="card p-5 sm:p-6">
          <legend class="soap-legend"><span class="soap-letter">2</span> Servicios</legend>
          @if (catalog.isLoading()) {
            <div class="h-24 animate-pulse rounded-xl bg-slate-100" aria-busy="true"></div>
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
                      : 'bg-white ring-slate-200 hover:ring-slate-300'
                  "
                  (click)="toggle(s.id)"
                >
                  <span
                    class="grid size-5 shrink-0 place-items-center rounded-md ring-1"
                    [class]="
                      chosen().includes(s.id)
                        ? 'bg-anil-600 text-white ring-anil-600'
                        : 'ring-slate-300'
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
            <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span class="text-sm text-slate-500"
                >Total ({{ sizeLabels[size()].toLowerCase() }})</span
              >
              <span class="font-display text-xl font-semibold text-slate-900 tabular-nums">{{
                money(total())
              }}</span>
            </div>
            @if (servicesMissing()) {
              <p class="field-error">Elige al menos un servicio</p>
            }
          }
        </fieldset>

        <!-- 3. Cómo llega -->
        <fieldset class="card p-5 sm:p-6">
          <legend class="soap-legend"><span class="soap-letter">3</span> Cómo llega</legend>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Checklist">
            @for (f of flags; track f.key) {
              <button
                type="button"
                role="checkbox"
                [attr.aria-checked]="form.controls[f.key].value"
                class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition-colors"
                [class]="
                  form.controls[f.key].value
                    ? f.key === 'aggressive'
                      ? 'bg-rose-600 text-white ring-rose-600'
                      : 'bg-amber-500 text-white ring-amber-500'
                    : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-400'
                "
                (click)="form.controls[f.key].setValue(!form.controls[f.key].value)"
              >
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
            </div>
          </div>
        </fieldset>

        <!-- 4. Groomer, recojo y movilidad -->
        <fieldset class="card p-5 sm:p-6">
          <legend class="soap-legend"><span class="soap-letter">4</span> Recojo</legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label for="gr-groomer" class="field-label">Groomer</label>
              <select id="gr-groomer" class="field-input" formControlName="groomerId">
                <option [ngValue]="null">Quien lo tome</option>
                @for (g of groomers.value() ?? []; track g.id) {
                  <option [ngValue]="g.id">{{ g.fullName }}</option>
                }
              </select>
            </div>
            <div>
              <label for="gr-time" class="field-label">Hora de recojo</label>
              <select id="gr-time" class="field-input tabular-nums" formControlName="promisedTime">
                <option value="">Sin hora</option>
                @for (t of slots; track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </div>
          </div>
          <div class="mt-4">
            <span id="gr-transport" class="field-label">Movilidad</span>
            <div
              class="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4"
              role="radiogroup"
              aria-labelledby="gr-transport"
            >
              @for (t of transports; track t) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="form.controls.transport.value === t"
                  class="rounded-xl px-3 py-2 text-sm font-medium ring-1 transition-colors"
                  [class]="
                    form.controls.transport.value === t
                      ? 'bg-anil-50 text-anil-900 ring-2 ring-anil-600'
                      : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-300'
                  "
                  (click)="form.controls.transport.setValue(t)"
                >
                  {{ transportLabels[t] }}
                </button>
              }
            </div>
            @if (form.controls.transport.value !== 'NONE') {
              <label for="gr-address" class="field-label mt-3">
                Dirección <span class="text-rose-600" aria-hidden="true">*</span>
              </label>
              <input
                id="gr-address"
                class="field-input"
                formControlName="transportAddress"
                maxlength="200"
                autocomplete="off"
                [attr.aria-invalid]="addressMissing()"
              />
              @if (addressMissing()) {
                <p class="field-error">Escribe la dirección de recojo o entrega</p>
              }
            }
          </div>
        </fieldset>

        <!-- 5. Firma -->
        <fieldset class="card p-5 sm:p-6">
          <legend class="soap-legend"><span class="soap-letter">5</span> Firma del dueño</legend>
          <p class="mb-3 text-sm text-slate-500">
            Opcional, pero recomendada: confirma cómo llegó la mascota si luego hay un reclamo.
          </p>
          <div class="mb-3 max-w-sm">
            <label for="gr-signer" class="field-label">Quien firma</label>
            <input
              id="gr-signer"
              class="field-input"
              formControlName="signerName"
              maxlength="150"
              autocomplete="off"
            />
          </div>
          <app-signature-pad
            label="Firma del dueño al dejar la mascota"
            (changed)="signature.set($event)"
          />
        </fieldset>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <a routerLink="/grooming" class="btn btn-secondary">Cancelar</a>
          <button type="submit" class="btn btn-primary" [disabled]="saving()">
            @if (saving()) {
              <app-icon name="loader" class="size-4 animate-spin" />
            }
            Registrar ingreso · {{ money(total()) }}
          </button>
        </div>
      </form>
    </section>
  `,
})
export class GroomingCheckInPage {
  private readonly api = inject(GroomingService);
  private readonly catalogApi = inject(CareServicesService);
  private readonly petsApi = inject(ImmunizationsService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  // ?petId=&cola= (desde la cola, una cita o la ficha)
  readonly petId = input<string>();
  readonly cola = input<string>();

  protected readonly sizes = PET_SIZES;
  protected readonly sizeLabels = PET_SIZE_LABELS;
  protected readonly sizeHints = PET_SIZE_HINTS;
  protected readonly transports = TRANSPORTS;
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly flags = FLAGS;
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly money = money;
  protected readonly slots = timeSlots();

  protected readonly catalog = rxResource({ stream: () => this.catalogApi.list('active') });
  protected readonly groomers = rxResource({ stream: () => this.api.groomers() });
  protected readonly services = computed(() =>
    (this.catalog.value() ?? []).filter((s) => s.category === 'GROOMING'),
  );

  protected readonly pet = signal<ImmunizationCard | null>(null);
  protected readonly lastInstructions = signal<string | null>(null);
  protected readonly chosen = signal<number[]>([]);
  protected readonly signature = signal<string | null>(null);
  protected readonly saving = signal(false);
  private readonly submitted = signal(false);
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
    transport: new FormControl<GroomingTransport>('NONE', { nonNullable: true }),
    transportAddress: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(200),
    }),
    signerName: new FormControl('', { nonNullable: true, validators: Validators.maxLength(150) }),
  });

  private readonly sizeValue = signal<PetSize>('SMALL');
  protected readonly size = this.sizeValue.asReadonly();
  protected readonly total = computed(() => {
    const size = this.size();
    return this.services()
      .filter((s) => this.chosen().includes(s.id))
      .reduce((sum, s) => sum + priceForSize(s, size), 0);
  });
  protected readonly petMissing = computed(() => this.submitted() && !this.pet());
  protected readonly servicesMissing = computed(() => this.submitted() && !this.chosen().length);

  constructor() {
    this.form.controls.size.valueChanges.subscribe((s) => this.sizeValue.set(s));
    effect(() => {
      const id = Number(this.petId());
      if (id) untracked(() => this.loadPet(id));
    });
  }

  protected price(s: { price: number; sizePrices: { size: PetSize; price: number }[] }): number {
    return priceForSize(s, this.size());
  }

  protected addressMissing(): boolean {
    return (
      this.form.controls.transport.value !== 'NONE' &&
      this.form.controls.transportAddress.value.trim().length < 5 &&
      (this.submitted() || this.form.controls.transportAddress.touched)
    );
  }

  protected pick(picked: PickedPet | null): void {
    if (picked) this.loadPet(picked.petId);
  }

  protected clearPet(): void {
    this.pet.set(null);
    this.lastInstructions.set(null);
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
      this.addressMissing() ||
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
    const signature = this.signature();
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
        transport: v.transport,
        transportAddress: v.transport === 'NONE' ? null : v.transportAddress.trim(),
        signerName: signature ? v.signerName.trim() || p.pet.client.name : null,
        signature,
      })
      .subscribe({
        next: (session) => {
          this.toast.success(`${session.pet.name} ingresó al tablero (${session.code}).`);
          void this.router.navigate(['/grooming']);
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
        this.form.patchValue({
          aggressive: card.pet.aggressive,
          signerName: card.pet.client.name,
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
