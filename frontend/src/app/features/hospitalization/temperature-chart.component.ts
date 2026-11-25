import { vitalRange } from '../../shared/utils/vital-signs';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Species } from '../../core/services/clients.models';
import { Vitals, temperatureFlag, whenOf } from '../../core/services/hospitalization.models';

const W = 300;
const H = 120;
const PAD = { top: 10, right: 10, bottom: 20, left: 30 };

/**
 * Curva de temperatura con la franja normal de la especie. Cada punto fuera de rango se marca
 * con color y forma (no solo color); la tabla de abajo tiene los mismos datos.
 */
@Component({
  selector: 'app-temperature-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (points().length >= 2) {
      <svg
        [attr.viewBox]="'0 0 ' + w + ' ' + h"
        class="block h-auto w-full"
        role="img"
        [attr.aria-label]="label()"
      >
        <!-- Franja normal -->
        <rect
          [attr.x]="pad.left"
          [attr.y]="y(range()[1])"
          [attr.width]="w - pad.left - pad.right"
          [attr.height]="y(range()[0]) - y(range()[1])"
          fill="#ecfdf5"
        />
        @for (t of ticks(); track t) {
          <line
            [attr.x1]="pad.left"
            [attr.x2]="w - pad.right"
            [attr.y1]="y(t)"
            [attr.y2]="y(t)"
            stroke="#eef0f4"
            shape-rendering="crispEdges"
          />
          <text
            [attr.x]="pad.left - 6"
            [attr.y]="y(t)"
            text-anchor="end"
            dominant-baseline="middle"
            class="fill-slate-500 text-[10px] tabular-nums"
          >
            {{ t }}
          </text>
        }
        <polyline
          [attr.points]="line()"
          fill="none"
          stroke="#4446c8"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        @for (p of points(); track p.at) {
          @if (p.flag) {
            <rect
              [attr.x]="p.x - 4"
              [attr.y]="p.y - 4"
              width="8"
              height="8"
              [attr.fill]="p.flag === 'high' ? '#e11d48' : '#0284c7'"
              stroke="#fff"
              stroke-width="1.5"
            />
          } @else {
            <circle
              [attr.cx]="p.x"
              [attr.cy]="p.y"
              r="3.5"
              fill="#4446c8"
              stroke="#fff"
              stroke-width="1.5"
            />
          }
        }
        <text [attr.x]="pad.left" [attr.y]="h - 4" class="fill-slate-500 text-[10px]">
          {{ points()[0].label }}
        </text>
        <text
          [attr.x]="w - pad.right"
          [attr.y]="h - 4"
          text-anchor="end"
          class="fill-slate-500 text-[10px]"
        >
          {{ points()[points().length - 1].label }}
        </text>
      </svg>
    }
  `,
})
export class TemperatureChartComponent {
  readonly vitals = input.required<Vitals[]>();
  readonly species = input.required<Species>();

  protected readonly w = W;
  protected readonly h = H;
  protected readonly pad = PAD;

  /** Lecturas con temperatura, de la más antigua a la más reciente (últimas 12) */
  private readonly readings = computed(() =>
    this.vitals()
      .filter((v) => v.temperatureC !== null)
      .slice(0, 12)
      .reverse(),
  );
  protected readonly range = computed<[number, number]>(
    () => vitalRange(this.species(), 'temperatureC') ?? [37.5, 39.5],
  );
  private readonly domain = computed<[number, number]>(() => {
    const temps = this.readings().map((r) => r.temperatureC as number);
    const lo = Math.floor(Math.min(37, ...temps));
    const hi = Math.ceil(Math.max(40, ...temps));
    return [lo, hi];
  });
  protected readonly ticks = computed(() => {
    const [lo, hi] = this.domain();
    const out: number[] = [];
    for (let t = lo; t <= hi; t++) out.push(t);
    return out;
  });
  protected readonly points = computed(() => {
    const list = this.readings();
    const step = (W - PAD.left - PAD.right) / Math.max(1, list.length - 1);
    return list.map((r, i) => ({
      at: r.at,
      x: PAD.left + i * step,
      y: this.y(r.temperatureC as number),
      flag: temperatureFlag(this.species(), r.temperatureC),
      label: whenOf(r.at),
    }));
  });
  protected readonly line = computed(() =>
    this.points()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );
  protected readonly label = computed(() => {
    const list = this.readings();
    const last = list[list.length - 1];
    return `Temperatura: ${list.length} lecturas, la última ${last?.temperatureC} °C.`;
  });

  protected y(t: number): number {
    const [lo, hi] = this.domain();
    return PAD.top + (1 - (t - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  }
}
