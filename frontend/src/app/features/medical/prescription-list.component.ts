import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { PrescriptionSummary, posology } from '../../core/services/medical.models';
import { PrescriptionsService } from '../../core/services/prescriptions.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

/** Recetas de una atención: cada una con sus medicamentos, para imprimir o anular. */
@Component({
  selector: 'app-prescription-list',
  imports: [ReactiveFormsModule, RouterLink, FechaPipe, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @for (rx of items(); track rx.id) {
        <article
          class="rounded-2xl p-4 ring-1"
          [class]="rx.voidedAt ? 'bg-slate-50 ring-slate-200' : 'bg-white ring-slate-200'"
        >
          <header class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="flex items-center gap-2">
                <span class="font-display text-base font-semibold text-slate-900">{{
                  rx.code
                }}</span>
                @if (rx.voidedAt) {
                  <span
                    class="rounded-md bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700"
                    >Anulada</span
                  >
                }
              </p>
              <p class="text-xs text-slate-500">
                {{ rx.vet.fullName }}
                @if (rx.vet.licenseNumber) {
                  · CMVP {{ rx.vet.licenseNumber }}
                }
                · {{ rx.createdAt | fecha: 'datetime' }}
              </p>
            </div>
            @if (!rx.voidedAt) {
              <div class="flex gap-2">
                <a [routerLink]="['/recetas', rx.id]" class="btn btn-secondary h-10 px-3">
                  <app-icon name="file-text" class="size-4" /> Imprimir
                </a>
                @if (canVoid(rx)) {
                  <button
                    type="button"
                    class="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    [attr.aria-label]="'Anular receta ' + rx.code"
                    (click)="askVoid(rx)"
                  >
                    <app-icon name="trash" class="size-4" />
                  </button>
                }
              </div>
            }
          </header>
          <ol class="mt-3 space-y-2" [class.opacity-60]="rx.voidedAt">
            @for (item of rx.items; track item.id) {
              <li class="flex gap-3 text-sm">
                <span class="font-display font-semibold text-anil-600" aria-hidden="true">℞</span>
                <div class="min-w-0">
                  <p class="font-medium text-slate-900" [class.line-through]="rx.voidedAt">
                    {{ item.drug }}
                    @if (item.controlled) {
                      <span
                        class="ml-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700"
                        >Controlado</span
                      >
                    }
                  </p>
                  <p class="text-slate-600">{{ posology(item) }}</p>
                  @if (item.instructions) {
                    <p class="text-slate-500">{{ item.instructions }}</p>
                  }
                  @if (item.dispensedQuantity) {
                    <p class="text-xs text-emerald-700">
                      Entregado: {{ formatQty(item.dispensedQuantity) }} × {{ item.presentation }}
                      @if (item.charge?.status === 'VOID') {
                        <span class="text-slate-500">(cargo quitado)</span>
                      }
                    </p>
                  }
                </div>
              </li>
            }
          </ol>
          @if (rx.notes) {
            <p
              class="mt-3 border-t border-slate-100 pt-2 text-sm whitespace-pre-line text-slate-600"
            >
              {{ rx.notes }}
            </p>
          }
          @if (rx.voidedAt) {
            <p class="mt-2 text-xs text-slate-500">Motivo de anulación: {{ rx.voidReason }}</p>
          }
        </article>
      }
    </div>

    <app-modal
      [open]="!!voiding()"
      title="Anular receta"
      description="La receta queda en la historia como anulada, con tu nombre y el motivo."
      [dismissible]="false"
      (closed)="voiding.set(null)"
    >
      @if (voiding(); as rx) {
        <p class="mb-4 text-slate-700">{{ rx.code }} · {{ rx.items.length }} medicamento(s)</p>
        @if (delivered(rx).length) {
          <div
            class="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200"
            role="note"
          >
            <p class="font-medium">Lo entregado se quita de la cuenta y vuelve al inventario:</p>
            <ul class="mt-1 list-disc pl-5">
              @for (item of delivered(rx); track item.id) {
                <li>
                  {{ item.drug }} · {{ formatQty(item.dispensedQuantity!) }} ×
                  {{ item.presentation }}
                </li>
              }
            </ul>
          </div>
        }
      }
      <form id="rx-void-form" (submit)="$event.preventDefault(); confirmVoid()" novalidate>
        <label for="rx-void-reason" class="field-label"
          >Motivo <span class="text-rose-600" aria-hidden="true">*</span></label
        >
        <input
          id="rx-void-reason"
          [formControl]="reason"
          class="field-input"
          autocomplete="off"
          maxlength="200"
          [attr.aria-invalid]="reason.invalid && reason.touched"
        />
        @if (reason.invalid && reason.touched) {
          <p class="field-error">Escribe el motivo (mínimo 3 letras)</p>
        }
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="voiding.set(null)">Volver</button>
        <button type="submit" form="rx-void-form" class="btn btn-danger" [disabled]="saving()">
          Anular receta
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class PrescriptionListComponent {
  private readonly api = inject(PrescriptionsService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  readonly items = input.required<PrescriptionSummary[]>();
  readonly changed = output<PrescriptionSummary>();

  protected readonly posology = posology;
  protected readonly formatQty = formatQty;
  protected readonly voiding = signal<PrescriptionSummary | null>(null);
  protected readonly saving = signal(false);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  protected canVoid(rx: PrescriptionSummary): boolean {
    return this.session.role() === 'ADMIN' || rx.vet.id === this.session.user()?.id;
  }

  protected askVoid(rx: PrescriptionSummary): void {
    this.reason.reset('');
    this.voiding.set(rx);
  }

  /** Lo entregado en la clínica que sigue en la cuenta */
  protected delivered(rx: PrescriptionSummary) {
    return rx.items.filter((i) => i.dispensedQuantity && i.charge && i.charge.status !== 'VOID');
  }

  protected confirmVoid(): void {
    const rx = this.voiding();
    if (!rx || this.saving()) return;
    if (this.reason.invalid) {
      this.reason.markAsTouched();
      return;
    }
    this.saving.set(true);
    const returned = this.delivered(rx).length > 0;
    this.api.void(rx.id, this.reason.value.trim()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.voiding.set(null);
        this.toast.success(
          returned
            ? `Receta ${updated.code} anulada: lo entregado salió de la cuenta y volvió al inventario.`
            : `Receta ${updated.code} anulada.`,
        );
        this.changed.emit(updated);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
