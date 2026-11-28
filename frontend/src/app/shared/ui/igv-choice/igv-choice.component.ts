import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Costo de lo que viene en la boleta o factura, guardado sin IGV (el margen sale real) */
export function costWithoutIgv(
  value: number | null,
  withIgv: boolean,
  igv: 'TAXED' | 'EXEMPT' | 'UNAFFECTED',
): number | null {
  if (value === null) return null;
  if (!withIgv || igv !== 'TAXED') return value;
  return Math.round((value / 1.18) * 10000) / 10000;
}

/**
 * "El costo viene: Con IGV / Sin IGV", igual que en Recibir compra. Con IGV es el precio final
 * (boleta); sin IGV, el valor unitario de una factura (el IGV va abajo).
 */
@Component({
  selector: 'app-igv-choice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span [id]="labelId()" class="text-xs font-medium text-slate-700">{{ label() }}</span>
      <div
        class="inline-flex h-9 rounded-lg bg-slate-100 p-0.5 pointer-coarse:h-11"
        role="radiogroup"
        [attr.aria-labelledby]="labelId()"
      >
        @for (o of [true, false]; track o) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="withIgv() === o"
            class="rounded-md px-3 text-xs font-medium transition-colors"
            [class]="
              withIgv() === o
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            "
            (click)="withIgv.set(o)"
          >
            {{ o ? 'Con IGV' : 'Sin IGV' }}
          </button>
        }
      </div>
    </div>
  `,
})
export class IgvChoiceComponent {
  readonly withIgv = model(true);
  readonly labelId = input.required<string>();
  readonly label = input('El costo viene');
}
