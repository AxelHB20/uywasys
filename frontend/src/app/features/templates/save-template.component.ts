import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ClinicalTemplate,
  ClinicalTemplatesService,
  ConsultationContent,
  PrescriptionContent,
  TemplateKind,
} from '../../core/services/clinical-templates.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';

/** Guarda lo escrito como plantilla: solo pide un nombre. */
@Component({
  selector: 'app-save-template',
  imports: [ModalComponent, IconComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [title]="
        kind() === 'CONSULTATION' ? 'Guardar como plantilla' : 'Guardar como receta frecuente'
      "
      [description]="
        kind() === 'CONSULTATION'
          ? 'Se guarda el motivo, la anamnesis, el examen, el diagnóstico y el plan (sin los datos del paciente).'
          : 'Se guardan los medicamentos con su dosis, vía, frecuencia y duración.'
      "
      (closed)="closed.emit()"
    >
      <form id="save-template-form" (submit)="$event.preventDefault(); save()" novalidate>
        <label for="st-name" class="field-label">Nombre</label>
        <input
          id="st-name"
          [formControl]="name"
          class="field-input"
          [placeholder]="
            kind() === 'CONSULTATION' ? 'Ej.: Gastroenteritis aguda' : 'Ej.: Otitis externa'
          "
          maxlength="80"
          autocomplete="off"
          [attr.aria-invalid]="name.invalid && name.touched"
          aria-describedby="st-name-error"
        />
        @if (name.invalid && name.touched) {
          <p id="st-name-error" class="field-error">Escribe un nombre de 2 a 80 caracteres.</p>
        }
      </form>
      <div modal-actions class="contents">
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancelar</button>
        <button
          type="submit"
          form="save-template-form"
          class="btn btn-primary"
          [disabled]="saving()"
        >
          <app-icon
            [name]="saving() ? 'loader' : 'save'"
            class="size-4"
            [class.animate-spin]="saving()"
          />
          Guardar
        </button>
      </div>
    </app-modal>
  `,
})
export class SaveTemplateComponent {
  private readonly api = inject(ClinicalTemplatesService);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly kind = input.required<TemplateKind>();
  readonly consultation = input<ConsultationContent | null>(null);
  readonly prescription = input<PrescriptionContent | null>(null);
  readonly suggestedName = input('');
  readonly saved = output<ClinicalTemplate>();
  readonly closed = output<void>();

  protected readonly saving = signal(false);
  protected readonly name = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
  });

  constructor() {
    effect(() => {
      if (this.open()) this.name.reset(this.suggestedName().slice(0, 80));
    });
  }

  protected save(): void {
    if (this.saving()) return;
    if (this.name.invalid) {
      this.name.markAsTouched();
      return;
    }
    this.saving.set(true);
    const kind = this.kind();
    this.api
      .create({
        kind,
        name: this.name.value.trim(),
        ...(kind === 'CONSULTATION'
          ? { consultation: this.consultation() ?? {} }
          : { prescription: this.prescription() ?? { items: [] } }),
      })
      .subscribe({
        next: (t) => {
          this.saving.set(false);
          this.toast.success(`Plantilla «${t.name}» guardada.`);
          this.saved.emit(t);
        },
        error: (e: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(e));
        },
      });
  }
}
