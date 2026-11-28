import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DocumentChoice, DocumentOption } from '../../../core/services/billing.models';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons';

const DETAILS: Record<DocumentChoice, { icon: IconName; caption: string }> = {
  BOLETA: { icon: 'receipt', caption: 'Consumidor final' },
  FACTURA: { icon: 'building', caption: 'Empresa con RUC' },
  NOTE: { icon: 'file-text', caption: 'Uso interno' },
};

/**
 * Qué comprobante se emite en un cobro: boleta, factura o nota de venta.
 * Tarjetas con rol de radio (flechas para moverse, Espacio/Enter para elegir). Si la opción
 * elegida deja de estar disponible (p. ej. boleta de más de S/ 700 sin DNI), pasa a la primera libre.
 * Sin facturación electrónica activa solo se emite nota de venta, y se dice cómo activarla.
 */
@Component({
  selector: 'app-document-choice',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length > 1) {
      <div>
        <div class="flex items-center gap-2">
          <span id="document-choice-label" class="field-label">Comprobante</span>
          @if (simulated()) {
            <span
              class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
            >
              <span class="size-1.5 rounded-full bg-amber-500" aria-hidden="true"></span>
              Simulación
            </span>
          }
        </div>
        @if (variant() === 'tabs') {
          <!-- Pestañas compactas (panel de cobro de la caja) -->
          <div
            class="mt-2 flex gap-0.5 rounded-xl bg-slate-200/70 p-1"
            role="radiogroup"
            aria-labelledby="document-choice-label"
            (keydown)="onKey($event)"
          >
            @for (o of items(); track o.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="o.value === selected()"
                [attr.aria-disabled]="o.disabled || null"
                [attr.aria-describedby]="o.hint ? 'doc-hint-' + o.value : null"
                [attr.data-value]="o.value"
                [tabindex]="o.value === focusable() ? 0 : -1"
                [title]="o.caption"
                (click)="choose(o)"
                class="h-10 min-w-0 flex-1 rounded-lg px-1 text-[13px] short:h-9 whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-anil-600 motion-reduce:transition-none pointer-coarse:h-11"
                [class]="
                  o.disabled
                    ? 'cursor-not-allowed text-slate-400'
                    : o.value === selected()
                      ? 'bg-white font-semibold text-slate-900 shadow-sm'
                      : 'cursor-pointer font-medium text-slate-600 hover:text-slate-900'
                "
              >
                {{ o.value === 'NOTE' ? 'Nota de venta' : o.label }}
              </button>
            }
          </div>
        } @else {
          <div
            class="mt-2 grid grid-cols-3 gap-2"
            role="radiogroup"
            aria-labelledby="document-choice-label"
            (keydown)="onKey($event)"
          >
            @for (o of items(); track o.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="o.value === selected()"
                [attr.aria-disabled]="o.disabled || null"
                [attr.aria-describedby]="o.hint ? 'doc-hint-' + o.value : null"
                [attr.data-value]="o.value"
                [tabindex]="o.value === focusable() ? 0 : -1"
                (click)="choose(o)"
                class="group relative flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-xl px-3 py-2.5 text-left ring-1 transition-[background-color,box-shadow,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anil-600 motion-reduce:transition-none"
                [class]="
                  o.disabled
                    ? 'cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-200'
                    : o.value === selected()
                      ? 'cursor-pointer bg-anil-50 text-anil-900 ring-2 ring-anil-600 shadow-sm'
                      : 'cursor-pointer bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 active:bg-slate-100'
                "
              >
                <span class="flex w-full items-center justify-between">
                  <app-icon
                    [name]="o.disabled ? 'lock' : o.icon"
                    class="size-[18px]"
                    [class]="
                      o.disabled
                        ? 'text-slate-400'
                        : o.value === selected()
                          ? 'text-anil-600'
                          : 'text-slate-500'
                    "
                  />
                  <span
                    class="grid size-4 place-items-center rounded-full ring-1 transition-colors duration-150"
                    [class]="
                      o.value === selected()
                        ? 'bg-anil-600 text-white ring-anil-600'
                        : 'bg-white ring-slate-300'
                    "
                    aria-hidden="true"
                  >
                    @if (o.value === selected()) {
                      <app-icon name="check" [strokeWidth]="3" class="size-2.5" />
                    }
                  </span>
                </span>
                <span class="mt-1 text-sm font-semibold leading-tight">{{ o.label }}</span>
                <span
                  class="text-xs leading-tight"
                  [class]="
                    o.disabled
                      ? 'text-slate-400'
                      : o.value === selected()
                        ? 'text-anil-700'
                        : 'text-slate-500'
                  "
                  >{{ o.caption }}</span
                >
              </button>
            }
          </div>
        }
        @for (o of hints(); track o.value) {
          <p
            [id]="'doc-hint-' + o.value"
            class="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"
          >
            <app-icon name="info" class="size-3.5 text-slate-400" />
            {{ o.hint }}
          </p>
        }
      </div>
    } @else {
      <p
        class="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-200"
      >
        <app-icon name="file-text" class="mt-px size-4 text-slate-400" />
        <span>
          Se emite <span class="font-medium text-slate-800">nota de venta</span> (uso interno, no
          vale ante SUNAT).
          @if (setupLink(); as link) {
            <a
              [routerLink]="link"
              class="font-medium text-anil-700 underline underline-offset-2 hover:text-anil-800"
            >
              Activar boletas y facturas
            </a>
          } @else {
            Para boletas y facturas, el administrador debe activar los comprobantes electrónicos.
          }
        </span>
      </p>
    }
  `,
})
export class DocumentChoiceComponent {
  readonly options = input.required<DocumentOption[]>();
  readonly control = input.required<FormControl<DocumentChoice>>();
  readonly simulated = input(false);
  /** 'tabs': pestañas compactas para el panel de cobro; 'cards': tarjetas con descripción */
  readonly variant = input<'cards' | 'tabs'>('cards');
  /** Enlace a la configuración (solo para quien puede activarla) */
  readonly setupLink = input<string | null>(null);

  /** Valor del control como signal (el control puede cambiar desde la página, p. ej. al reiniciar) */
  protected readonly selected = signal<DocumentChoice | null>(null);

  protected readonly items = computed(() =>
    this.options().map((o) => ({ ...o, ...DETAILS[o.value] })),
  );
  /** Avisos: de las opciones bloqueadas y de la elegida (p. ej. boleta de más de S/ 700 lleva DNI) */
  protected readonly hints = computed(() =>
    this.options().filter((o) => o.hint && (o.disabled || o.value === this.selected())),
  );
  /** La opción que recibe el Tab: la elegida, o la primera disponible */
  protected readonly focusable = computed(() => {
    const enabled = this.options().filter((o) => !o.disabled);
    return (enabled.find((o) => o.value === this.selected()) ?? enabled[0])?.value ?? null;
  });

  constructor() {
    // Sigue al control: su valor inicial y los cambios que haga la página
    effect((onCleanup) => {
      const control = this.control();
      this.selected.set(control.value);
      const sub = control.valueChanges.subscribe((v) => this.selected.set(v));
      onCleanup(() => sub.unsubscribe());
    });
    // Si lo elegido ya no se puede emitir, pasa a la primera opción disponible
    effect(() => {
      const options = this.options();
      const current = options.find((o) => o.value === this.selected());
      if (current && !current.disabled) return;
      const fallback = options.find((o) => !o.disabled);
      if (fallback && fallback.value !== this.selected()) this.control().setValue(fallback.value);
    });
  }

  protected choose(o: DocumentOption): void {
    if (o.disabled) return;
    this.control().setValue(o.value);
    this.control().markAsDirty();
  }

  /** Flechas: pasa a la opción disponible siguiente/anterior y la elige (patrón de radiogroup) */
  protected onKey(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const enabled = this.options().filter((o) => !o.disabled);
    if (!enabled.length) return;
    const index = enabled.findIndex((o) => o.value === this.selected());
    const next = enabled[(index + step + enabled.length) % enabled.length];
    this.choose(next);
    const group = event.currentTarget as HTMLElement;
    group.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  }
}
