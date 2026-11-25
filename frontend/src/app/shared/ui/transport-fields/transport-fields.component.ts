import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  GroomingTransport,
  TRANSPORT_LABELS,
  TRANSPORTS,
} from '../../../core/services/grooming.models';
import type { TransportInput } from '../../../core/services/queue.service';
import { money } from '../../utils/stock';

/** Tope del servidor: evita un cero de más (S/ 1200 en vez de 12.00) */
export const TRANSPORT_MAX_PRICE = 500;

export type TransportControls = {
  transport: FormControl<GroomingTransport>;
  transportAddress: FormControl<string>;
  transportPrice: FormControl<number | null>;
};

export function transportGroup(): FormGroup<TransportControls> {
  return new FormGroup<TransportControls>({
    transport: new FormControl<GroomingTransport>('NONE', { nonNullable: true }),
    transportAddress: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(200),
    }),
    transportPrice: new FormControl<number | null>(null, [
      Validators.min(0),
      Validators.max(TRANSPORT_MAX_PRICE),
    ]),
  });
}

/** Falta la dirección (con movilidad) o el precio no es válido */
export function transportInvalid(group: FormGroup<TransportControls>): boolean {
  const v = group.getRawValue();
  return (
    v.transport !== 'NONE' &&
    (v.transportAddress.trim().length < 5 || group.controls.transportPrice.invalid)
  );
}

/** Lo que se manda al servidor: sin movilidad no lleva dirección ni precio */
export function transportValue(group: FormGroup<TransportControls>): TransportInput {
  const v = group.getRawValue();
  if (v.transport === 'NONE')
    return { transport: 'NONE', transportAddress: null, transportPrice: null };
  const price = Number(v.transportPrice);
  return {
    transport: v.transport,
    transportAddress: v.transportAddress.trim(),
    transportPrice: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
  };
}

/**
 * Movilidad (recojo, entrega o ambos) con la dirección y el precio que pone recepción según su
 * criterio. Se usa en la cola, en las citas y en el ingreso de grooming.
 */
@Component({
  selector: 'app-transport-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  host: { class: 'block @container' },
  template: `
    <div [formGroup]="group()">
      <span [id]="prefix() + '-label'" class="field-label">Movilidad</span>
      <div
        class="mt-1.5 grid grid-cols-2 gap-2 @md:grid-cols-4"
        role="radiogroup"
        [attr.aria-labelledby]="prefix() + '-label'"
      >
        @for (t of options; track t) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="group().controls.transport.value === t"
            class="min-h-11 rounded-xl px-3 py-2 text-sm font-medium ring-1 transition-colors"
            [class]="
              group().controls.transport.value === t
                ? 'bg-anil-50 text-anil-900 ring-2 ring-anil-600'
                : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'
            "
            (click)="choose(t)"
          >
            {{ labels[t] }}
          </button>
        }
      </div>
      @if (group().controls.transport.value !== 'NONE') {
        <div class="mt-3 grid gap-3 @md:grid-cols-[1fr_10rem]">
          <div>
            <label [for]="prefix() + '-address'" class="field-label">
              Dirección <span class="text-rose-600" aria-hidden="true">*</span>
            </label>
            <input
              [id]="prefix() + '-address'"
              class="field-input"
              formControlName="transportAddress"
              maxlength="200"
              autocomplete="off"
              [attr.aria-invalid]="addressMissing()"
            />
            @if (addressMissing()) {
              <p class="field-error">Escribe la dirección de recojo o entrega</p>
            } @else if (
              clientAddress() && group().controls.transportAddress.value === clientAddress()
            ) {
              <p class="field-hint">Dirección registrada del cliente. Si es otra, cámbiala aquí.</p>
            }
          </div>
          <div>
            <label [for]="prefix() + '-price'" class="field-label">Precio (S/)</label>
            <input
              [id]="prefix() + '-price'"
              type="number"
              inputmode="decimal"
              min="0"
              [max]="max"
              step="0.5"
              class="field-input tabular-nums"
              formControlName="transportPrice"
              [attr.aria-invalid]="group().controls.transportPrice.invalid"
              [attr.aria-describedby]="prefix() + '-price-hint'"
            />
            @if (group().controls.transportPrice.invalid) {
              <p [id]="prefix() + '-price-hint'" class="field-error">
                Hasta {{ money(max) }}: revisa el monto
              </p>
            } @else {
              <p [id]="prefix() + '-price-hint'" class="field-hint tabular-nums">
                @if (lastPrice() !== null) {
                  Última vez: {{ money(lastPrice()!) }}
                } @else {
                  Según la distancia. Vacío: sin cobro
                }
              </p>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class TransportFieldsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly group = input.required<FormGroup<TransportControls>>();
  /** Prefijo de los id (dos formularios en la misma pantalla no se pisan) */
  readonly prefix = input('mov');
  /** Dirección registrada del dueño: se propone al marcar la movilidad */
  readonly clientAddress = input('');
  /** Último precio que pagó el dueño: se propone al marcar la movilidad */
  readonly lastPrice = input<number | null>(null);
  readonly submitted = input(false);

  protected readonly options = TRANSPORTS;
  protected readonly labels = TRANSPORT_LABELS;
  protected readonly money = money;
  protected readonly max = TRANSPORT_MAX_PRICE;

  ngOnInit(): void {
    this.group()
      .controls.transport.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((t) => {
        if (t === 'NONE') return;
        const { transportAddress, transportPrice } = this.group().controls;
        if (!transportAddress.value.trim() && this.clientAddress())
          transportAddress.setValue(this.clientAddress());
        if (transportPrice.value === null && this.lastPrice() !== null)
          transportPrice.setValue(this.lastPrice());
      });
  }

  protected choose(t: GroomingTransport): void {
    this.group().controls.transport.setValue(t);
  }

  protected addressMissing(): boolean {
    const { transport, transportAddress } = this.group().controls;
    return (
      transport.value !== 'NONE' &&
      transportAddress.value.trim().length < 5 &&
      (this.submitted() || transportAddress.touched)
    );
  }
}
