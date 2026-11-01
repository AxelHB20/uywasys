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
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import {
  COMMON_IMMUNIZATIONS,
  IMMUNIZATION_KIND_LABELS,
  Immunization,
  ImmunizationKind,
  NEXT_DUE_SHORTCUTS,
  addDays,
} from '../../core/services/medical.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { apiErrorMessage } from '../../shared/utils/validators';

const KIND_ICONS: Record<ImmunizationKind, IconName> = {
  VACCINE: 'syringe',
  DEWORMING_INTERNAL: 'shield-check',
  DEWORMING_EXTERNAL: 'paw',
};

/**
 * Registrar una vacuna o desparasitación. Con `visitId` se aplica hoy en esa atención;
 * sin ella se anota como antecedente (fecha pasada, quizá de otra clínica).
 */
@Component({
  selector: 'app-immunization-form',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="space-y-4">
      <div>
        <span [id]="uid + '-kind'" class="field-label">Qué se aplicó</span>
        <div
          class="mt-1.5 grid grid-cols-3 gap-2"
          role="radiogroup"
          [attr.aria-labelledby]="uid + '-kind'"
        >
          @for (k of kinds; track k) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="kind() === k"
              [attr.aria-label]="kindLabels[k]"
              (click)="setKind(k)"
              class="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-[13px] leading-tight font-medium ring-1 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anil-600"
              [class]="
                kind() === k
                  ? 'bg-anil-50 text-anil-900 ring-2 ring-anil-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
              "
            >
              <app-icon
                [name]="kindIcons[k]"
                class="size-[18px]"
                [class]="kind() === k ? 'text-anil-600' : 'text-slate-400'"
              />
              {{ kindShort[k] }}
            </button>
          }
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label [for]="uid + '-name'" class="field-label">
            {{ kind() === 'VACCINE' ? 'Vacuna' : 'Producto' }}
            <span class="text-rose-600" aria-hidden="true">*</span>
          </label>
          <input
            [id]="uid + '-name'"
            formControlName="name"
            class="field-input"
            autocomplete="off"
            maxlength="100"
            [attr.list]="uid + '-names'"
            [placeholder]="kind() === 'VACCINE' ? 'Séxtuple, antirrábica…' : 'Producto y peso'"
            [attr.aria-invalid]="invalid(form.controls.name)"
          />
          <datalist [id]="uid + '-names'">
            @for (n of suggestions(); track n) {
              <option [value]="n"></option>
            }
          </datalist>
          @if (invalid(form.controls.name)) {
            <p class="field-error">Escribe el nombre (mínimo 2 letras)</p>
          }
        </div>
        <div>
          <label [for]="uid + '-lab'" class="field-label">Laboratorio</label>
          <input
            [id]="uid + '-lab'"
            formControlName="laboratory"
            class="field-input"
            autocomplete="off"
            maxlength="60"
          />
        </div>
        <div>
          <label [for]="uid + '-lot'" class="field-label">Lote</label>
          <input
            [id]="uid + '-lot'"
            formControlName="batchNumber"
            class="field-input"
            autocomplete="off"
            maxlength="40"
          />
        </div>
        @if (!visitId()) {
          <div>
            <label [for]="uid + '-applied'" class="field-label">
              Fecha de aplicación <span class="text-rose-600" aria-hidden="true">*</span>
            </label>
            <input
              [id]="uid + '-applied'"
              type="date"
              formControlName="appliedAt"
              class="field-input"
              [max]="today"
              [attr.aria-invalid]="invalid(form.controls.appliedAt)"
            />
            @if (invalid(form.controls.appliedAt)) {
              <p class="field-error">Indica una fecha que no sea futura</p>
            }
          </div>
          <div>
            <label [for]="uid + '-where'" class="field-label">Dónde se aplicó</label>
            <input
              [id]="uid + '-where'"
              formControlName="externalClinic"
              class="field-input"
              autocomplete="off"
              maxlength="120"
              placeholder="Otra clínica o campaña"
            />
          </div>
        }
      </div>

      <div>
        <label [for]="uid + '-next'" class="field-label">Próxima dosis o refuerzo</label>
        <div class="mt-1.5 flex flex-wrap gap-2">
          @for (s of shortcuts; track s.days) {
            <button
              type="button"
              class="h-9 rounded-full px-3 text-sm font-medium ring-1 transition-colors"
              [class]="
                form.controls.nextDueAt.value === dueFrom(s.days)
                  ? 'bg-anil-600 text-white ring-anil-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
              "
              [attr.aria-pressed]="form.controls.nextDueAt.value === dueFrom(s.days)"
              (click)="setDue(s.days)"
            >
              {{ s.label }}
            </button>
          }
        </div>
        <div class="mt-2 flex items-center gap-2">
          <input
            [id]="uid + '-next'"
            type="date"
            formControlName="nextDueAt"
            class="field-input mt-0 max-w-48"
            [min]="base()"
            [attr.aria-invalid]="invalid(form.controls.nextDueAt)"
            [attr.aria-describedby]="uid + '-next-hint'"
          />
          @if (form.controls.nextDueAt.value) {
            <button type="button" class="btn btn-ghost h-9 px-3" (click)="setDue(null)">
              Sin refuerzo
            </button>
          }
        </div>
        <p [id]="uid + '-next-hint'" class="field-hint">
          @if (form.controls.nextDueAt.value; as next) {
            Saldrá en los recordatorios del {{ calendar(next) }}.
          } @else {
            Sin fecha no se genera recordatorio (esquema completo).
          }
        </p>
        @if (invalid(form.controls.nextDueAt)) {
          <p class="field-error">Debe ser posterior a la aplicación</p>
        }
      </div>

      <div>
        <label [for]="uid + '-notes'" class="field-label">Notas</label>
        <input
          [id]="uid + '-notes'"
          formControlName="notes"
          class="field-input"
          autocomplete="off"
          maxlength="300"
          placeholder="Reacción, dosis, vía…"
        />
      </div>

      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" class="btn btn-secondary" (click)="cancelled.emit()">Cancelar</button>
        <button type="submit" class="btn btn-primary" [disabled]="saving()">
          @if (saving()) {
            <app-icon name="loader" class="size-4 animate-spin" />
          }
          {{ visitId() ? 'Registrar aplicación' : 'Agregar al carnet' }}
        </button>
      </div>
    </form>
  `,
})
export class ImmunizationFormComponent {
  private readonly api = inject(ImmunizationsService);
  private readonly toast = inject(ToastService);

  readonly petId = input.required<number>();
  /** Atención abierta: se aplica hoy. Sin ella: antecedente */
  readonly visitId = input<number | null>(null);
  readonly saved = output<Immunization>();
  readonly cancelled = output<void>();

  protected readonly uid = `imm-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly kinds = Object.keys(IMMUNIZATION_KIND_LABELS) as ImmunizationKind[];
  protected readonly kindLabels = IMMUNIZATION_KIND_LABELS;
  protected readonly kindIcons = KIND_ICONS;
  protected readonly kindShort: Record<ImmunizationKind, string> = {
    VACCINE: 'Vacuna',
    DEWORMING_INTERNAL: 'Parásitos internos',
    DEWORMING_EXTERNAL: 'Pulgas y garrapatas',
  };
  protected readonly shortcuts = NEXT_DUE_SHORTCUTS;
  protected readonly today = limaToday();
  protected readonly calendar = (day: string) => formatDate(day, 'calendar');
  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    kind: new FormControl<ImmunizationKind>('VACCINE', { nonNullable: true }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(100)],
    }),
    laboratory: new FormControl('', { nonNullable: true }),
    batchNumber: new FormControl('', { nonNullable: true }),
    appliedAt: new FormControl('', { nonNullable: true }),
    externalClinic: new FormControl('', { nonNullable: true }),
    nextDueAt: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });
  private readonly appliedAt = toSignal(this.form.controls.appliedAt.valueChanges, {
    initialValue: '',
  });
  protected readonly suggestions = computed(() => COMMON_IMMUNIZATIONS[this.kind()]);
  /** Desde dónde se cuentan los atajos del refuerzo */
  protected readonly base = computed(() =>
    this.visitId() ? this.today : this.appliedAt() || this.today,
  );

  protected setKind(kind: ImmunizationKind): void {
    this.form.controls.kind.setValue(kind);
  }

  protected dueFrom(days: number): string {
    return addDays(this.base(), days);
  }

  protected setDue(days: number | null): void {
    this.form.controls.nextDueAt.setValue(days === null ? '' : this.dueFrom(days));
    this.form.controls.nextDueAt.markAsTouched();
  }

  protected invalid(control: { invalid: boolean; touched: boolean }): boolean {
    return control.invalid && control.touched;
  }

  protected submit(): void {
    if (this.saving()) return;
    const v = this.form.getRawValue();
    const history = !this.visitId();
    // Validaciones que dependen de otros campos
    this.form.controls.appliedAt.setErrors(
      history && (!v.appliedAt || v.appliedAt > this.today) ? { date: true } : null,
    );
    this.form.controls.nextDueAt.setErrors(
      v.nextDueAt && v.nextDueAt <= this.base() ? { order: true } : null,
    );
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.api
      .create({
        petId: this.petId(),
        visitId: this.visitId() ?? undefined,
        kind: v.kind,
        name: v.name.trim(),
        laboratory: v.laboratory.trim() || null,
        batchNumber: v.batchNumber.trim() || null,
        appliedAt: history ? v.appliedAt : undefined,
        nextDueAt: v.nextDueAt || null,
        external: history ? true : undefined,
        externalClinic: history ? v.externalClinic.trim() || null : null,
        notes: v.notes.trim() || null,
      })
      .subscribe({
        next: (item) => {
          this.saving.set(false);
          this.toast.success(`Se agregó ${item.name} al carnet.`);
          this.form.reset({ kind: v.kind });
          this.saved.emit(item);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }
}
