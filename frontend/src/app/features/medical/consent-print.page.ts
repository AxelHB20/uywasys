import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { SessionService } from '../../core/auth/session.service';
import { SPECIES_LABELS } from '../../core/services/clients.models';
import { ConsentDocument } from '../../core/services/documents.models';
import { DocumentsService } from '../../core/services/documents.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';

/**
 * Consentimiento firmado, imprimible en A4. Muestra la firma, la fecha y hora exactas y la
 * huella SHA-256 del contenido: si alguien alterara el registro, la huella dejaría de coincidir.
 */
@Component({
  selector: 'app-consent-print-page',
  imports: [BackLinkComponent, ReactiveFormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        @if (doc(); as d) {
          <app-back-link
            [fallback]="d.visitId ? '/atenciones/' + d.visitId : '/mascotas/' + d.pet.id"
            [fallbackLabel]="d.visitId ? 'Atención de ' + d.pet.name : 'Historia de ' + d.pet.name"
          />
          <div class="flex flex-wrap gap-2">
            @if (canVoid()) {
              <button type="button" class="btn btn-secondary" (click)="openVoid()">Anular</button>
            }
            @if (!d.voidedAt) {
              <button type="button" class="btn btn-primary" (click)="print()">
                <app-icon name="file-text" class="size-4" /> Imprimir
              </button>
            }
          </div>
        }
      </div>

      @if (doc()?.voidedAt) {
        <div
          class="mx-auto flex max-w-[210mm] gap-3 rounded-2xl bg-rose-50 p-4 text-rose-900 ring-1 ring-rose-200 print:hidden"
          role="status"
        >
          <app-icon name="alert" class="mt-0.5 size-5 shrink-0 text-rose-600" />
          <p>
            <span class="font-semibold">Anulado el {{ dateTime(doc()!.voidedAt!) }}.</span>
            {{ doc()!.voidReason }}
          </p>
        </div>
      }

      @if (loading()) {
        <div class="card mx-auto h-[600px] max-w-[210mm] animate-pulse" aria-busy="true"></div>
      } @else if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
        </div>
      } @else if (doc(); as d) {
        <article
          class="print-sheet relative mx-auto flex min-h-[270mm] max-w-[210mm] flex-col bg-white p-10 text-[12.5px] leading-relaxed text-black shadow-card ring-1 ring-slate-200 max-sm:p-5"
        >
          @if (d.voidedAt) {
            <p
              class="absolute inset-x-10 top-1/3 -rotate-12 rounded-lg border-4 border-rose-600 py-2 text-center font-display text-4xl font-bold tracking-widest text-rose-600 opacity-80"
            >
              ANULADO
            </p>
          }
          <header class="flex items-start gap-4 border-b-2 border-black pb-3">
            @if (logoUrl(); as logo) {
              <img
                [src]="logo"
                alt=""
                class="h-16 w-auto max-w-[45mm] object-contain"
                (error)="logoFailed.set(true)"
              />
            }
            <div class="min-w-0 flex-1">
              <p class="font-display text-base font-bold break-words">{{ d.clinic.name }}</p>
              @if (d.clinic.ruc) {
                <p>RUC {{ d.clinic.ruc }}</p>
              }
              @if (d.clinic.address) {
                <p>{{ d.clinic.address }}</p>
              }
              @if (d.clinic.phone) {
                <p>Tel. {{ d.clinic.phone }}</p>
              }
            </div>
            <div class="shrink-0 text-right">
              <p class="text-[10px] font-semibold tracking-wide uppercase">N.º</p>
              <p class="font-display text-[15px] font-bold">{{ d.code }}</p>
            </div>
          </header>

          <h1 class="mt-5 text-center font-display text-[16px] font-bold uppercase">
            {{ d.title }}
          </h1>

          <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-black px-3 py-2">
            <div class="flex gap-1">
              <dt class="font-semibold">Paciente:</dt>
              <dd>{{ d.pet.name }} · {{ petCode(d.pet.number) }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Especie:</dt>
              <dd>
                {{ speciesLabels[d.pet.species] }}{{ d.pet.breed ? ' · ' + d.pet.breed : '' }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Propietario:</dt>
              <dd class="break-words">{{ d.client.name }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Teléfono:</dt>
              <dd>{{ formatPhone(d.client.phone) }}</dd>
            </div>
          </dl>

          <div class="mt-5 text-justify whitespace-pre-line">{{ d.text }}</div>

          <footer class="mt-auto grid grid-cols-2 gap-10 pt-10">
            <div class="text-center">
              <img
                [src]="d.signature"
                alt="Firma de {{ d.signerName }}"
                class="mx-auto h-24 w-full object-contain"
              />
              <div class="border-t border-black pt-1">
                <p class="font-semibold">{{ d.signerName }}</p>
                <p>
                  {{ d.signerRelation }}
                  @if (d.signerDocument) {
                    · Doc. {{ d.signerDocument }}
                  }
                </p>
                <p class="text-[11px]">Firmado el {{ dateTime(d.signedAt) }}</p>
              </div>
            </div>
            <div class="flex flex-col justify-end text-center">
              <div class="border-t border-black pt-1">
                <p class="font-semibold">{{ d.vet.fullName }}</p>
                <p>Médico veterinario · C.M.V.P. {{ d.vet.licenseNumber ?? '—' }}</p>
              </div>
            </div>
          </footer>
          <p class="mt-6 border-t border-slate-300 pt-2 text-[9px] break-all text-slate-600">
            Firmado electrónicamente en pantalla y registrado en Uywa. Huella SHA-256 del documento:
            {{ d.hash }}
          </p>
        </article>
      }
    </section>

    <app-modal
      [open]="voiding()"
      title="Anular consentimiento"
      description="No se borra: queda anulado con el motivo y se registra quién lo hizo. Si hace falta, firma uno nuevo."
      [dismissible]="false"
      (closed)="voiding.set(false)"
    >
      <form id="void-consent-form" (submit)="$event.preventDefault(); confirmVoid()" novalidate>
        <label for="void-consent-reason" class="field-label"
          >Motivo <span class="text-rose-600" aria-hidden="true">*</span></label
        >
        <input
          id="void-consent-reason"
          class="field-input"
          [formControl]="reason"
          maxlength="200"
          autocomplete="off"
          [attr.aria-invalid]="reason.invalid && reason.touched"
        />
        @if (reason.invalid && reason.touched) {
          <p class="field-error">Escribe el motivo (mínimo 3 letras)</p>
        }
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="voiding.set(false)">Volver</button>
        <button type="submit" form="void-consent-form" class="btn btn-danger" [disabled]="saving()">
          Anular
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class ConsentPrintPage {
  private readonly api = inject(DocumentsService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  readonly id = input.required<string>();

  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly dateTime = (value: string) => formatDate(value, 'datetime');

  protected readonly doc = signal<ConsentDocument | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl = computed(() =>
    this.logoFailed() ? null : (this.doc()?.clinic.logoUrl ?? null),
  );
  protected readonly canVoid = computed(() => {
    const d = this.doc();
    if (!d || d.voidedAt) return false;
    return this.session.role() === 'ADMIN' || d.vet.id === this.session.user()?.id;
  });

  protected readonly voiding = signal(false);
  protected readonly saving = signal(false);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.loading.set(true);
      this.api.consent(id).subscribe({
        next: (doc) => {
          this.doc.set(doc);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el consentimiento.'));
          this.loading.set(false);
        },
      });
    });
  }

  protected print(): void {
    const style = this.document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }';
    this.document.head.appendChild(style);
    window.print();
    style.remove();
  }

  protected openVoid(): void {
    this.reason.reset('');
    this.voiding.set(true);
  }

  protected confirmVoid(): void {
    const d = this.doc();
    if (!d || this.saving()) return;
    if (this.reason.invalid) {
      this.reason.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.api.voidConsent(d.id, this.reason.value.trim()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.voiding.set(false);
        this.doc.set(updated);
        this.toast.success('Consentimiento anulado.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
