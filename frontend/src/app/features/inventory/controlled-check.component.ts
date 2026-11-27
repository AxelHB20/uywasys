import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { CONTROLLED_QUESTION, INVENTORY_HELP } from '../../core/services/inventory.models';
import { ModalComponent } from '../../shared/ui/modal/modal.component';

/**
 * Casilla "Estupefaciente o psicotrópico (libro de DIGEMID)". Antes se llamaba "controlado" y la
 * clínica la marcaba en casi todos los medicamentos: ahora pide confirmar al marcarla.
 */
@Component({
  selector: 'app-controlled-check',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <label
      class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 text-sm text-slate-800"
    >
      <input
        type="checkbox"
        class="mt-0.5 size-5 shrink-0 rounded accent-rose-600"
        [checked]="control().value"
        (change)="onChange($event)"
      />
      <span>
        <span class="font-medium">{{ question }}</span>
        <span class="block text-slate-600" [class.text-xs]="compact()">{{ help.controlled }}</span>
      </span>
    </label>

    <app-modal
      [open]="asking()"
      title="¿Es un estupefaciente o psicotrópico?"
      description="Por ejemplo: ketamina, tramadol, diazepam, fenobarbital, butorfanol."
      (closed)="cancel()"
    >
      <ul class="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
        <li>Queda en el <strong class="font-semibold">libro de DIGEMID</strong>.</li>
        <li>Cada compra pide el <strong class="font-semibold">lote</strong>.</li>
        <li>
          Cada uso o venta pide
          <strong class="font-semibold">receta, paciente y veterinario colegiado</strong>.
        </li>
      </ul>
      <p
        class="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950 ring-1 ring-amber-200"
      >
        Antibióticos, vitaminas, suplementos, antiparasitarios o cremas <strong>no</strong> se
        marcan.
      </p>
      <div modal-actions class="contents">
        <button type="button" class="btn btn-secondary" (click)="cancel()">No, cancelar</button>
        <button type="button" class="btn btn-danger" (click)="confirm()">
          Sí, es psicotrópico
        </button>
      </div>
    </app-modal>
  `,
})
export class ControlledCheckComponent {
  readonly control = input.required<FormControl<boolean>>();
  /** Texto de ayuda más chico (formularios en ventana) */
  readonly compact = input(false);

  protected readonly question = CONTROLLED_QUESTION;
  protected readonly help = INVENTORY_HELP;
  protected readonly asking = signal(false);

  protected onChange(event: Event): void {
    const box = event.target as HTMLInputElement;
    if (box.checked) {
      // No se marca hasta confirmar
      box.checked = false;
      this.asking.set(true);
      return;
    }
    this.control().setValue(false);
    this.control().markAsDirty();
  }

  protected confirm(): void {
    this.control().setValue(true);
    this.control().markAsDirty();
    this.asking.set(false);
  }

  protected cancel(): void {
    this.asking.set(false);
  }
}
