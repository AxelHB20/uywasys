import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { ClinicProfile, ClinicService } from '../../core/services/clinic.service';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { DAY_NAMES, DayHours, scheduleSummary } from '../../shared/utils/opening-hours';
import { apiErrorMessage } from '../../shared/utils/validators';

type DayForm = FormGroup<{
  day: FormControl<number>;
  isOpen: FormControl<boolean>;
  open: FormControl<string>;
  close: FormControl<string>;
}>;

/** Un día abierto necesita apertura y cierre, y el cierre va después. */
function dayValidator(control: AbstractControl): ValidationErrors | null {
  const { isOpen, open, close } = (control as DayForm).getRawValue();
  if (!isOpen) return null;
  if (!open || !close) return { missing: true };
  return open < close ? null : { order: true };
}

/** Horario de atención: sale en el ticket y lo usará la agenda de citas. */
@Component({
  selector: 'app-opening-hours',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card p-6" aria-labelledby="hours-title">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="hours-title" class="text-sm font-semibold text-slate-900">Horario de atención</h2>
          <p class="mt-1 text-sm text-slate-600">
            {{ summary() ? 'Sale al pie del ticket:' : 'Sale al pie del ticket.' }}
            <span class="text-slate-800">{{ summary() }}</span>
          </p>
        </div>
      </div>

      <form [formGroup]="form" (ngSubmit)="save()" class="mt-5">
        <ul formArrayName="days" class="divide-y divide-slate-100">
          @for (row of days.controls; track row.controls.day.value; let i = $index) {
            <li [formGroupName]="i" class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <label
                class="flex w-36 cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-800"
              >
                <input
                  type="checkbox"
                  formControlName="isOpen"
                  class="size-5 rounded accent-anil-600"
                />
                {{ dayNames[row.controls.day.value - 1] }}
              </label>
              @if (row.controls.isOpen.value) {
                <div class="flex items-center gap-2">
                  <label class="sr-only" [for]="'open-' + i">Abre el {{ dayNames[i] }}</label>
                  <input
                    [id]="'open-' + i"
                    type="time"
                    formControlName="open"
                    class="field-input mt-0 w-32"
                    [attr.aria-invalid]="row.invalid && row.touched"
                  />
                  <span class="text-sm text-slate-500" aria-hidden="true">a</span>
                  <label class="sr-only" [for]="'close-' + i">Cierra el {{ dayNames[i] }}</label>
                  <input
                    [id]="'close-' + i"
                    type="time"
                    formControlName="close"
                    class="field-input mt-0 w-32"
                    [attr.aria-invalid]="row.invalid && row.touched"
                  />
                </div>
                @if (row.invalid && row.touched) {
                  <p class="field-error mt-0 w-full sm:w-auto">
                    {{
                      row.errors?.['order']
                        ? 'El cierre debe ser después de la apertura'
                        : 'Indica las dos horas'
                    }}
                  </p>
                }
              } @else {
                <span class="text-sm text-slate-500">Cerrado</span>
              }
            </li>
          }
        </ul>
        <div class="mt-4 flex justify-end">
          <button type="submit" class="btn btn-primary" [disabled]="saving() || form.pristine">
            Guardar horario
          </button>
        </div>
      </form>
    </section>
  `,
})
export class OpeningHoursComponent {
  private readonly clinic = inject(ClinicService);
  private readonly toast = inject(ToastService);

  readonly hours = input.required<DayHours[]>();
  readonly saved = output<ClinicProfile>();

  protected readonly dayNames = DAY_NAMES;
  protected readonly saving = signal(false);
  protected readonly summary = signal('');
  protected readonly form = new FormGroup({ days: new FormArray<DayForm>([]) });
  protected get days(): FormArray<DayForm> {
    return this.form.controls.days;
  }

  constructor() {
    effect(() => this.reset(this.hours()));
  }

  protected save(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const days: DayHours[] = this.days.getRawValue().map((d) => ({
      day: d.day,
      open: d.isOpen ? d.open : null,
      close: d.isOpen ? d.close : null,
    }));
    this.saving.set(true);
    this.clinic.updateHours(days).subscribe({
      next: (profile) => {
        this.saving.set(false);
        this.reset(profile.openingHours);
        this.saved.emit(profile);
        this.toast.success('Horario guardado');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  private reset(hours: DayHours[]): void {
    this.days.clear();
    for (const h of [...hours].sort((a, b) => a.day - b.day)) {
      const row: DayForm = new FormGroup(
        {
          day: new FormControl(h.day, { nonNullable: true }),
          isOpen: new FormControl(!!h.open, { nonNullable: true }),
          open: new FormControl(h.open ?? '09:00', { nonNullable: true }),
          close: new FormControl(h.close ?? '18:00', { nonNullable: true }),
        },
        { validators: dayValidator },
      );
      this.days.push(row);
    }
    this.form.markAsPristine();
    this.summary.set(scheduleSummary(hours));
  }
}
