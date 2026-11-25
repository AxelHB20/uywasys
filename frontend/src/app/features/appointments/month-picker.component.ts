import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { AppointmentsService } from '../../core/services/appointments.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { limaClock } from '../../core/services/appointments.models';

const monthTitle = new Intl.DateTimeFormat('es-PE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** "2026-11" → días del mes en una grilla que empieza en lunes (null = relleno) */
function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Calendario del mes para saltar a una fecha: marca los días con citas (y si alguna falta
 * confirmar). Reemplaza al selector de fecha del navegador, que cambia según el equipo.
 */
@Component({
  selector: 'app-month-picker',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative',
    '(document:click)': 'outside($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  template: `
    <button
      type="button"
      class="flex h-10 w-full items-center justify-between gap-2 rounded-xl px-3 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-anil-600 sm:w-auto"
      [attr.aria-expanded]="open()"
      aria-haspopup="dialog"
      (click)="toggle()"
    >
      <app-icon name="calendar" class="size-4 text-slate-500" />
      <span class="first-letter:uppercase">{{ title(day().slice(0, 7)) }}</span>
      <app-icon name="chevron-down" class="size-4 text-slate-400" />
    </button>
    @if (open()) {
      <div
        animate.enter="panel-in"
        animate.leave="panel-out"
        class="absolute top-12 right-0 z-50 w-72 origin-top-right rounded-2xl bg-white p-3 shadow-xl shadow-anil-950/10 ring-1 ring-slate-200/70"
        role="dialog"
        aria-label="Elegir fecha"
      >
        <div class="flex items-center justify-between">
          <button
            type="button"
            class="grid size-9 place-items-center rounded-lg hover:bg-slate-100"
            aria-label="Mes anterior"
            (click)="month.set(shift(month(), -1))"
          >
            <app-icon name="chevron-left" class="size-4" />
          </button>
          <p class="text-sm font-semibold text-slate-900">
            {{ title(month()) }}
          </p>
          <button
            type="button"
            class="grid size-9 place-items-center rounded-lg hover:bg-slate-100"
            aria-label="Mes siguiente"
            (click)="month.set(shift(month(), 1))"
          >
            <app-icon name="chevron-right" class="size-4" />
          </button>
        </div>
        <div class="mt-2 grid grid-cols-7 text-center text-[11px] font-medium text-slate-400">
          @for (w of weekdays; track $index) {
            <span class="py-1">{{ w }}</span>
          }
        </div>
        <div class="grid grid-cols-7 gap-y-0.5">
          @for (d of cells(); track $index) {
            @if (d) {
              @let c = counts().get(d);
              <button
                type="button"
                class="relative mx-auto grid size-9 place-items-center rounded-full text-sm tabular-nums transition-colors"
                [class]="
                  d === day()
                    ? 'bg-anil-600 font-semibold text-white'
                    : d === today()
                      ? 'font-semibold text-anil-700 ring-1 ring-anil-300 hover:bg-anil-50'
                      : d < today()
                        ? 'text-slate-400 hover:bg-slate-100'
                        : 'text-slate-800 hover:bg-slate-100'
                "
                [attr.aria-label]="
                  d + (c ? ', ' + c.total + (c.total === 1 ? ' cita' : ' citas') : '')
                "
                [attr.aria-current]="d === day() ? 'date' : null"
                (click)="choose(d)"
              >
                {{ +d.slice(8) }}
                @if (c) {
                  <span
                    class="absolute bottom-1 size-1 rounded-full"
                    [class]="d === day() ? 'bg-white' : c.pending ? 'bg-amber-500' : 'bg-anil-500'"
                    aria-hidden="true"
                  ></span>
                }
              </button>
            } @else {
              <span></span>
            }
          }
        </div>
        <div class="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
          <span class="flex items-center gap-3 text-slate-500">
            <span class="flex items-center gap-1"
              ><span class="size-1.5 rounded-full bg-anil-500"></span>Con citas</span
            >
            <span class="flex items-center gap-1"
              ><span class="size-1.5 rounded-full bg-amber-500"></span>Por confirmar</span
            >
          </span>
          <button
            type="button"
            class="rounded-md px-2 py-1 font-medium text-anil-700 hover:bg-anil-50"
            (click)="choose(today())"
          >
            Hoy
          </button>
        </div>
      </div>
    }
  `,
})
export class MonthPickerComponent {
  private readonly api = inject(AppointmentsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly day = input.required<string>();
  readonly today = input.required<string>();
  readonly picked = output<string>();

  protected readonly open = signal(false);
  protected readonly month = signal('');
  protected readonly weekdays = WEEKDAYS;
  /** "Noviembre 2026" */
  protected readonly title = (month: string) => {
    const t = monthTitle.format(new Date(`${month}-01T00:00:00Z`)).replace(' de ', ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  protected readonly shift = shiftMonth;
  protected readonly cells = computed(() => (this.month() ? monthGrid(this.month()) : []));

  /** Citas del mes visible (solo con el calendario abierto) */
  private readonly monthItems = rxResource({
    params: () => (this.open() && this.month() ? this.month() : null),
    stream: ({ params }) => {
      if (!params) return of([]);
      const cells = monthGrid(params).filter((d): d is string => !!d);
      return this.api.list({ from: cells[0], to: cells[cells.length - 1] });
    },
  });
  protected readonly counts = computed(() => {
    const map = new Map<string, { total: number; pending: number }>();
    const items = this.monthItems.hasValue() ? this.monthItems.value() : [];
    for (const a of items) {
      if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') continue;
      const d = limaClock(a.startsAt).day;
      const c = map.get(d) ?? { total: 0, pending: 0 };
      c.total++;
      if (a.status === 'SCHEDULED') c.pending++;
      map.set(d, c);
    }
    return map;
  });

  protected toggle(): void {
    if (!this.open()) this.month.set(this.day().slice(0, 7));
    this.open.update((v) => !v);
  }

  protected choose(day: string): void {
    this.open.set(false);
    this.picked.emit(day);
  }

  protected outside(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node))
      this.open.set(false);
  }
}
