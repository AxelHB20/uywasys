import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TrendPoint, compactMoney, niceScale } from '../../../core/services/reports.models';
import { money } from '../../utils/stock';

const HEIGHT = 168;
const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const TOOLTIP_W = 210;
/** Este mes: añil de la marca. Mes anterior: referencia en gris, con línea punteada. */
const CURRENT = '#4446c8';
const PREVIOUS = '#64748b';

/**
 * Lo cobrado acumulado en el mes contra el mes anterior, alineado por día del mes. Un solo
 * eje; el mes anterior va punteado y en gris porque es la referencia. Tooltip con el mouse o
 * con las flechas del teclado.
 */
@Component({
  selector: 'app-trend-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ul
      class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600"
      aria-label="Leyenda"
    >
      <li class="flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden="true">
          <line
            x1="0"
            x2="18"
            y1="3"
            y2="3"
            [attr.stroke]="current"
            stroke-width="2.5"
            stroke-linecap="round"
          />
        </svg>
        Este mes
      </li>
      <li class="flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden="true">
          <line
            x1="1"
            x2="18"
            y1="3"
            y2="3"
            [attr.stroke]="previous"
            stroke-width="2"
            stroke-dasharray="4 3"
            stroke-linecap="round"
          />
        </svg>
        {{ previousLabel() }}
      </li>
    </ul>
    <div class="relative" (pointerleave)="active.set(null)">
      <svg
        [attr.width]="width()"
        [attr.height]="height"
        class="block max-w-full touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-anil-500"
        role="img"
        tabindex="0"
        [attr.aria-label]="label()"
        (keydown)="onKey($event)"
        (focus)="active() === null && active.set(lastCurrent())"
        (blur)="active.set(null)"
        (pointermove)="onMove($event)"
        (pointerdown)="onMove($event)"
      >
        @for (t of scale().ticks; track t) {
          <line
            [attr.x1]="pad.left"
            [attr.x2]="width() - pad.right"
            [attr.y1]="y(t)"
            [attr.y2]="y(t)"
            [attr.stroke]="t === 0 ? '#cbd5e1' : '#eef0f4'"
            shape-rendering="crispEdges"
          />
          <text
            [attr.x]="pad.left - 8"
            [attr.y]="y(t)"
            text-anchor="end"
            dominant-baseline="middle"
            class="fill-slate-500 text-[11px] tabular-nums"
          >
            {{ axis(t) }}
          </text>
        }
        @for (d of xTicks(); track d) {
          <text
            [attr.x]="x(d)"
            [attr.y]="height - 6"
            text-anchor="middle"
            class="fill-slate-500 text-[11px] tabular-nums"
          >
            {{ d }}
          </text>
        }

        <path
          [attr.d]="previousPath()"
          fill="none"
          [attr.stroke]="previous"
          stroke-width="2"
          stroke-dasharray="4 3"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <path
          [attr.d]="currentPath()"
          fill="none"
          [attr.stroke]="current"
          stroke-width="2.5"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <!-- Hoy: punto al final de la línea de este mes -->
        @if (endPoint(); as e) {
          <circle
            [attr.cx]="e.x"
            [attr.cy]="e.y"
            r="4.5"
            [attr.fill]="current"
            stroke="white"
            stroke-width="2"
          />
        }

        @if (hover(); as h) {
          <line
            [attr.x1]="h.x"
            [attr.x2]="h.x"
            [attr.y1]="pad.top"
            [attr.y2]="height - pad.bottom"
            stroke="#94a3b8"
            stroke-width="1"
            stroke-dasharray="2 2"
          />
          @if (h.cy !== null) {
            <circle
              [attr.cx]="h.x"
              [attr.cy]="h.cy"
              r="4"
              [attr.fill]="current"
              stroke="white"
              stroke-width="2"
            />
          }
          @if (h.py !== null) {
            <circle
              [attr.cx]="h.x"
              [attr.cy]="h.py"
              r="4"
              [attr.fill]="previous"
              stroke="white"
              stroke-width="2"
            />
          }
        }
      </svg>

      @if (hover(); as h) {
        <div
          class="pointer-events-none absolute top-0 z-10 rounded-xl bg-white px-3 py-2.5 text-xs shadow-lg ring-1 ring-slate-200"
          [style.left.px]="h.left"
          [style.width.px]="tooltipW"
          aria-hidden="true"
        >
          <p class="font-medium text-slate-900">Al día {{ h.point.day }}</p>
          <dl class="mt-1.5 space-y-1 tabular-nums">
            <div class="flex items-center gap-2">
              <span class="h-0.5 w-3 rounded" [style.background]="current"></span>
              <dt class="whitespace-nowrap text-slate-600">Este mes</dt>
              <dd class="ml-auto font-medium whitespace-nowrap text-slate-900">
                {{ h.point.current === null ? '—' : money(h.point.current) }}
              </dd>
            </div>
            <div class="flex items-center gap-2">
              <span class="h-0.5 w-3 rounded" [style.background]="previous"></span>
              <dt class="whitespace-nowrap text-slate-600">Mes anterior</dt>
              <dd class="ml-auto whitespace-nowrap text-slate-700">
                {{ h.point.previous === null ? '—' : money(h.point.previous) }}
              </dd>
            </div>
          </dl>
        </div>
      }
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
    </div>
  `,
})
export class TrendChartComponent {
  readonly points = input.required<TrendPoint[]>();
  /** "Octubre" — nombre del mes anterior para la leyenda */
  readonly previousLabel = input('Mes anterior');

  protected readonly height = HEIGHT;
  protected readonly pad = PAD;
  protected readonly tooltipW = TOOLTIP_W;
  protected readonly current = CURRENT;
  protected readonly previous = PREVIOUS;
  protected readonly money = money;
  protected readonly width = signal(560);
  protected readonly active = signal<number | null>(null);

  private readonly plotW = computed(() => Math.max(40, this.width() - PAD.left - PAD.right));
  private readonly plotH = HEIGHT - PAD.top - PAD.bottom;
  private readonly days = computed(() => Math.max(1, this.points().length));

  protected readonly scale = computed(() =>
    niceScale(Math.max(0, ...this.points().flatMap((p) => [p.current ?? 0, p.previous ?? 0])), 3),
  );
  protected readonly xTicks = computed(() => {
    const n = this.days();
    const candidates = [1, 5, 10, 15, 20, 25, n];
    return candidates.filter(
      (d, i) => d <= n && (d === n || n - d >= 3) && candidates.indexOf(d) === i,
    );
  });
  protected readonly lastCurrent = computed(() => {
    const list = this.points();
    let last = 0;
    list.forEach((p, i) => p.current !== null && (last = i));
    return last;
  });

  protected readonly currentPath = computed(() => this.path('current'));
  protected readonly previousPath = computed(() => this.path('previous'));
  protected readonly endPoint = computed(() => {
    const i = this.lastCurrent();
    const p = this.points()[i];
    return p?.current == null ? null : { x: this.x(p.day), y: this.y(p.current) };
  });

  protected readonly hover = computed(() => {
    const i = this.active();
    if (i === null) return null;
    const point = this.points()[i];
    if (!point) return null;
    const x = this.x(point.day);
    const right = x + 12;
    const left = right + TOOLTIP_W <= this.width() ? right : x - 12 - TOOLTIP_W;
    return {
      point,
      x,
      cy: point.current === null ? null : this.y(point.current),
      py: point.previous === null ? null : this.y(point.previous),
      left: Math.max(0, left),
    };
  });

  protected readonly label = computed(() => {
    const list = this.points();
    const today = list[this.lastCurrent()];
    if (!today) return 'Gráfico de lo cobrado en el mes';
    const before = today.previous;
    return `Cobrado acumulado al día ${today.day}: ${money(today.current ?? 0)} este mes${
      before !== null ? `, ${money(before)} el mes anterior al mismo día` : ''
    }.`;
  });

  protected readonly announcement = computed(() => {
    const h = this.hover();
    if (!h) return '';
    const p = h.point;
    return `Al día ${p.day}: este mes ${p.current === null ? 'sin datos' : money(p.current)}, mes anterior ${
      p.previous === null ? 'sin datos' : money(p.previous)
    }.`;
  });

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = host.nativeElement as HTMLElement;
      const measure = () => {
        const w = Math.round(el.clientWidth);
        if (w > 0) this.width.set(w);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected x(day: number): number {
    const n = this.days();
    return PAD.left + (n === 1 ? this.plotW() / 2 : ((day - 1) / (n - 1)) * this.plotW());
  }

  protected y(value: number): number {
    return PAD.top + this.plotH - (value / this.scale().max) * this.plotH;
  }

  protected axis(value: number): string {
    return compactMoney(value);
  }

  protected onMove(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const n = this.days();
    const ratio = (event.clientX - box.left - PAD.left) / this.plotW();
    this.active.set(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))));
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.days();
    const current = this.active() ?? this.lastCurrent();
    const next =
      event.key === 'ArrowRight'
        ? Math.min(n - 1, current + 1)
        : event.key === 'ArrowLeft'
          ? Math.max(0, current - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? n - 1
              : event.key === 'Escape'
                ? null
                : undefined;
    if (next === undefined) return;
    event.preventDefault();
    this.active.set(next);
  }

  private path(key: 'current' | 'previous'): string {
    return this.points()
      .filter((p) => p[key] !== null)
      .map((p, i) => `${i ? 'L' : 'M'}${this.x(p.day).toFixed(1)},${this.y(p[key]!).toFixed(1)}`)
      .join('');
  }
}
