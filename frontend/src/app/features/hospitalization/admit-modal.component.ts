import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SessionService } from '../../core/auth/session.service';
import { AgendaStaff } from '../../core/services/appointments.models';
import { AppointmentsService } from '../../core/services/appointments.service';
import { HospitalizationDetail } from '../../core/services/hospitalization.models';
import { HospitalizationService } from '../../core/services/hospitalization.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';

/**
 * Internar: jaula, motivo y diagnóstico. Desde una consulta, esta se cierra (lo pendiente queda
 * por cobrar) y el internamiento abre su propia atención.
 */
@Component({
  selector: 'app-admit-modal',
  imports: [ModalComponent, IconComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [title]="'Internar a ' + petName()"
      [description]="
        fromVisitId()
          ? 'La consulta se cierra (lo pendiente queda por cobrar) y el internamiento abre su propia atención.'
          : 'Abre su atención de hospitalización y su hoja de tratamiento.'
      "
      [dismissible]="false"
      (closed)="close()"
    >
      <form id="admit-form" [formGroup]="form" (ngSubmit)="submit()" novalidate class="space-y-4">
        <div>
          <label for="ad-reason" class="field-label">Motivo del internamiento</label>
          <input
            id="ad-reason"
            formControlName="reason"
            class="field-input"
            maxlength="200"
            autocomplete="off"
            placeholder="Ej.: Gastroenteritis con deshidratación"
            [attr.aria-invalid]="bad(form.controls.reason)"
            aria-describedby="ad-reason-error"
          />
          @if (bad(form.controls.reason)) {
            <p id="ad-reason-error" class="field-error">Escribe el motivo (3 a 200 caracteres).</p>
          }
        </div>
        <div>
          <label for="ad-dx" class="field-label"
            >Diagnóstico <span class="font-normal text-slate-500">(opcional)</span></label
          >
          <input
            id="ad-dx"
            formControlName="diagnosis"
            class="field-input"
            maxlength="300"
            autocomplete="off"
          />
        </div>
        <div>
          <div>
            <label for="ad-vet" class="field-label">Veterinario responsable</label>
            <select
              id="ad-vet"
              formControlName="vetId"
              class="field-input"
              [attr.aria-invalid]="bad(form.controls.vetId)"
            >
              <option [ngValue]="null" disabled>Elige…</option>
              @for (v of vets(); track v.id) {
                <option [ngValue]="v.id">{{ v.fullName }}</option>
              }
            </select>
            @if (bad(form.controls.vetId)) {
              <p class="field-error">Elige el veterinario responsable.</p>
            }
          </div>
        </div>
      </form>
      <div modal-actions class="contents">
        <button type="button" class="btn btn-secondary" [disabled]="saving()" (click)="close()">
          Cancelar
        </button>
        <button type="submit" form="admit-form" class="btn btn-primary" [disabled]="saving()">
          <app-icon
            [name]="saving() ? 'loader' : 'bed'"
            class="size-4"
            [class.animate-spin]="saving()"
          />
          Internar
        </button>
      </div>
    </app-modal>
  `,
})
export class AdmitModalComponent {
  private readonly api = inject(HospitalizationService);
  private readonly appointments = inject(AppointmentsService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly petId = input.required<number>();
  readonly petName = input.required<string>();
  readonly fromVisitId = input<number | null>(null);
  readonly reason = input('');
  readonly diagnosis = input('');
  /** Antes de internar (p. ej. guardar la consulta); si falla, no se interna */
  readonly before = input<(() => Promise<boolean>) | null>(null);
  readonly admitted = output<HospitalizationDetail>();
  readonly closed = output<void>();

  protected readonly saving = signal(false);
  private readonly staff = signal<AgendaStaff[]>([]);
  protected readonly vets = computed(() =>
    this.staff().filter((s) => s.role === 'VET' || s.role === 'ADMIN'),
  );
  protected readonly form = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    }),
    diagnosis: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    vetId: new FormControl<number | null>(null, Validators.required),
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const me = this.session.user();
      this.form.reset({
        reason: this.reason().slice(0, 200),
        diagnosis: this.diagnosis().slice(0, 300),
        vetId: me && this.session.role() === 'VET' ? me.id : null,
      });
      if (!this.staff().length)
        this.appointments.staff().subscribe({
          next: (list) => {
            this.staff.set(list);
            if (
              !this.form.controls.vetId.value &&
              me &&
              list.some((s) => s.id === me.id && s.role !== 'RECEPTION')
            )
              this.form.controls.vetId.setValue(me.id);
          },
          error: () => this.staff.set([]),
        });
    });
  }

  protected bad(c: { invalid: boolean; touched: boolean }): boolean {
    return c.invalid && c.touched;
  }

  protected close(): void {
    if (!this.saving()) this.closed.emit();
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const before = this.before();
    if (before && !(await before())) {
      this.saving.set(false);
      return;
    }
    const v = this.form.getRawValue();
    this.api
      .admit({
        petId: this.petId(),
        fromVisitId: this.fromVisitId() ?? undefined,
        vetId: v.vetId ?? undefined,
        reason: v.reason.trim(),
        diagnosis: v.diagnosis.trim() || null,
      })
      .subscribe({
        next: (h) => {
          this.saving.set(false);
          this.toast.success(`${this.petName()} quedó internado (${h.code}).`);
          this.admitted.emit(h);
        },
        error: (e: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(e));
        },
      });
  }
}
