import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MAX_REPORT_DAYS,
  REPORT_PRESETS,
  REPORT_PRESET_LABELS,
  REPORT_PRESET_TITLES,
  ReportPreset,
  addDays,
  rangeIssue,
  rangeLabel,
  shortDay,
} from '../../core/services/reports.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PeriodState } from './report-period';

/**
 * Período de los reportes: 8 botones rápidos y “Fechas” (hasta 2 años). El límite se dice antes
 * de elegir, el calendario no ofrece fechas fuera del rango y, si se escribe una fecha que no va,
 * se ofrece cómo arreglarla con un toque (sin errores en rojo). En el celular, las fechas se
 * eligen en una hoja que sube desde abajo.
 */
@Component({
  selector: 'app-report-period',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '(document:keydown.escape)': 'close()' },
  template: `
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="relative min-w-0 flex-1 sm:flex-none">
        <div
          role="group"
          aria-label="Período"
          class="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:gap-0 sm:overflow-visible sm:rounded-xl sm:bg-slate-200/60 sm:p-[3px] sm:pb-[3px]"
        >
          @for (p of presets; track p) {
            <button
              type="button"
              [attr.aria-pressed]="value().period === p"
              [attr.aria-label]="titles[p]"
              class="min-h-11 shrink-0 rounded-full px-3.5 text-sm font-medium whitespace-nowrap ring-1 transition-colors sm:min-h-9 sm:rounded-[9px] sm:px-2.5 sm:ring-0"
              [class]="
                value().period === p
                  ? 'bg-slate-900 text-white ring-slate-900 sm:bg-white sm:font-semibold sm:text-slate-900 sm:shadow-sm'
                  : 'bg-white text-slate-700 ring-slate-300 hover:text-slate-900 sm:bg-transparent sm:text-slate-600'
              "
              (click)="choose.emit(p)"
            >
              {{ labels[p] }}
            </button>
          }
        </div>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas sm:hidden"
        ></span>
      </div>

      <div class="relative flex flex-wrap items-center justify-end gap-3 sm:ml-auto">
        @if (previous(); as prev) {
          @if (previousEmpty()) {
            <span
              class="order-last inline-flex w-full items-center gap-1.5 text-xs text-slate-600 sm:order-none sm:w-auto"
              [title]="'Período anterior: ' + range(prev.from, prev.to)"
            >
              <app-icon name="info" class="size-3.5 shrink-0" />
              <span
                >Sin ventas en el período anterior<span class="hidden xl:inline">
                  ({{ range(prev.from, prev.to) }})</span
                >: no hay con qué comparar</span
              >
            </span>
          } @else {
            <span class="hidden text-xs whitespace-nowrap text-slate-600 lg:inline">
              vs {{ range(prev.from, prev.to) }}
            </span>
          }
        }
        <button
          #trigger
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm whitespace-nowrap ring-1 sm:min-h-10"
          [class]="
            value().period === 'custom'
              ? 'bg-anil-50 font-semibold text-anil-800 ring-anil-500'
              : 'bg-white font-medium text-slate-900 ring-slate-300'
          "
          [attr.aria-expanded]="open()"
          aria-haspopup="dialog"
          [attr.aria-pressed]="value().period === 'custom'"
          (click)="toggle()"
        >
          <app-icon name="calendar" class="size-4 text-slate-500" />
          <span class="sm:hidden">Fechas</span>
          <span class="hidden sm:inline">{{ range(value().from, value().to) }}</span>
          <app-icon name="chevron-down" class="size-3.5 text-slate-500" />
        </button>

        @if (open()) {
          <div class="fixed inset-0 z-40 bg-slate-900/35 sm:bg-transparent" (click)="close()"></div>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rp-dates-title"
            class="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white p-4 pb-6 shadow-2xl sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[23.5rem] sm:rounded-2xl sm:p-[18px] sm:ring-1 sm:ring-slate-200"
          >
            <span
              aria-hidden="true"
              class="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-slate-300 sm:hidden"
            ></span>
            <h2 id="rp-dates-title" class="font-display text-base font-semibold text-slate-900">
              Elegir fechas
            </h2>
            <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:gap-2.5">
              <div class="min-w-0 flex-1">
                <label for="rp-from" class="field-label">Desde</label>
                <input
                  #fromInput
                  id="rp-from"
                  type="date"
                  class="field-input"
                  [class.rp-warn]="!!issue()"
                  [value]="draftFrom()"
                  [min]="fromMin()"
                  [max]="fromMax()"
                  [attr.aria-describedby]="issue() ? 'rp-issue' : 'rp-help'"
                  (input)="draftFrom.set(fromInput.value)"
                />
              </div>
              <div class="min-w-0 flex-1">
                <label for="rp-to" class="field-label">Hasta</label>
                <input
                  #toInput
                  id="rp-to"
                  type="date"
                  class="field-input"
                  [value]="draftTo()"
                  [min]="toMin()"
                  [max]="toMax()"
                  [attr.aria-describedby]="issue() ? 'rp-issue' : 'rp-help'"
                  (input)="draftTo.set(toInput.value)"
                />
              </div>
            </div>
            @if (issue(); as i) {
              <div
                id="rp-issue"
                role="alert"
                class="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200"
              >
                <p class="flex items-start gap-2">
                  <app-icon name="alert" class="mt-0.5 size-4 shrink-0" />
                  @if (i.kind === 'reversed') {
                    <span>La fecha inicial va después de la final.</span>
                  } @else {
                    <span
                      >Son <b>{{ i.length }}</b
                      >. El máximo es 2 años. Elige uno:</span
                    >
                  }
                </p>
                <div class="mt-2.5 flex flex-col gap-1.5">
                  @if (i.kind === 'reversed') {
                    <button type="button" class="fix-btn" (click)="swap()">
                      Intercambiar fechas
                    </button>
                  } @else {
                    <button type="button" class="fix-btn" (click)="use(i.lastTwoYears)">
                      <b>Usar los últimos 2 años</b>
                      <span class="block text-xs font-normal">{{
                        range(i.lastTwoYears.from, i.lastTwoYears.to)
                      }}</span>
                    </button>
                    <button type="button" class="fix-btn" (click)="use(i.fromStart)">
                      <b>Usar 2 años desde tu fecha</b>
                      <span class="block text-xs font-normal">{{
                        range(i.fromStart.from, i.fromStart.to)
                      }}</span>
                    </button>
                  }
                </div>
              </div>
            } @else {
              <p id="rp-help" class="mt-2.5 text-xs leading-relaxed text-slate-500">
                Puedes elegir hasta <b>2 años</b>. Con la fecha final del
                {{ day(draftTo() || today()) }}, lo más antiguo es el <b>{{ day(fromMin()) }}</b
                >.
              </p>
            }
            <div class="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" class="btn btn-secondary flex-1 sm:flex-none" (click)="close()">
                Cancelar
              </button>
              <button
                type="button"
                class="btn btn-primary flex-1 sm:flex-none"
                [disabled]="!canApply()"
                (click)="apply()"
              >
                Aplicar
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .rp-warn {
      box-shadow: 0 0 0 2px var(--color-amber-400) !important;
    }
    .fix-btn {
      display: block;
      width: 100%;
      min-height: 44px;
      padding: 6px 12px;
      border-radius: 11px;
      background: #fff;
      border: 1px solid var(--color-amber-300);
      color: var(--color-amber-950);
      font-size: 0.8125rem;
      text-align: center;
    }
    .fix-btn:hover {
      background: var(--color-amber-50);
    }
  `,
})
export class ReportPeriodComponent {
  readonly value = input.required<PeriodState>();
  readonly today = input.required<string>();
  /** Período con el que se compara (lo manda el servidor) */
  readonly previous = input<{ from: string; to: string } | null>(null);
  /** El período anterior no tiene datos: se avisa aquí una vez, en vez de en cada tarjeta */
  readonly previousEmpty = input(false);
  readonly choose = output<ReportPreset>();
  readonly custom = output<{ from: string; to: string }>();

  protected readonly presets = REPORT_PRESETS;
  protected readonly labels = REPORT_PRESET_LABELS;
  protected readonly titles = REPORT_PRESET_TITLES;
  protected readonly range = rangeLabel;
  protected readonly day = shortDay;

  protected readonly open = signal(false);
  protected readonly draftFrom = signal('');
  protected readonly draftTo = signal('');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly fromInput = viewChild<ElementRef<HTMLInputElement>>('fromInput');

  protected readonly issue = computed(() =>
    rangeIssue(this.draftFrom(), this.draftTo(), this.today()),
  );
  protected readonly canApply = computed(
    () => !!this.draftFrom() && !!this.draftTo() && !this.issue() && this.draftTo() <= this.today(),
  );
  /** Límites del calendario: nunca más de 2 años ni después de hoy */
  protected readonly fromMin = computed(() =>
    addDays(this.draftTo() || this.today(), -(MAX_REPORT_DAYS - 1)),
  );
  protected readonly fromMax = computed(() => this.draftTo() || this.today());
  protected readonly toMin = computed(() => this.draftFrom());
  protected readonly toMax = computed(() => {
    const limit = this.draftFrom() ? addDays(this.draftFrom(), MAX_REPORT_DAYS - 1) : this.today();
    return limit < this.today() ? limit : this.today();
  });

  protected toggle(): void {
    if (this.open()) return this.close();
    this.draftFrom.set(this.value().from);
    this.draftTo.set(this.value().to);
    this.open.set(true);
    setTimeout(() => this.fromInput()?.nativeElement.focus());
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }

  protected use(r: { from: string; to: string }): void {
    this.draftFrom.set(r.from);
    this.draftTo.set(r.to);
  }

  protected swap(): void {
    const from = this.draftFrom();
    this.draftFrom.set(this.draftTo());
    this.draftTo.set(from);
  }

  protected apply(): void {
    if (!this.canApply()) return;
    this.custom.emit({ from: this.draftFrom(), to: this.draftTo() });
    this.close();
  }
}
