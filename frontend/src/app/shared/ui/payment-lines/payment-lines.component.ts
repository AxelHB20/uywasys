import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  METHOD_LABELS,
  NEEDS_CODE,
  PAYMENT_METHODS,
  PaymentInput,
  PaymentMethod,
} from '../../../core/services/cash.models';
import { IconComponent } from '../icon/icon.component';
import { money } from '../../utils/stock';

export type PaymentGroup = FormGroup<{
  method: FormControl<PaymentMethod>;
  amount: FormControl<number | null>;
  tendered: FormControl<number | null>;
  operationCode: FormControl<string>;
}>;

const cents = (n: number) => Math.round(n * 100);

export function paymentLine(method: PaymentMethod, amount: number | null): PaymentGroup {
  return new FormGroup({
    method: new FormControl(method, { nonNullable: true }),
    amount: new FormControl<number | null>(amount, [
      Validators.required,
      Validators.min(0.01),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
    tendered: new FormControl<number | null>(null, [
      Validators.min(0),
      Validators.pattern(/^\d+(\.\d{1,2})?$/),
    ]),
    operationCode: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(40)],
    }),
  });
}

/** Un solo pago en efectivo por el total: el caso más común. */
export function paymentForm(total: number): FormArray<PaymentGroup> {
  return new FormArray([paymentLine('CASH', total || null)]);
}

export function paymentsSum(form: FormArray<PaymentGroup>): number {
  return form.controls.reduce((s, g) => s + cents(Number(g.controls.amount.value) || 0), 0) / 100;
}

/** Vuelto: lo recibido en efectivo menos lo que se aplica. */
export function paymentsChange(form: FormArray<PaymentGroup>): number {
  const cash = form.controls.find((g) => g.controls.method.value === 'CASH');
  if (!cash) return 0;
  const tendered = Number(cash.controls.tendered.value) || 0;
  const amount = Number(cash.controls.amount.value) || 0;
  return Math.max(0, cents(tendered) - cents(amount)) / 100;
}

/** Revisa los pagos antes de enviar; devuelve el primer problema o null. */
export function paymentsError(form: FormArray<PaymentGroup>, total: number): string | null {
  if (!form.length) return 'Agrega cómo paga el cliente';
  for (const g of form.controls) {
    const { method, amount, tendered, operationCode } = g.getRawValue();
    const label = METHOD_LABELS[method];
    if (g.controls.amount.invalid) return `Revisa el monto en ${label}`;
    if (
      method === 'CASH' &&
      tendered !== null &&
      (tendered as unknown) !== '' &&
      cents(Number(tendered)) < cents(Number(amount))
    )
      return 'El efectivo recibido no cubre el monto en efectivo';
    if (NEEDS_CODE.includes(method) && operationCode.trim().length < 4)
      return `Ingresa el código de operación de ${label}`;
  }
  const sum = paymentsSum(form);
  if (cents(sum) !== cents(total))
    return `Los pagos suman ${money(sum)} y se cobran ${money(total)}`;
  return null;
}

export function paymentsValue(form: FormArray<PaymentGroup>): PaymentInput[] {
  return form.getRawValue().map((p) => ({
    method: p.method,
    amount: Number(p.amount),
    tendered:
      p.method === 'CASH' && p.tendered !== null && (p.tendered as unknown) !== ''
        ? Number(p.tendered)
        : null,
    operationCode: p.method === 'CASH' ? null : p.operationCode.trim() || null,
  }));
}

/**
 * Medios de pago de un cobro: efectivo con vuelto, Yape/Plin/transferencia con código.
 * El formulario lo crea y lo valida la pantalla (paymentForm / paymentsError).
 */
@Component({
  selector: 'app-payment-lines',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = form();
    <fieldset>
      <legend class="field-label">Cómo paga</legend>
      <div class="mt-1.5 flex flex-wrap gap-2">
        @for (m of methods; track m) {
          <button
            type="button"
            class="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium ring-1 select-none"
            [class]="
              has(m)
                ? 'bg-anil-600 text-white ring-anil-600'
                : 'text-slate-700 ring-slate-300 hover:bg-slate-50'
            "
            [attr.aria-pressed]="has(m)"
            (click)="toggle(m)"
          >
            {{ labels[m] }}
          </button>
        }
      </div>

      <p class="field-hint mt-2">
        Para combinar dos medios, baja el monto del primero y elige el otro.
      </p>
      <ul class="mt-3 space-y-3">
        @for (g of f.controls; track g; let i = $index) {
          @let m = g.controls.method.value;
          <li [formGroup]="g" class="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
            <div
              class="grid gap-3"
              [class]="m === 'CASH' || needsCode(m) || m === 'CARD' ? 'sm:grid-cols-2' : ''"
            >
              <div>
                <label [for]="idPrefix() + '-amount-' + i" class="field-label"
                  >{{ labels[m] }} (S/)</label
                >
                <input
                  [id]="idPrefix() + '-amount-' + i"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.01"
                  formControlName="amount"
                  class="field-input bg-white tabular-nums"
                />
              </div>
              @if (m === 'CASH') {
                <div>
                  <label [for]="idPrefix() + '-tendered-' + i" class="field-label"
                    >Recibido (opcional)</label
                  >
                  <input
                    [id]="idPrefix() + '-tendered-' + i"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    formControlName="tendered"
                    class="field-input bg-white tabular-nums"
                    placeholder="Para calcular el vuelto"
                  />
                </div>
              } @else if (needsCode(m) || m === 'CARD') {
                <div>
                  <label [for]="idPrefix() + '-code-' + i" class="field-label">
                    {{ m === 'CARD' ? 'N.º de voucher (opcional)' : 'Código de operación' }}
                  </label>
                  <input
                    [id]="idPrefix() + '-code-' + i"
                    formControlName="operationCode"
                    class="field-input bg-white"
                    autocomplete="off"
                    maxlength="40"
                  />
                </div>
              }
            </div>
          </li>
        }
      </ul>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span class="text-slate-600">
          Pagos: <strong class="text-slate-900 tabular-nums">{{ money(sum()) }}</strong> de
          <span class="tabular-nums">{{ money(total()) }}</span>
        </span>
        @if (change() > 0) {
          <span
            class="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200"
          >
            <app-icon name="check" class="mr-1 inline size-4" />Vuelto {{ money(change()) }}
          </span>
        }
      </div>
    </fieldset>
  `,
})
export class PaymentLinesComponent {
  readonly form = input.required<FormArray<PaymentGroup>>();
  /** Lo que se cobra */
  readonly total = input.required<number>();
  readonly idPrefix = input('pay');

  protected readonly methods = PAYMENT_METHODS;
  protected readonly labels = METHOD_LABELS;
  protected readonly money = money;

  protected has(method: PaymentMethod): boolean {
    return this.form().controls.some((g) => g.controls.method.value === method);
  }

  protected needsCode(method: PaymentMethod): boolean {
    return NEEDS_CODE.includes(method);
  }

  /** Agrega el medio con lo que falta cubrir, o lo quita (siempre queda al menos uno). */
  protected toggle(method: PaymentMethod): void {
    const form = this.form();
    const index = form.controls.findIndex((g) => g.controls.method.value === method);
    if (index >= 0) {
      if (form.length > 1) form.removeAt(index);
      return;
    }
    const missing = Math.max(0, cents(this.total()) - cents(paymentsSum(form))) / 100;
    if (form.length === 1 && cents(paymentsSum(form)) === cents(this.total()) && missing === 0) {
      // Cambiar de medio cuando ya estaba cubierto con uno solo: se reemplaza
      const amount = form.at(0).controls.amount.value;
      form.removeAt(0);
      form.push(paymentLine(method, amount));
      return;
    }
    form.push(paymentLine(method, missing || null));
  }

  protected sum(): number {
    return paymentsSum(this.form());
  }

  protected change(): number {
    return paymentsChange(this.form());
  }
}
