import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { money } from '../../utils/stock';
import { DISCOUNT_REASONS, discountCap, discountProblem, discountProblemText } from './discount';

/**
 * Descuento de una línea, en soles: monto, motivo de un toque y el resultado al lado
 * ("− S/ 5.00 · queda S/ 41.00"). Avisa si pasa del tope antes de cobrar.
 */
@Component({
  selector: 'app-discount-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label [for]="idPrefix() + '-amt'" class="block text-xs font-medium text-slate-700"
            >Descuento (S/)</label
          >
          <input
            [id]="idPrefix() + '-amt'"
            type="number"
            inputmode="decimal"
            min="0"
            step="0.5"
            class="field-input mt-1 h-10 w-28 tabular-nums"
            [value]="amount() ?? ''"
            (input)="setAmount($any($event.target).value)"
            [attr.aria-invalid]="problem() && problem() !== 'reason'"
            [attr.aria-describedby]="idPrefix() + '-msg'"
          />
        </div>
        <div class="min-w-40 flex-1">
          <label [for]="idPrefix() + '-why'" class="block text-xs font-medium text-slate-700"
            >Motivo</label
          >
          <input
            [id]="idPrefix() + '-why'"
            class="field-input mt-1 h-10"
            maxlength="120"
            placeholder="Ej.: cliente frecuente"
            [value]="reason()"
            (input)="reason.set($any($event.target).value)"
            [attr.aria-invalid]="showErrors() && problem() === 'reason'"
          />
        </div>
        <button
          type="button"
          class="h-10 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-rose-700"
          (click)="remove.emit()"
        >
          Quitar
        </button>
      </div>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Motivos frecuentes">
        @for (r of reasons; track r) {
          <button
            type="button"
            class="h-8 rounded-full px-3 text-xs font-medium ring-1 pointer-coarse:h-10"
            [class]="
              reason() === r
                ? 'bg-anil-600 text-white ring-anil-600'
                : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
            "
            [attr.aria-pressed]="reason() === r"
            (click)="reason.set(r)"
          >
            {{ r }}
          </button>
        }
      </div>
      <p
        [id]="idPrefix() + '-msg'"
        class="text-xs"
        [class]="message().error ? 'font-medium text-rose-700' : 'text-slate-600'"
        aria-live="polite"
      >
        {{ message().text }}
      </p>
    </div>
  `,
})
export class DiscountFieldsComponent {
  readonly idPrefix = input.required<string>();
  /** Importe de la línea antes del descuento */
  readonly gross = input.required<number>();
  readonly maxPercent = input.required<number>();
  /** El administrador puede pasar el tope */
  readonly canExceed = input(false);
  /** Mostrar "falta el motivo" (al intentar cobrar) */
  readonly showErrors = input(false);
  readonly amount = model<number | null>(null);
  readonly reason = model('');
  readonly remove = output<void>();

  protected readonly reasons = DISCOUNT_REASONS;
  protected readonly problem = computed(() =>
    discountProblem(
      this.gross(),
      this.amount(),
      this.reason(),
      this.maxPercent(),
      this.canExceed(),
    ),
  );
  protected readonly message = computed(() => {
    const p = this.problem();
    const amount = this.amount() ?? 0;
    if (p && (p !== 'reason' || this.showErrors()))
      return { error: true, text: discountProblemText(p, this.gross(), this.maxPercent()) };
    if (amount > 0)
      return {
        error: false,
        text: `− ${money(amount)} · queda ${money(this.gross() - amount)}`,
      };
    return {
      error: false,
      text: this.canExceed()
        ? `Importe ${money(this.gross())}`
        : `Hasta ${money(discountCap(this.gross(), this.maxPercent()))} sin el administrador`,
    };
  });

  protected setAmount(raw: string): void {
    const n = raw === '' ? null : Number(raw);
    this.amount.set(n === null || Number.isNaN(n) ? null : n);
  }
}
