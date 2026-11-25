import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime, distinctUntilChanged, filter, switchMap, of, catchError, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BuyerInput, BuyerProposal, LookupResult } from '../../../core/services/billing.models';
import { BillingService } from '../../../core/services/billing.service';
import { isValidRuc } from '../../utils/validators';
import { IconComponent } from '../icon/icon.component';

export type BuyerMode = 'RUC' | 'DNI';

/** Formulario del comprador: la página lo crea y lee; este componente lo llena y valida. */
export function buyerForm() {
  return new FormGroup({
    docNumber: new FormControl('', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.email, Validators.maxLength(120)],
    }),
  });
}
export type BuyerForm = ReturnType<typeof buyerForm>;

/**
 * Lo que se envía al cobrar. undefined = no hace falta (o se usan los datos ya guardados del
 * cliente, que el servidor completa solo).
 */
export function buyerPayload(
  form: BuyerForm,
  mode: BuyerMode | null,
  save: boolean,
): BuyerInput | undefined {
  if (!mode || form.disabled) return undefined;
  const v = form.getRawValue();
  return {
    docType: mode,
    docNumber: v.docNumber.replace(/\D/g, ''),
    // Un texto pegado con saltos de línea queda en una sola línea
    name: v.name.replace(/\s+/g, ' ').trim(),
    address: mode === 'RUC' ? v.address.replace(/\s+/g, ' ').trim() || null : null,
    email: mode === 'RUC' ? v.email.trim() || null : null,
    save,
  };
}

const digitsOnly = (v: string) => v.replace(/\D/g, '');
const validNumber = (mode: BuyerMode, v: string) =>
  mode === 'RUC' ? isValidRuc(v) : /^\d{8}$/.test(v);

/** Las respuestas vacías del servidor ({} o null) significan "no hay" */
const present = <T extends object>(v: T | null | undefined): T | null =>
  v && Object.keys(v).length ? v : null;

/**
 * "Datos del comprador" dentro del cobro: el RUC para la factura (puede ser la empresa del
 * cliente) o el DNI para la boleta de más de S/ 700. Si el cliente ya tiene datos de facturación se
 * muestran en una línea con "Cambiar"; si no, se piden aquí mismo. Al escribir un RUC o DNI
 * válido busca el nombre (primero en la clínica, luego en APISPERU); si no aparece, se escribe.
 */
@Component({
  selector: 'app-buyer-fields',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="h-16 animate-pulse rounded-xl bg-slate-100" aria-busy="true"></div>
    } @else if (proposal() && form().disabled) {
      <div
        class="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200"
        data-testid="buyer-summary"
      >
        <div class="min-w-0">
          <p class="text-xs text-slate-500">Factura a</p>
          <p class="font-medium break-words text-slate-900">{{ proposal()!.name }}</p>
          <p class="text-xs tabular-nums text-slate-600">RUC {{ proposal()!.docNumber }}</p>
        </div>
        <button type="button" class="btn btn-secondary shrink-0" (click)="change()">Cambiar</button>
      </div>
    } @else {
      <!-- Compacto: solo el número; lo encontrado se muestra en una tarjeta -->
      <fieldset
        class="space-y-2.5 rounded-xl bg-white p-3 ring-1 ring-slate-200"
        [formGroup]="form()"
        data-testid="buyer-form"
      >
        <legend class="sr-only">
          {{ mode() === 'RUC' ? 'Datos para la factura' : 'DNI del comprador' }}
        </legend>
        <div>
          <label for="buyer-doc" class="field-label">{{
            mode() === 'RUC' ? 'RUC para la factura' : 'DNI de quien compra'
          }}</label>
          @if (mode() === 'DNI') {
            <p class="text-xs text-slate-500">
              Más de S/ 700: SUNAT pide el DNI. El nombre sale solo.
            </p>
          }
          <div class="relative">
            <input
              id="buyer-doc"
              formControlName="docNumber"
              class="field-input pr-24 tabular-nums"
              inputmode="numeric"
              autocomplete="off"
              [maxlength]="mode() === 'RUC' ? 11 : 8"
              [placeholder]="mode() === 'RUC' ? '11 dígitos' : '8 dígitos'"
              [attr.aria-invalid]="invalid('docNumber')"
              aria-describedby="buyer-doc-status"
            />
            @if (lookupState() === 'searching') {
              <span
                class="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-anil-600"
                aria-hidden="true"
              ></span>
            } @else if (lookupState() === 'found') {
              <span
                class="absolute top-1/2 right-3 inline-flex -translate-y-1/2 items-center gap-1 text-xs font-medium text-emerald-700"
                ><app-icon name="check" class="size-4" />{{ sourceLabel() }}</span
              >
            } @else if (numberOk()) {
              <app-icon
                name="check"
                class="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-emerald-600"
              />
            }
          </div>
          @if (invalid('docNumber')) {
            <p class="field-error">
              {{
                mode() === 'RUC' ? 'RUC no válido: revisa los 11 dígitos' : 'El DNI tiene 8 dígitos'
              }}
            </p>
          }
          <p id="buyer-doc-status" class="sr-only" aria-live="polite">
            @switch (lookupState()) {
              @case ('found') {
                Encontrado: {{ form().controls.name.value }}
              }
              @case ('notfound') {
                No se encontró: escribe {{ mode() === 'RUC' ? 'la razón social' : 'el nombre' }}
              }
            }
          </p>
        </div>

        @if (showCard()) {
          <div
            class="flex items-start gap-2.5 rounded-lg bg-slate-50 p-2.5"
            data-testid="buyer-card"
          >
            <span
              class="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-anil-600 ring-1 ring-slate-200"
              aria-hidden="true"
            >
              <app-icon [name]="mode() === 'RUC' ? 'building' : 'user'" class="size-4" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold break-words text-slate-900">
                {{ form().controls.name.value }}
              </p>
              @if (mode() === 'RUC' && form().controls.address.value) {
                <p class="text-xs break-words text-slate-600">
                  {{ form().controls.address.value }}
                </p>
              }
            </div>
            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-anil-600 pointer-coarse:size-11"
              [attr.aria-label]="officialName() ? 'Editar la dirección' : 'Editar los datos'"
              [title]="officialName() ? 'Editar la dirección' : 'Editar los datos'"
              (click)="editing.set(true)"
            >
              <app-icon name="pencil" class="size-4" />
            </button>
          </div>
        }

        @if (lookupState() === 'notfound') {
          <p class="flex items-start gap-1.5 text-xs text-amber-800">
            <app-icon name="alert" class="mt-px size-3.5 shrink-0" />
            No aparece en {{ mode() === 'RUC' ? 'SUNAT' : 'RENIEC' }}. Revisa el número o escribe
            {{ mode() === 'RUC' ? 'la razón social' : 'el nombre' }}.
          </p>
        }

        @if (showName()) {
          <div>
            <label for="buyer-name" class="field-label">{{
              mode() === 'RUC' ? 'Razón social' : 'Nombre completo'
            }}</label>
            <!-- Razones sociales largas: crece en vez de cortarse -->
            <textarea
              id="buyer-name"
              formControlName="name"
              rows="1"
              class="field-input h-auto min-h-11 resize-none py-2.5 leading-6 [field-sizing:content]"
              maxlength="150"
              [placeholder]="mode() === 'RUC' ? 'Como figura en su RUC' : ''"
              (keydown.enter)="$event.preventDefault()"
              [attr.aria-invalid]="invalid('name')"
            ></textarea>
            @if (invalid('name')) {
              <p class="field-error">
                {{ mode() === 'RUC' ? 'Escribe la razón social' : 'Escribe el nombre' }}
              </p>
            }
          </div>
        }

        @if (mode() === 'RUC' && (editing() || (lookupState() === 'notfound' && numberOk()))) {
          <div>
            <label for="buyer-address" class="field-label"
              >Dirección fiscal <span class="font-normal text-slate-500">(opcional)</span></label
            >
            <textarea
              id="buyer-address"
              formControlName="address"
              rows="1"
              class="field-input h-auto min-h-11 resize-none py-2.5 leading-6 [field-sizing:content]"
              maxlength="200"
              (keydown.enter)="$event.preventDefault()"
            ></textarea>
          </div>
          @if (editing()) {
            <button
              type="button"
              class="text-sm font-medium text-anil-700 hover:text-anil-900"
              (click)="editing.set(false)"
            >
              Listo
            </button>
          }
        }

        @if (warning(); as w) {
          <p
            class="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200"
            role="status"
          >
            <app-icon name="alert" class="mt-px size-4 shrink-0" />
            {{ w }}
          </p>
        }

        @if (mode() === 'RUC') {
          @if (emailOpen() || form().controls.email.value) {
            <div>
              <label for="buyer-email" class="field-label"
                >Correo para el PDF
                <span class="font-normal text-slate-500">(opcional)</span></label
              >
              <input
                id="buyer-email"
                type="email"
                formControlName="email"
                class="field-input"
                placeholder="empresa@correo.com"
                [attr.aria-invalid]="invalid('email')"
              />
              @if (invalid('email')) {
                <p class="field-error">El correo no es válido</p>
              }
            </div>
          } @else {
            <button
              type="button"
              class="inline-flex min-h-8 items-center gap-1.5 rounded-md text-sm font-medium text-anil-700 hover:text-anil-900 focus-visible:outline-2 focus-visible:outline-anil-600"
              (click)="openEmail()"
            >
              <app-icon name="mail" class="size-4" /> Enviar el PDF por correo
            </button>
          }
        }
        @if (saveNote(); as note) {
          <p class="flex items-start gap-1.5 text-xs text-slate-500">
            <app-icon name="info" class="mt-px size-3.5 shrink-0 text-slate-400" />
            {{ note }}
          </p>
        }
      </fieldset>
    }
  `,
})
export class BuyerFieldsComponent {
  private readonly billing = inject(BillingService);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = input.required<BuyerForm>();
  readonly mode = input.required<BuyerMode>();
  /** Cliente registrado (null = cliente varios o sin cliente) */
  readonly clientId = input<number | null>(null);
  readonly clientName = input<string | null>(null);

  protected readonly proposal = signal<BuyerProposal | null>(null);
  protected readonly loading = signal(false);
  protected readonly lookupState = signal<'idle' | 'searching' | 'found' | 'notfound'>('idle');
  protected readonly info = signal<LookupResult | null>(null);
  protected readonly numberOk = signal(false);
  /** Lo último que llenó la búsqueda: si la cajera lo cambió, no se pisa */
  private autoName = '';
  private autoAddress = '';
  /** Lápiz de la tarjeta: muestra la dirección (y el nombre si no vino de SUNAT/RENIEC) */
  protected readonly editing = signal(false);
  protected readonly emailOpen = signal(false);

  /** El nombre vino de SUNAT o RENIEC: no se edita (debe coincidir con el documento) */
  protected officialName(): boolean {
    const i = this.info();
    return this.lookupState() === 'found' && !!i && i.source !== 'LOCAL';
  }

  protected sourceLabel(): string {
    if (this.info()?.source === 'LOCAL') return 'Clínica';
    return this.mode() === 'RUC' ? 'SUNAT' : 'RENIEC';
  }

  /** Tarjeta con lo encontrado (o con lo que ya tenía al tocar "Cambiar") */
  protected showCard(): boolean {
    const f = this.form();
    if (this.lookupState() === 'notfound' || this.lookupState() === 'searching') return false;
    if (this.editing() && !this.officialName()) return false;
    return this.numberOk() && !!f.controls.name.value.trim();
  }

  /** El campo del nombre: si no se encontró, al editar datos no oficiales, o si falta y se intentó cobrar */
  protected showName(): boolean {
    if (this.showCard()) return false;
    if (this.lookupState() === 'notfound') return true;
    if (this.editing()) return true;
    return this.numberOk() && this.lookupState() === 'idle';
  }

  protected openEmail(): void {
    this.emailOpen.set(true);
    queueMicrotask(() => document.getElementById('buyer-email')?.focus());
  }

  constructor() {
    // Nuevo cobro, otro cliente o boleta ↔ factura: se arma de nuevo
    effect(() => {
      const form = this.form();
      const mode = this.mode();
      const clientId = this.clientId();
      untracked(() => this.setup(form, mode, clientId));
    });
    // Al escribir un número válido, busca el nombre
    effect((onCleanup) => {
      const form = this.form();
      const sub = form.controls.docNumber.valueChanges
        .pipe(
          tap((v) => {
            const clean = digitsOnly(v);
            if (clean !== v) form.controls.docNumber.setValue(clean, { emitEvent: false });
            this.numberOk.set(validNumber(this.mode(), clean));
            if (!this.numberOk()) {
              this.lookupState.set('idle');
              this.info.set(null);
            }
          }),
          debounceTime(250),
          distinctUntilChanged(),
          filter((v) => validNumber(this.mode(), digitsOnly(v))),
          tap(() => this.lookupState.set('searching')),
          switchMap((v) =>
            this.billing.lookup(this.mode(), digitsOnly(v)).pipe(catchError(() => of(null))),
          ),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((result) => this.applyLookup(form, present(result)));
      onCleanup(() => sub.unsubscribe());
    });
  }

  protected invalid(name: 'docNumber' | 'name' | 'email'): boolean {
    const c = this.form().controls[name];
    return c.invalid && c.touched;
  }

  /** Aviso si SUNAT dice que el RUC no está activo o no es habido */
  protected warning(): string | null {
    const i = this.info();
    if (!i || this.mode() !== 'RUC') return null;
    const bad: string[] = [];
    if (i.status && i.status !== 'ACTIVO') bad.push(`está "${i.status}"`);
    if (i.condition && i.condition !== 'HABIDO') bad.push(`figura como "${i.condition}"`);
    return bad.length
      ? `Este RUC ${bad.join(' y ')} en SUNAT: la factura podría ser rechazada. Confírmalo con el cliente.`
      : null;
  }

  protected saveNote(): string | null {
    const name = this.clientName();
    if (!this.clientId() || !name) return null;
    return this.mode() === 'RUC'
      ? `Se guardará en la ficha de ${name} para la próxima factura.`
      : `Si ${name} no tiene documento, se guardará en su ficha.`;
  }

  protected change(): void {
    const p = this.proposal();
    const form = this.form();
    form.enable();
    if (p) {
      form.reset({
        docNumber: p.docNumber,
        name: p.name,
        address: p.address ?? '',
        email: p.email ?? '',
      });
      this.numberOk.set(true);
    }
    queueMicrotask(() => document.getElementById('buyer-doc')?.focus());
  }

  private setup(form: BuyerForm, mode: BuyerMode, clientId: number | null): void {
    form.controls.docNumber.setValidators([
      Validators.required,
      (c) => (validNumber(mode, String(c.value ?? '')) ? null : { number: true }),
    ]);
    form.controls.name.setValidators([Validators.required, Validators.maxLength(150)]);
    form.reset({ docNumber: '', name: '', address: '', email: '' });
    form.enable();
    this.proposal.set(null);
    this.info.set(null);
    this.lookupState.set('idle');
    this.numberOk.set(false);
    this.autoName = '';
    this.autoAddress = '';
    this.editing.set(false);
    this.emailOpen.set(false);
    if (mode !== 'RUC' || !clientId) return;
    this.loading.set(true);
    // Mientras carga, no se puede cobrar con el formulario vacío
    form.disable();
    this.billing.buyer(clientId).subscribe({
      next: (p) => {
        this.loading.set(false);
        const found = present(p);
        this.proposal.set(found);
        if (!found) form.enable();
      },
      error: () => {
        this.loading.set(false);
        form.enable();
      },
    });
  }

  private applyLookup(form: BuyerForm, result: LookupResult | null): void {
    this.info.set(result);
    this.lookupState.set(result ? 'found' : 'notfound');
    if (!result) return;
    const { name, address } = form.controls;
    if (!name.value.trim() || name.value === this.autoName) {
      name.setValue(result.name);
      this.autoName = result.name;
    }
    if (this.mode() === 'RUC' && result.address) {
      if (!address.value.trim() || address.value === this.autoAddress) {
        address.setValue(result.address);
        this.autoAddress = result.address;
      }
    }
  }
}
