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
import { DailyBar, compactMoney, niceScale } from '../../../core/services/reports.models';
import { money } from '../../utils/stock';

const HEIGHT = 216;
const PAD = { top: 12, right: 4, bottom: 34, left: 52 };
const TOOLTIP_W = 188;

const weekday = new Intl.DateTimeFormat('es-PE', { weekday: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const dateOf = (day: string) => new Date(`${day}T12:00:00Z`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Cobrado por día de las últimas dos semanas. Detrás de cada barra, en gris, el mismo día de la
 * semana anterior; hoy va marcado como "en curso". Tooltip con mouse, toque o flechas.
 */
@Component({
  selector: 'app-daily-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="relative" (pointerleave)="active.set(null)">
      <svg
        [attr.width]="width()"
        [attr.height]="height"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height"
        class="block max-w-full touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-anil-500"
        role="img"
        tabindex="0"
        [attr.aria-label]="label()"
        (keydown)="onKey($event)"
        (focus)="active() === null && geometry().length && active.set(geometry().length - 1)"
        (blur)="active.set(null)"
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
        @if (average() > 0) {
          <line
            [attr.x1]="pad.left"
            [attr.x2]="width() - pad.right"
            [attr.y1]="y(average())"
            [attr.y2]="y(average())"
            stroke="#64748b"
            stroke-dasharray="3 3"
            stroke-width="1"
          />
        }
        @for (b of geometry(); track b.day; let i = $index) {
          <g
            [attr.opacity]="active() === null || active() === i ? 1 : 0.45"
            class="transition-opacity duration-150 motion-reduce:transition-none"
          >
            <!-- Semana anterior -->
            @if (b.prevH > 0) {
              <rect
                [attr.x]="b.x"
                [attr.y]="base() - b.prevH"
                [attr.width]="b.w"
                [attr.height]="b.prevH"
                rx="3"
                fill="#e2e8f0"
              />
            }
            @if (b.h > 0) {
              <rect
                [attr.x]="b.x + b.w * 0.18"
                [attr.y]="base() - b.h"
                [attr.width]="b.w * 0.64"
                [attr.height]="b.h"
                rx="3"
                [attr.fill]="b.today ? 'url(#today-fill)' : '#4446c8'"
                [attr.stroke]="b.today ? '#4446c8' : 'none'"
                stroke-width="1.5"
              />
            }
          </g>
          <text
            [attr.x]="b.cx"
            [attr.y]="height - 18"
            text-anchor="middle"
            class="text-[10.5px]"
            [class]="b.today ? 'fill-anil-700 font-semibold' : 'fill-slate-500'"
          >
            {{ b.weekday }}
          </text>
          <text
            [attr.x]="b.cx"
            [attr.y]="height - 5"
            text-anchor="middle"
            class="text-[11px] tabular-nums"
            [class]="b.today ? 'fill-anil-700 font-semibold' : 'fill-slate-700'"
          >
            {{ b.today ? 'Hoy' : b.dayNumber }}
          </text>
          <rect
            [attr.x]="b.bandX"
            [attr.y]="pad.top"
            [attr.width]="b.bandW"
            [attr.height]="plotH()"
            fill="transparent"
            (pointerenter)="active.set(i)"
            (pointerdown)="active.set(i)"
          />
        }
        <defs>
          <pattern
            id="today-fill"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="#c7c8f4" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#4446c8" stroke-width="3" />
          </pattern>
        </defs>
      </svg>

      @if (tooltip(); as t) {
        <div
          class="pointer-events-none absolute top-1 z-10 rounded-xl bg-white px-3.5 py-3 text-sm shadow-lg ring-1 ring-slate-200"
          [style.left.px]="t.left"
          [style.width.px]="tooltipW"
          aria-hidden="true"
        >
          <p class="font-medium text-slate-900">{{ t.title }}</p>
          <dl class="mt-2 space-y-1 tabular-nums">
            <div class="flex items-center gap-2">
              <span class="size-2.5 rounded-sm bg-anil-600"></span>
              <dt class="text-slate-600">{{ t.b.today ? 'Hoy (en curso)' : 'Cobrado' }}</dt>
              <dd class="ml-auto font-semibold text-slate-900">{{ money(t.b.value) }}</dd>
            </div>
            <div class="flex items-center gap-2">
              <span class="size-2.5 rounded-sm bg-slate-200"></span>
              <dt class="text-slate-600">Semana anterior</dt>
              <dd class="ml-auto text-slate-700">{{ money(t.b.previous) }}</dd>
            </div>
          </dl>
        </div>
      }
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
    </div>
  `,
})
export class DailyBarsComponent {
  readonly bars = input.required<DailyBar[]>();

  protected readonly height = HEIGHT;
  protected readonly pad = PAD;
  protected readonly tooltipW = TOOLTIP_W;
  protected readonly money = money;
  protected readonly active = signal<number | null>(null);
  protected readonly width = signal(640);

  protected readonly plotH = computed(() => HEIGHT - PAD.top - PAD.bottom);
  protected readonly base = computed(() => PAD.top + this.plotH());
  protected readonly scale = computed(() =>
    niceScale(Math.max(0, ...this.visible().flatMap((b) => [b.value, b.previous]))),
  );
  /** Promedio de los días cerrados (hoy no cuenta: va por la mitad) */
  protected readonly average = computed(() => {
    const closed = this.visible().filter((b) => !b.today);
    return closed.length ? closed.reduce((s, b) => s + b.value, 0) / closed.length : 0;
  });

  /** En pantallas angostas, solo la última semana (las etiquetas no caben) */
  private readonly visible = computed(() =>
    this.width() < 560 ? this.bars().slice(-7) : this.bars(),
  );

  protected readonly geometry = computed(() => {
    const list = this.visible();
    const band = (this.width() - PAD.left - PAD.right) / Math.max(1, list.length);
    const w = Math.max(6, Math.min(34, band * 0.72));
    return list.map((b, i) => {
      const bandX = PAD.left + i * band;
      const cx = bandX + band / 2;
      const d = dateOf(b.day);
      return {
        ...b,
        bandX,
        bandW: band,
        cx,
        x: cx - w / 2,
        w,
        h: this.h(b.value),
        prevH: this.h(b.previous),
        weekday: weekday.format(d).replace('.', '').slice(0, 3),
        dayNumber: d.getUTCDate(),
      };
    });
  });

  protected readonly tooltip = computed(() => {
    const i = this.active();
    if (i === null) return null;
    const b = this.geometry()[i];
    if (!b) return null;
    const right = b.cx + 16;
    const left = right + TOOLTIP_W <= this.width() ? right : b.cx - 16 - TOOLTIP_W;
    return { b, left: Math.max(0, left), title: capitalize(longDay.format(dateOf(b.day))) };
  });

  protected readonly label = computed(() => {
    const list = this.visible();
    const total = list.reduce((s, b) => s + b.value, 0);
    return `Cobrado por día, últimos ${list.length} días: ${money(total)} en total, promedio diario ${money(this.average())}.`;
  });

  protected readonly announcement = computed(() => {
    const t = this.tooltip();
    return t ? `${t.title}: ${money(t.b.value)}; la semana anterior ${money(t.b.previous)}.` : '';
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

  protected y(value: number): number {
    return this.base() - this.h(value);
  }

  protected axis(value: number): string {
    return compactMoney(value);
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.geometry().length;
    if (!n) return;
    const current = this.active() ?? n - 1;
    const next =
      event.key === 'ArrowRight'
        ? Math.min(n - 1, current + 1)
        : event.key === 'ArrowLeft'
          ? Math.max(0, current - 1)
          : event.key === 'Escape'
            ? null
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    this.active.set(next);
  }

  private h(value: number): number {
    return value > 0 ? (value / this.scale().max) * this.plotH() : 0;
  }
}
