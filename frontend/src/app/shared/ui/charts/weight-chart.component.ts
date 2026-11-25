import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { WeightPoint } from '../../../core/services/visits.models';
import { formatDate } from '../../utils/dates';

const W = 600;
const H = 140;
const PAD = 10;
const LINE = '#4446c8';

/**
 * Curva de peso de una mascota (lo pesado en cada atención). Sencilla: línea con puntos, el peso
 * más alto y más bajo a la izquierda, y para lectores de pantalla una tabla oculta con los datos.
 */
@Component({
  selector: 'app-weight-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex gap-2">
      <div
        class="flex w-12 shrink-0 flex-col justify-between py-0.5 text-right text-xs text-slate-500 tabular-nums"
        aria-hidden="true"
      >
        <span>{{ scale().max }} kg</span>
        <span>{{ scale().min }} kg</span>
      </div>
      <svg
        [attr.viewBox]="'0 0 ' + width + ' ' + height"
        preserveAspectRatio="none"
        class="h-32 min-w-0 flex-1 overflow-visible"
        role="img"
        [attr.aria-label]="summary()"
      >
        <line x1="0" [attr.x2]="width" y1="0.5" y2="0.5" stroke="#e2e8f0" />
        <line
          x1="0"
          [attr.x2]="width"
          [attr.y1]="height - 0.5"
          [attr.y2]="height - 0.5"
          stroke="#e2e8f0"
        />
        <polyline
          [attr.points]="path()"
          fill="none"
          [attr.stroke]="line"
          stroke-width="2.5"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
        @for (p of dots(); track $index) {
          <line
            [attr.x1]="p.x"
            [attr.x2]="p.x"
            [attr.y1]="p.y"
            [attr.y2]="p.y"
            [attr.stroke]="line"
            stroke-width="8"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        }
      </svg>
    </div>
    <div
      class="mt-1 flex justify-between pl-14 text-xs text-slate-500 tabular-nums"
      aria-hidden="true"
    >
      <span>{{ first() }}</span>
      <span>{{ last() }}</span>
    </div>
    <table class="sr-only">
      <caption>
        Pesos registrados
      </caption>
      <tr>
        <th scope="col">Fecha</th>
        <th scope="col">Peso</th>
      </tr>
      @for (p of points(); track $index) {
        <tr>
          <td>{{ date(p.at) }}</td>
          <td>{{ p.kg }} kg</td>
        </tr>
      }
    </table>
  `,
})
export class WeightChartComponent {
  readonly points = input.required<WeightPoint[]>();

  protected readonly width = W;
  protected readonly height = H;
  protected readonly line = LINE;

  /** Margen arriba y abajo para que la línea no toque los bordes */
  protected readonly scale = computed(() => {
    const kgs = this.points().map((p) => p.kg);
    const lo = Math.min(...kgs);
    const hi = Math.max(...kgs);
    const pad = Math.max((hi - lo) * 0.15, 0.1);
    return { min: round(Math.max(0, lo - pad)), max: round(hi + pad) };
  });

  /** Posición por fecha real (no por número de visita): se ve si pasó mucho tiempo */
  protected readonly dots = computed(() => {
    const pts = this.points();
    if (!pts.length) return [];
    const t0 = Date.parse(pts[0].at);
    const span = Math.max(Date.parse(pts.at(-1)!.at) - t0, 1);
    const { min, max } = this.scale();
    const range = Math.max(max - min, 0.01);
    return pts.map((p) => ({
      x: pts.length === 1 ? W / 2 : ((Date.parse(p.at) - t0) / span) * (W - 2 * PAD) + PAD,
      y: H - PAD - ((p.kg - min) / range) * (H - 2 * PAD),
    }));
  });
  protected readonly path = computed(() =>
    this.dots()
      .map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`)
      .join(' '),
  );

  protected readonly first = computed(() => this.date(this.points()[0]?.at));
  protected readonly last = computed(() => this.date(this.points().at(-1)?.at));
  protected readonly summary = computed(() => {
    const pts = this.points();
    if (!pts.length) return 'Sin pesos registrados';
    const a = pts[0];
    const b = pts.at(-1)!;
    return `Peso de ${a.kg} kg el ${this.date(a.at)} a ${b.kg} kg el ${this.date(b.at)}`;
  });

  protected date(at: string | undefined): string {
    return at ? formatDate(at, 'date') : '';
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
