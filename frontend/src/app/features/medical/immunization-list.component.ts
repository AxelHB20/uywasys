import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import {
  IMMUNIZATION_KIND_LABELS,
  Immunization,
  ImmunizationKind,
  dueState,
} from '../../core/services/medical.models';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { apiErrorMessage } from '../../shared/utils/validators';

const KIND_ICONS: Record<ImmunizationKind, IconName> = {
  VACCINE: 'syringe',
  DEWORMING_INTERNAL: 'shield-check',
  DEWORMING_EXTERNAL: 'paw',
};
const DUE_TONE: Record<'overdue' | 'soon' | 'ok', BadgeTone> = {
  overdue: 'danger',
  soon: 'warning',
  ok: 'success',
};

/**
 * Lista del carnet: cada aplicación con su próximo refuerzo. Las anuladas quedan aparte,
 * tachadas y con su motivo (la historia no se borra).
 */
@Component({
  selector: 'app-immunization-list',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, BadgeComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active().length) {
      <ul class="divide-y divide-slate-100" role="list">
        @for (i of active(); track i.id) {
          <li class="flex items-start gap-3 py-3">
            <span
              class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-anil-50 text-anil-600 ring-1 ring-anil-100"
              aria-hidden="true"
            >
              <app-icon [name]="kindIcons[i.kind]" class="size-[18px]" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-semibold text-slate-900">{{ i.name }}</span>
                <span class="text-xs text-slate-500">{{ kindLabels[i.kind] }}</span>
                @if (latest().has(i.id) && due(i); as d) {
                  <app-badge [tone]="dueTone[d.tone]">{{ d.label }}</app-badge>
                }
              </p>
              <p class="mt-0.5 text-sm text-slate-600">
                {{ calendar(i.appliedAt) }}
                @if (i.nextDueAt) {
                  <span class="text-slate-400"> · próxima </span>{{ calendar(i.nextDueAt) }}
                }
              </p>
              <p class="mt-0.5 text-xs text-slate-500">
                @if (i.external) {
                  {{ i.externalClinic ? 'Aplicada en ' + i.externalClinic : 'Antecedente' }}
                  · anotó {{ i.appliedBy.fullName }}
                } @else {
                  {{ i.appliedBy.fullName }}
                  @if (i.appliedBy.licenseNumber) {
                    · CMVP {{ i.appliedBy.licenseNumber }}
                  }
                }
                @if (i.laboratory) {
                  · {{ i.laboratory }}
                }
                @if (i.batchNumber) {
                  · lote {{ i.batchNumber }}
                }
                @if (showVisitLink() && i.visitId) {
                  ·
                  <a [routerLink]="['/atenciones', i.visitId]" class="text-anil-700 hover:underline"
                    >ver atención</a
                  >
                }
              </p>
              @if (i.notes) {
                <p class="mt-1 text-sm text-slate-600">{{ i.notes }}</p>
              }
            </div>
            @if (canVoid()) {
              <button
                type="button"
                class="grid size-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                [attr.aria-label]="'Anular ' + i.name"
                (click)="askVoid(i)"
              >
                <app-icon name="trash" class="size-4" />
              </button>
            }
          </li>
        }
      </ul>
    } @else {
      <p class="py-4 text-sm text-slate-500">{{ empty() }}</p>
    }

    @if (voided().length) {
      <details class="mt-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <summary class="cursor-pointer text-sm font-medium text-slate-600">
          Anuladas ({{ voided().length }})
        </summary>
        <ul class="mt-2 space-y-2" role="list">
          @for (i of voided(); track i.id) {
            <li class="text-sm text-slate-500">
              <span class="line-through">{{ i.name }} · {{ calendar(i.appliedAt) }}</span>
              — {{ i.voidReason }}
            </li>
          }
        </ul>
      </details>
    }

    <app-modal
      [open]="!!voiding()"
      title="Anular registro"
      description="Queda en la historia como anulado, con tu nombre y el motivo."
      [dismissible]="false"
      (closed)="voiding.set(null)"
    >
      @if (voiding(); as v) {
        <p class="mb-4 text-slate-700">{{ v.name }} · {{ calendar(v.appliedAt) }}</p>
      }
      <form [id]="uid" (submit)="$event.preventDefault(); confirmVoid()" novalidate>
        <label [for]="uid + '-reason'" class="field-label"
          >Motivo <span class="text-rose-600" aria-hidden="true">*</span></label
        >
        <input
          [id]="uid + '-reason'"
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
        <button type="submit" [attr.form]="uid" class="btn btn-danger" [disabled]="saving()">
          Anular
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class ImmunizationListComponent {
  private readonly api = inject(ImmunizationsService);
  private readonly toast = inject(ToastService);

  readonly items = input.required<Immunization[]>();
  readonly canVoid = input(false);
  readonly showVisitLink = input(false);
  readonly empty = input('Todavía no hay vacunas ni desparasitaciones registradas.');
  readonly changed = output<Immunization>();

  protected readonly uid = `imm-void-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly kindLabels = IMMUNIZATION_KIND_LABELS;
  protected readonly kindIcons = KIND_ICONS;
  protected readonly dueTone = DUE_TONE;
  protected readonly calendar = (day: string) => formatDate(day, 'calendar');
  private readonly today = limaToday();

  protected readonly active = computed(() => this.items().filter((i) => !i.voidedAt));
  protected readonly voided = computed(() => this.items().filter((i) => i.voidedAt));
  /** Solo la última aplicación de cada vacuna muestra su estado: las anteriores ya se reforzaron */
  protected readonly latest = computed(() => {
    const seen = new Map<string, Immunization>();
    for (const i of this.active()) {
      const key = `${i.kind}|${i.name.toLocaleLowerCase('es')}`;
      const prev = seen.get(key);
      if (
        !prev ||
        i.appliedAt > prev.appliedAt ||
        (i.appliedAt === prev.appliedAt && i.id > prev.id)
      )
        seen.set(key, i);
    }
    return new Set([...seen.values()].map((i) => i.id));
  });

  protected readonly voiding = signal<Immunization | null>(null);
  protected readonly saving = signal(false);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  protected due(i: Immunization) {
    return dueState(i.nextDueAt, this.today);
  }

  protected askVoid(item: Immunization): void {
    this.reason.reset('');
    this.voiding.set(item);
  }

  protected confirmVoid(): void {
    const item = this.voiding();
    if (!item || this.saving()) return;
    if (this.reason.invalid) {
      this.reason.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.api.void(item.id, this.reason.value.trim()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.voiding.set(null);
        this.toast.success('Registro anulado.');
        this.changed.emit(updated);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
