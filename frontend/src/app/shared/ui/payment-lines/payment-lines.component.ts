import { ChangeDetectionStrategy, Component, DOCUMENT, inject, input } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  METHOD_LABELS,
  NEEDS_CODE,
  PAYMENT_METHODS,
  PaymentInput,
  PaymentMethod,
} from '../../../core/services/cash.models';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons';
import { money } from '../../utils/stock';

export type PaymentGroup = FormGroup<{
  method: FormControl<PaymentMethod>;
  amount: FormControl<number | null>;
  tendered: FormControl<number | null>;
  operationCode: FormControl<string>;
}>;

const cents = (n: number) => Math.round(n * 100);
/** Un cobro se divide como mucho entre tres medios */
const MAX_LINES = 3;

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

/**
 * El total cambió (monto a cobrar o venta): con un medio, su monto es el total; dividido,
 * el primero absorbe la diferencia.
 */
export function syncPaymentsTotal(form: FormArray<PaymentGroup>, total: number): void {
  if (!form.length) return;
  const others = form.controls
    .slice(1)
    .reduce((s, g) => s + cents(Number(g.controls.amount.value) || 0), 0);
  const first = Math.max(0, cents(total || 0) - others) / 100;
  form.at(0).controls.amount.setValue(first || null);
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
    if (method === 'CASH') {
      // Lo recibido se anota siempre: así el vuelto y el arqueo cuadran
      if (tendered === null || (tendered as unknown) === '' || g.controls.tendered.invalid)
        return 'Anota cuánto recibió en efectivo';
      if (cents(Number(tendered)) < cents(Number(amount)))
        return 'El efectivo recibido no cubre el monto en efectivo';
    }
    const code = operationCode.trim();
    if (NEEDS_CODE.includes(method) && code && code.length < 4)
      return `El código de ${label} debe tener al menos 4 caracteres; si no lo tiene, déjalo vacío`;
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

const METHOD_ICONS: Record<PaymentMethod, IconName> = {
  CASH: 'banknote',
  YAPE: 'smartphone',
  PLIN: 'smartphone',
  CARD: 'credit-card',
  TRANSFER: 'landmark',
};

/**
 * Cómo paga el cliente. Lo normal es un medio (efectivo con vuelto; Yape, Plin o
 * transferencia con código opcional; tarjeta con voucher opcional). "Dividir el pago"
 * reparte el total entre dos o tres medios y el resto se calcula solo.
 * El formulario lo crea y lo valida la pantalla (paymentForm / paymentsError).
 */
@Component({
  selector: 'app-payment-lines',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = form();
    @let p = idPrefix();
    <fieldset class="@container">
      <legend class="sr-only">Cómo paga</legend>
      <div class="flex min-h-6 items-center justify-between gap-3">
        <span class="field-label" aria-hidden="true">Cómo paga</span>
        @if (f.length > 1) {
          <button
            type="button"
            class="rounded-md text-sm font-medium text-anil-700 hover:text-anil-900 focus-visible:outline-2 focus-visible:outline-anil-600"
            (click)="single()"
          >
            Un solo medio
          </button>
        }
      </div>

      @if (f.length === 1) {
        @let g = f.at(0);
        @let m = g.controls.method.value;
        <div
          class="mt-1.5 grid grid-cols-3 gap-2 @md:grid-cols-5"
          role="radiogroup"
          aria-label="Medio de pago"
        >
          @for (method of methods; track method) {
            @let on = method === m;
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="on"
              class="flex h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-medium transition-colors duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anil-600"
              [class]="
                on
                  ? 'bg-anil-50 text-anil-800 ring-2 ring-anil-600'
                  : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400'
              "
              (click)="choose(method)"
            >
              <app-icon
                [name]="icons[method]"
                class="size-5"
                [class]="on ? 'text-anil-600' : 'text-slate-500'"
              />
              {{ labels[method] }}
            </button>
          }
        </div>

        <div [formGroup]="g" class="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
          @if (m === 'CASH') {
            <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div class="min-w-0 flex-1 basis-44">
                <label [for]="p + '-tendered-0'" class="field-label">
                  Recibido (S/) <span class="text-rose-600" aria-hidden="true">*</span>
                </label>
                <input
                  [id]="p + '-tendered-0'"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.01"
                  formControlName="tendered"
                  class="field-input bg-white tabular-nums"
                  placeholder="Cuánto te entrega"
                  aria-required="true"
                  [attr.aria-invalid]="error() && !g.controls.tendered.value ? true : null"
                  [attr.aria-describedby]="error() ? p + '-pay-error' : null"
                />
                @let quick = quickCash();
                @if (quick.length) {
                  <div class="mt-2 flex flex-wrap gap-1.5" aria-label="Montos rápidos">
                    @for (q of quick; track q.value) {
                      <button
                        type="button"
                        class="h-9 rounded-lg bg-white px-3 pointer-coarse:h-11 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition-colors duration-150 hover:bg-anil-50 hover:text-anil-800 hover:ring-anil-300 focus-visible:outline-2 focus-visible:outline-anil-600 tabular-nums"
                        [class.!bg-anil-50]="isTendered(q.value)"
                        [class.!text-anil-800]="isTendered(q.value)"
                        [class.!ring-anil-600]="isTendered(q.value)"
                        [attr.aria-pressed]="isTendered(q.value)"
                        (click)="setTendered(q.value)"
                      >
                        {{ q.label }}
                      </button>
                    }
                  </div>
                }
              </div>
              @if (change() > 0) {
                <p class="pb-2 text-right" aria-live="polite">
                  <span class="block text-xs text-slate-500">Vuelto</span>
                  <span class="font-display text-xl font-semibold text-emerald-700 tabular-nums">{{
                    money(change())
                  }}</span>
                </p>
              }
            </div>
          } @else {
            <label [for]="p + '-code-0'" class="field-label">
              {{ codeLabel(m) }} <span class="font-normal text-slate-500">(opcional)</span>
            </label>
            <input
              [id]="p + '-code-0'"
              formControlName="operationCode"
              class="field-input bg-white"
              autocomplete="off"
              maxlength="40"
              [attr.aria-describedby]="p + '-code-hint'"
            />
            <p [id]="p + '-code-hint'" class="field-hint mt-1.5">
              {{
                m === 'CARD'
                  ? 'Está en el voucher del POS.'
                  : 'Si el dueño no lo tiene, cobra igual. Sirve para ubicar el pago si hay reclamo.'
              }}
            </p>
          }
        </div>
        @if (error(); as e) {
          <p [id]="p + '-pay-error'" class="field-error mt-2" role="alert">{{ e }}</p>
        }

        <button
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-anil-700 hover:text-anil-900 focus-visible:outline-2 focus-visible:outline-anil-600"
          (click)="split()"
        >
          <app-icon name="split" class="size-4" /> Paga con dos medios (ej.: efectivo + Yape)
          <span class="font-normal text-slate-500 @max-md:hidden"
            >· ej. parte efectivo y parte Yape</span
          >
        </button>
      } @else {
        <ul class="mt-2 space-y-2">
          @for (g of f.controls; track g; let i = $index) {
            @let m = g.controls.method.value;
            <li
              [formGroup]="g"
              class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70 transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none starting:-translate-y-1 starting:opacity-0 @md:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div class="col-span-2 @md:col-span-1">
                <label [for]="p + '-method-' + i" class="field-label">Medio</label>
                <select
                  [id]="p + '-method-' + i"
                  formControlName="method"
                  class="field-input bg-white"
                  (change)="methodChanged(i)"
                >
                  @for (method of methods; track method) {
                    @if (method === m || !usedElsewhere(method, i)) {
                      <option [value]="method">{{ labels[method] }}</option>
                    }
                  }
                </select>
              </div>
              <button
                type="button"
                class="grid size-11 place-items-center self-end rounded-lg text-slate-500 hover:bg-white hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-anil-600 @md:order-last"
                [attr.aria-label]="'Quitar ' + labels[m]"
                (click)="remove(i)"
              >
                <app-icon name="x" class="size-4" />
              </button>
              <div>
                <label [for]="p + '-amount-' + i" class="field-label">Monto (S/)</label>
                <input
                  [id]="p + '-amount-' + i"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.01"
                  formControlName="amount"
                  class="field-input bg-white font-semibold tabular-nums"
                  (input)="rebalance(i)"
                />
              </div>
              <div class="col-span-2 @md:col-span-1">
                @if (m === 'CASH') {
                  <label [for]="p + '-tendered-' + i" class="field-label"
                    >Recibido <span class="text-rose-600" aria-hidden="true">*</span></label
                  >
                  <input
                    [id]="p + '-tendered-' + i"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    formControlName="tendered"
                    class="field-input bg-white tabular-nums"
                    aria-required="true"
                  />
                } @else {
                  <label [for]="p + '-code-' + i" class="field-label">{{
                    m === 'CARD' ? 'Voucher' : 'Código'
                  }}</label>
                  <input
                    [id]="p + '-code-' + i"
                    formControlName="operationCode"
                    class="field-input bg-white"
                    autocomplete="off"
                    maxlength="40"
                    placeholder="Opcional"
                  />
                }
              </div>
            </li>
          }
        </ul>

        @if (f.length < maxLines) {
          <button
            type="button"
            class="mt-2 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-anil-700 hover:text-anil-900 focus-visible:outline-2 focus-visible:outline-anil-600"
            (click)="add()"
          >
            <app-icon name="plus" class="size-4" /> Otro medio
          </button>
        }

        @let diff = remaining();
        <div
          class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm ring-1"
          [class]="
            diff === 0
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : 'bg-amber-50 text-amber-900 ring-amber-200'
          "
          role="status"
        >
          <span class="flex items-center gap-1.5 font-medium">
            @if (diff === 0) {
              <app-icon name="check" class="size-4" /> Cubierto
              <span class="tabular-nums">{{ money(total()) }}</span>
            } @else if (diff > 0) {
              <app-icon name="alert" class="size-4" /> Falta
              <span class="tabular-nums">{{ money(diff) }}</span>
            } @else {
              <app-icon name="alert" class="size-4" /> Sobra
              <span class="tabular-nums">{{ money(-diff) }}</span>
              <span class="font-normal">· baja un monto</span>
            }
          </span>
          @if (change() > 0) {
            <span class="font-semibold text-emerald-800"
              >Vuelto <span class="tabular-nums">{{ money(change()) }}</span></span
            >
          }
        </div>
        @if (error(); as e) {
          <p [id]="p + '-pay-error'" class="field-error mt-2" role="alert">{{ e }}</p>
        }
      }
    </fieldset>
  `,
})
export class PaymentLinesComponent {
  readonly form = input.required<FormArray<PaymentGroup>>();
  /** Lo que se cobra */
  readonly total = input.required<number>();
  readonly idPrefix = input('pay');
  /** Problema del pago (falta lo recibido, no cuadra…): se muestra aquí, junto al campo */
  readonly error = input<string | null>(null);

  private readonly document = inject(DOCUMENT);
  protected readonly methods = PAYMENT_METHODS;
  protected readonly labels = METHOD_LABELS;
  protected readonly icons = METHOD_ICONS;
  protected readonly maxLines = MAX_LINES;
  protected readonly money = money;

  protected codeLabel(method: PaymentMethod): string {
    if (method === 'CARD') return 'N.º de voucher';
    return NEEDS_CODE.includes(method) ? 'Código de operación' : 'Referencia';
  }

  /** Un solo medio: cambiarlo no toca el monto; se limpia lo propio del medio anterior. */
  protected choose(method: PaymentMethod): void {
    const g = this.form().at(0);
    if (g.controls.method.value === method) return;
    g.controls.method.setValue(method);
    this.clearExtras(g);
  }

  /** Pasa a dos medios: el nuevo empieza vacío y, al escribir su monto, el otro se ajusta. */
  protected split(): void {
    const form = this.form();
    const next = this.freeMethods()[0];
    if (!next) return;
    form.push(paymentLine(next, null));
    this.focusAmount(form.length - 1);
  }

  protected add(): void {
    const form = this.form();
    const next = this.freeMethods()[0];
    if (!next || form.length >= MAX_LINES) return;
    const missing = Math.max(0, cents(this.total()) - cents(paymentsSum(form))) / 100;
    form.push(paymentLine(next, missing || null));
    this.focusAmount(form.length - 1);
  }

  protected remove(index: number): void {
    const form = this.form();
    form.removeAt(index);
    syncPaymentsTotal(form, this.total());
  }

  /** Vuelve a un medio (el primero) por el total. */
  protected single(): void {
    const form = this.form();
    while (form.length > 1) form.removeAt(form.length - 1);
    form.at(0).controls.amount.setValue(this.total() || null);
  }

  /**
   * Al escribir un monto, otro medio se ajusta con lo que falta: el último, o el primero
   * si se escribió en el último.
   */
  protected rebalance(index: number): void {
    const form = this.form();
    if (form.length < 2) return;
    const target = index === form.length - 1 ? 0 : form.length - 1;
    const others = form.controls.reduce(
      (s, g, i) => (i === target ? s : s + cents(Number(g.controls.amount.value) || 0)),
      0,
    );
    const rest = Math.max(0, cents(this.total()) - others) / 100;
    form.at(target).controls.amount.setValue(rest || null);
  }

  protected methodChanged(index: number): void {
    this.clearExtras(this.form().at(index));
  }

  protected usedElsewhere(method: PaymentMethod, index: number): boolean {
    return this.form().controls.some((g, i) => i !== index && g.controls.method.value === method);
  }

  /** Lo que falta (+) o sobra (−) para cubrir el total */
  protected remaining(): number {
    return (cents(this.total()) - cents(paymentsSum(this.form()))) / 100;
  }

  /** "Exacto" y los billetes que suelen entregar por encima (S/ 45 → 50, 100, 200) */
  protected quickCash(): { value: number; label: string }[] {
    const amount = Number(this.form().at(0).controls.amount.value) || 0;
    if (amount <= 0) return [];
    const above = [10, 50, 100, 200]
      .map((step) => Math.ceil((amount + 0.001) / step) * step)
      .filter((v, i, list) => v > amount && list.indexOf(v) === i)
      .slice(0, 3);
    return [
      { value: amount, label: `Exacto ${money(amount)}` },
      ...above.map((v) => ({ value: v, label: money(v) })),
    ];
  }

  protected isTendered(value: number): boolean {
    const t = this.form().at(0).controls.tendered.value;
    return t !== null && (t as unknown) !== '' && cents(Number(t)) === cents(value);
  }

  protected setTendered(value: number): void {
    this.form().at(0).controls.tendered.setValue(value);
  }

  protected change(): number {
    return paymentsChange(this.form());
  }

  private freeMethods(): PaymentMethod[] {
    const used = new Set(this.form().controls.map((g) => g.controls.method.value));
    // Lo más común al dividir: efectivo + Yape
    return (['CASH', 'YAPE', 'PLIN', 'CARD', 'TRANSFER'] as PaymentMethod[]).filter(
      (m) => !used.has(m),
    );
  }

  private clearExtras(g: PaymentGroup): void {
    g.controls.tendered.setValue(null);
    g.controls.operationCode.setValue('');
  }

  private focusAmount(index: number): void {
    setTimeout(() =>
      (
        this.document.getElementById(
          `${this.idPrefix()}-amount-${index}`,
        ) as HTMLInputElement | null
      )?.focus(),
    );
  }
}
