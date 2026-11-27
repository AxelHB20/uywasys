import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';

/**
 * Vencimiento como viene impreso en la caja: "08/2027" (o "08/27"). Guarda el último día del mes
 * ("2027-08-31"), que es hasta cuándo sirve el producto. También acepta "31/08/2027".
 * Errores: { expiryFormat } si no se entiende, { expiryPast } si ya venció (mes anterior al actual).
 */
@Component({
  selector: 'app-month-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MonthInputComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => MonthInputComponent), multi: true },
  ],
  host: { class: 'block' },
  template: `
    <input
      [id]="inputId()"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      maxlength="10"
      placeholder="MM/AAAA"
      class="field-input tabular-nums"
      [class.mt-0]="flush()"
      [value]="text()"
      [disabled]="disabled()"
      [attr.aria-invalid]="invalid()"
      [attr.aria-describedby]="describedBy()"
      (input)="onInput($event)"
      (blur)="touched()"
    />
  `,
})
export class MonthInputComponent implements ControlValueAccessor, Validator {
  readonly inputId = input.required<string>();
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);
  /** Sin margen superior (cuando la etiqueta está oculta) */
  readonly flush = input(false);

  protected readonly text = signal('');
  protected readonly disabled = signal(false);
  private value = '';
  private onChange: (v: string) => void = () => undefined;
  protected touched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.value = value ?? '';
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(this.value);
    this.text.set(m ? `${m[2]}/${m[1]}` : '');
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.touched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  validate(_: AbstractControl): ValidationErrors | null {
    const raw = this.text().trim();
    if (!raw) return null;
    if (!this.value) return { expiryFormat: true };
    const today = new Date();
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    return this.value.slice(0, 7) < thisMonth ? { expiryPast: true } : null;
  }

  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    let raw = el.value.replace(/[^\d/]/g, '');
    // "082027" → "08/2027" mientras escribe
    if (/^\d{3,}$/.test(raw) && raw.length <= 6) raw = `${raw.slice(0, 2)}/${raw.slice(2)}`;
    if (raw !== el.value) el.value = raw;
    this.text.set(raw);
    this.value = parseExpiry(raw);
    this.onChange(this.value);
  }
}

/** "08/2027", "8/27" o "31/08/2027" → "2027-08-31"; lo demás → "" */
export function parseExpiry(raw: string): string {
  const full = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (full) {
    const [d, m, y] = [Number(full[1]), Number(full[2]), Number(full[3])];
    const last = new Date(y, m, 0).getDate();
    if (m < 1 || m > 12 || d < 1 || d > last) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const short = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw);
  if (!short) return '';
  const m = Number(short[1]);
  const y = short[2].length === 2 ? 2000 + Number(short[2]) : Number(short[2]);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return '';
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${last}`;
}
