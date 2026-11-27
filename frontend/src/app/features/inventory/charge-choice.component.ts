import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { INVENTORY_HELP } from '../../core/services/inventory.models';

/**
 * "¿Se le cobra al cliente?" con las dos respuestas a la vista. Antes era una casilla ("Se cobra",
 * luego "No se vende (insumo)") y se marcó al revés en medicamentos que sí se venden.
 * `internal` = true es insumo: no aparece al cobrar.
 */
@Component({
  selector: 'app-charge-choice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset>
      <legend class="field-label">¿Se le cobra al cliente?</legend>
      <div class="mt-1.5 grid gap-2 sm:grid-cols-2">
        <label [class]="option">
          <input
            type="radio"
            class="mt-0.5 size-5 shrink-0 accent-anil-600"
            [name]="name()"
            [checked]="!internal()"
            (change)="internal.set(false)"
          />
          <span>
            <span class="block font-medium text-slate-900">Sí, se vende</span>
            <span class="block text-slate-600"
              >Sale al cobrar en Caja, atención y presupuestos</span
            >
          </span>
        </label>
        <label [class]="option">
          <input
            type="radio"
            class="mt-0.5 size-5 shrink-0 accent-anil-600"
            [name]="name()"
            [checked]="internal()"
            (change)="internal.set(true)"
          />
          <span>
            <span class="block font-medium text-slate-900">No, se gasta en la clínica</span>
            <span class="block text-slate-600">Insumo: jeringas, guantes, gasas, alcohol</span>
          </span>
        </label>
      </div>
      @if (internal()) {
        <p class="field-hint">{{ help.supply }}</p>
      }
    </fieldset>
  `,
})
export class ChargeChoiceComponent {
  readonly internal = model.required<boolean>();
  readonly name = input.required<string>();
  protected readonly help = INVENTORY_HELP;
  protected readonly option =
    'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-3.5 py-2.5 text-sm ring-1 ring-slate-300 hover:bg-slate-50 has-checked:bg-anil-50 has-checked:ring-2 has-checked:ring-anil-500';
}
