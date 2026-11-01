import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SPECIES_LABELS } from '../../core/services/clients.models';
import { ClientsService } from '../../core/services/clients.service';
import { CONSENT_TYPE_LABELS, ConsentType } from '../../core/services/documents.models';
import { DocumentsService } from '../../core/services/documents.service';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { ImmunizationCard } from '../../core/services/medical.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { SignaturePadComponent } from '../../shared/ui/signature-pad/signature-pad.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';

interface Signer {
  key: string;
  name: string;
  document: string | null;
  relation: string;
}

const TYPES: { value: ConsentType; icon: IconName; hint: string }[] = [
  { value: 'SURGERY', icon: 'scissors', hint: 'Castración, cirugías, extracciones' },
  { value: 'ANESTHESIA', icon: 'syringe', hint: 'Sedación para profilaxis, estudios' },
  { value: 'HOSPITALIZATION', icon: 'activity', hint: 'Internamiento y tratamiento' },
  { value: 'EUTHANASIA', icon: 'file-text', hint: 'Solicitud del propietario' },
  { value: 'OTHER', icon: 'pen-line', hint: 'Cualquier otro procedimiento' },
];

const PROCEDURE_PLACEHOLDER: Record<ConsentType, string> = {
  SURGERY: 'Ej.: Ovariohisterectomía (castración)',
  ANESTHESIA: 'Ej.: Profilaxis dental con sedación',
  HOSPITALIZATION: 'Ej.: Gastroenteritis con deshidratación',
  EUTHANASIA: 'Ej.: Insuficiencia renal terminal sin respuesta al tratamiento',
  OTHER: 'Ej.: Transfusión sanguínea',
};

/**
 * Consentimiento informado firmado en pantalla (tablet o celular). El texto parte de un modelo
 * con los datos del paciente y el veterinario puede ajustarlo; lo firmado queda inalterable.
 */
@Component({
  selector: 'app-consent-sign-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, SignaturePadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl space-y-6">
      <a
        [routerLink]="backLink()"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <app-icon name="chevron-left" class="size-4" />
        {{ atencion() ? 'Volver a la atención' : 'Historia clínica' }}
      </a>

      <header>
        <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Consentimiento informado
        </p>
        <h1 class="font-display text-2xl font-semibold text-slate-900">
          @if (card(); as c) {
            {{ c.pet.name }}
            <span class="text-base font-normal text-slate-500">
              · {{ speciesLabels[c.pet.species] }} · {{ c.pet.client.name }}
            </span>
          } @else {
            Cargando…
          }
        </h1>
      </header>

      @if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
        </div>
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="space-y-6"
          novalidate
          aria-label="Consentimiento informado"
        >
          <!-- 1. Tipo y procedimiento -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="soap-legend"><span class="soap-letter">1</span> Procedimiento</legend>
            <div
              class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
              role="radiogroup"
              aria-label="Tipo"
            >
              @for (t of types; track t.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="form.controls.type.value === t.value"
                  [attr.data-value]="t.value"
                  class="flex min-h-16 items-start gap-3 rounded-xl px-3.5 py-3 text-left ring-1 transition-colors"
                  [class]="
                    form.controls.type.value === t.value
                      ? 'bg-anil-50 ring-2 ring-anil-600'
                      : 'bg-white ring-slate-200 hover:ring-slate-300'
                  "
                  (click)="setType(t.value)"
                >
                  <app-icon
                    [name]="t.icon"
                    class="mt-0.5 size-5 shrink-0"
                    [class]="
                      form.controls.type.value === t.value ? 'text-anil-700' : 'text-slate-400'
                    "
                  />
                  <span>
                    <span class="block text-sm font-semibold text-slate-900">{{
                      labels[t.value]
                    }}</span>
                    <span class="block text-xs text-slate-500">{{ t.hint }}</span>
                  </span>
                </button>
              }
            </div>
            <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div class="sm:flex-1">
                <label for="c-procedure" class="field-label">
                  {{ form.controls.type.value === 'EUTHANASIA' ? 'Motivo' : 'Procedimiento' }}
                  <span class="text-rose-600" aria-hidden="true">*</span>
                </label>
                <input
                  id="c-procedure"
                  class="field-input"
                  formControlName="procedure"
                  maxlength="200"
                  autocomplete="off"
                  [placeholder]="placeholder()"
                  [attr.aria-invalid]="invalid('procedure')"
                />
              </div>
              <button
                type="button"
                class="btn btn-secondary self-start sm:self-auto"
                [disabled]="loadingText()"
                (click)="loadTemplate()"
              >
                @if (loadingText()) {
                  <app-icon name="loader" class="size-4 animate-spin" />
                } @else {
                  <app-icon name="refresh" class="size-4" />
                }
                {{ form.controls.text.value ? 'Rehacer texto' : 'Preparar texto' }}
              </button>
            </div>
            @if (invalid('procedure')) {
              <p class="field-error">Describe el procedimiento (mínimo 3 letras)</p>
            }
          </fieldset>

          <!-- 2. Texto -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="soap-legend"><span class="soap-letter">2</span> Texto a firmar</legend>
            @if (form.controls.text.value || textOpen()) {
              <p class="mb-2 text-sm text-slate-500">
                Léelo con el propietario. Puedes ajustarlo antes de firmar; después ya no cambia.
              </p>
              <label for="c-text" class="sr-only">Texto del consentimiento</label>
              <textarea
                id="c-text"
                class="field-input min-h-80 font-serif text-[15px] leading-relaxed"
                formControlName="text"
                maxlength="20000"
                [attr.aria-invalid]="invalid('text')"
              ></textarea>
              @if (invalid('text')) {
                <p class="field-error">El texto está incompleto</p>
              }
            } @else {
              <p
                class="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200"
              >
                Elige el tipo, escribe el procedimiento y toca <strong>Preparar texto</strong>.
              </p>
              @if (invalid('text')) {
                <p class="field-error">Prepara el texto del consentimiento</p>
              }
            }
          </fieldset>

          <!-- 3. Firmante -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="soap-legend"><span class="soap-letter">3</span> Quién firma</legend>
            @if (signers().length > 1) {
              <div class="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Firmante">
                @for (s of signers(); track s.key) {
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="signerKey() === s.key"
                    class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition-colors"
                    [class]="
                      signerKey() === s.key
                        ? 'bg-anil-600 text-white ring-anil-600'
                        : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-400'
                    "
                    (click)="pickSigner(s)"
                  >
                    {{ s.name }} · {{ s.relation }}
                  </button>
                }
              </div>
            }
            <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
              <div>
                <label for="c-signer" class="field-label"
                  >Nombre completo <span class="text-rose-600" aria-hidden="true">*</span></label
                >
                <input
                  id="c-signer"
                  class="field-input"
                  formControlName="signerName"
                  maxlength="150"
                  autocomplete="off"
                  [attr.aria-invalid]="invalid('signerName')"
                />
              </div>
              <div>
                <label for="c-doc" class="field-label">DNI / CE</label>
                <input
                  id="c-doc"
                  class="field-input tabular-nums"
                  formControlName="signerDocument"
                  maxlength="20"
                  inputmode="numeric"
                  autocomplete="off"
                />
              </div>
              <div>
                <label for="c-rel" class="field-label"
                  >Relación <span class="text-rose-600" aria-hidden="true">*</span></label
                >
                <input
                  id="c-rel"
                  class="field-input"
                  formControlName="signerRelation"
                  maxlength="40"
                  autocomplete="off"
                  list="c-relations"
                  [attr.aria-invalid]="invalid('signerRelation')"
                />
                <datalist id="c-relations">
                  <option value="Propietario(a)"></option>
                  <option value="Familiar del propietario"></option>
                  <option value="Responsable autorizado"></option>
                </datalist>
              </div>
            </div>
            @if (invalid('signerName') || invalid('signerRelation')) {
              <p class="field-error">Completa el nombre y la relación con la mascota</p>
            }
          </fieldset>

          <!-- 4. Firma -->
          <fieldset class="card p-5 sm:p-6">
            <legend class="soap-legend"><span class="soap-letter">4</span> Firma</legend>
            <app-signature-pad
              [label]="'Firma de ' + (form.controls.signerName.value || 'quien autoriza')"
              [invalid]="invalid('signature')"
              (changed)="form.controls.signature.setValue($event ?? '')"
            />
            @if (invalid('signature')) {
              <p class="field-error">Falta la firma</p>
            }
            <label class="mt-4 flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                class="mt-0.5 size-5 shrink-0 rounded border-slate-300 accent-anil-600"
                formControlName="read"
              />
              <span>
                El firmante leyó el documento, recibió las explicaciones del médico veterinario y
                firma de forma libre y voluntaria.
              </span>
            </label>
            @if (invalid('read')) {
              <p class="field-error">Confirma que el firmante leyó el documento</p>
            }
          </fieldset>

          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <a [routerLink]="backLink()" class="btn btn-secondary">Cancelar</a>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">
              @if (saving()) {
                <app-icon name="loader" class="size-4 animate-spin" />
              } @else {
                <app-icon name="shield-check" class="size-4" />
              }
              Guardar consentimiento firmado
            </button>
          </div>
        </form>
      }
    </section>
  `,
})
export class ConsentSignPage {
  private readonly documents = inject(DocumentsService);
  private readonly immunizations = inject(ImmunizationsService);
  private readonly clients = inject(ClientsService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** :id de la mascota */
  readonly id = input.required<string>();
  /** ?atencion= */
  readonly atencion = input<string | undefined>();

  protected readonly types = TYPES;
  protected readonly labels = CONSENT_TYPE_LABELS;
  protected readonly speciesLabels = SPECIES_LABELS;

  protected readonly card = signal<ImmunizationCard | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly signers = signal<Signer[]>([]);
  protected readonly signerKey = signal<string | null>(null);
  protected readonly loadingText = signal(false);
  protected readonly textOpen = signal(false);
  protected readonly saving = signal(false);
  private readonly submitted = signal(false);

  protected readonly form = new FormGroup({
    type: new FormControl<ConsentType>('SURGERY', { nonNullable: true }),
    procedure: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    }),
    text: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(50)],
    }),
    signerName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(150)],
    }),
    signerDocument: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(20),
    }),
    signerRelation: new FormControl('Propietario(a)', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(40)],
    }),
    signature: new FormControl('', { nonNullable: true, validators: Validators.required }),
    read: new FormControl(false, { nonNullable: true, validators: Validators.requiredTrue }),
  });

  private readonly type = signal<ConsentType>('SURGERY');
  protected readonly placeholder = computed(() => PROCEDURE_PLACEHOLDER[this.type()]);
  protected readonly backLink = computed(() =>
    this.atencion() ? ['/atenciones', this.atencion()] : ['/mascotas', this.id()],
  );

  constructor() {
    effect(() => {
      const petId = Number(this.id());
      this.immunizations.card(petId).subscribe({
        next: (card) => {
          this.card.set(card);
          this.loadSigners(card.pet.client.id, card.pet.client.name);
        },
        error: (error: unknown) =>
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la mascota.')),
      });
    });
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || this.submitted());
  }

  protected setType(type: ConsentType): void {
    this.form.controls.type.setValue(type);
    this.type.set(type);
  }

  protected pickSigner(s: Signer): void {
    this.signerKey.set(s.key);
    this.form.patchValue({
      signerName: s.name,
      signerDocument: s.document ?? '',
      signerRelation: s.relation,
    });
  }

  protected loadTemplate(): void {
    const procedure = this.form.controls.procedure;
    if (procedure.invalid) {
      procedure.markAsTouched();
      return;
    }
    if (
      this.form.controls.text.dirty &&
      !window.confirm('Se reemplazará el texto que editaste. ¿Continuar?')
    )
      return;
    this.loadingText.set(true);
    this.documents
      .template(this.form.controls.type.value, Number(this.id()), procedure.value.trim())
      .subscribe({
        next: (t) => {
          this.loadingText.set(false);
          this.textOpen.set(true);
          this.form.controls.text.reset(t.text);
        },
        error: (error: unknown) => {
          this.loadingText.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.documents
      .sign({
        petId: Number(this.id()),
        visitId: this.atencion() ? Number(this.atencion()) : undefined,
        type: v.type,
        procedure: v.procedure.trim(),
        text: v.text.trim(),
        signerName: v.signerName.trim(),
        signerDocument: v.signerDocument.trim() || null,
        signerRelation: v.signerRelation.trim(),
        signature: v.signature,
      })
      .subscribe({
        next: (consent) => {
          this.toast.success(`Consentimiento ${consent.code} guardado.`);
          void this.router.navigate(['/consentimientos', consent.id]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  private loadSigners(clientId: number, ownerName: string): void {
    const owner: Signer = {
      key: 'owner',
      name: ownerName,
      document: null,
      relation: 'Propietario(a)',
    };
    this.signers.set([owner]);
    this.pickSigner(owner);
    this.clients.get(clientId).subscribe({
      next: (client) => {
        const ownerFull: Signer = { ...owner, name: client.name, document: client.docNumber };
        const others = client.authorized.map<Signer>((p) => ({
          key: `a${p.id}`,
          name: p.name,
          document: p.dni,
          relation: p.relation || 'Responsable autorizado',
        }));
        this.signers.set([ownerFull, ...others]);
        if (this.signerKey() === 'owner' && !this.form.controls.signerName.dirty)
          this.pickSigner(ownerFull);
      },
      error: () => undefined,
    });
  }
}
