import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Delta, delta } from '../../../core/services/reports.models';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { IconName } from '../../../shared/ui/icon/icons';

let cardSeq = 0;

/**
 * Tarjeta de una sección del reporte. Es un contenedor (container query): lo de adentro se
 * acomoda al ancho de la tarjeta, no al de la pantalla.
 */
@Component({
  selector: 'app-report-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <section class="card @container relative h-full p-4 sm:p-5" [attr.aria-labelledby]="id">
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div class="min-w-0 flex-1">
          <h2 [id]="id" class="font-display text-base font-semibold text-slate-900">
            {{ heading() }}
          </h2>
          @if (subtitle()) {
            <p class="mt-0.5 text-sm leading-snug text-slate-500">{{ subtitle() }}</p>
          }
        </div>
        <ng-content select="[card-actions]" />
      </div>
      <div class="mt-4"><ng-content /></div>
    </section>
  `,
})
export class ReportCardComponent {
  readonly heading = input.required<string>();
  readonly subtitle = input('');
  protected readonly id = `rc-${++cardSeq}`;
}

/** Variación contra el período anterior. `good` dice si subir es bueno (ventas) o malo (descuentos). */
@Component({
  selector: 'app-delta',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    @let d = value();
    @if (d.percent === null) {
      @if (!quiet()) {
        <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
          >Sin datos antes</span
        >
      }
    } @else {
      <span
        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
        [class]="tone()"
      >
        <app-icon [name]="icon()" class="size-3.5" />
        <span class="sr-only">{{
          d.trend === 'up' ? 'Sube' : d.trend === 'down' ? 'Baja' : 'Igual'
        }}</span>
        {{ d.trend === 'flat' ? 'Igual' : abs(d.percent) + ' %' }}
      </span>
    }
  `,
})
export class DeltaComponent {
  readonly now = input.required<number>();
  readonly before = input.required<number>();
  readonly good = input<'up' | 'down'>('up');
  /** Si el período anterior entero está vacío, la página lo dice una vez y aquí no se repite */
  readonly quiet = input(false);
  protected readonly value = computed<Delta>(() => delta(this.now(), this.before()));
  protected readonly abs = Math.abs;
  protected readonly icon = computed<IconName>(() =>
    this.value().trend === 'up'
      ? 'trending-up'
      : this.value().trend === 'down'
        ? 'trending-down'
        : 'minus',
  );
  protected readonly tone = computed(() => {
    const t = this.value().trend;
    if (t === 'flat') return 'bg-slate-100 text-slate-600';
    const good = (t === 'up') === (this.good() === 'up');
    return good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
  });
}

/** Línea simple para los indicadores (sin ejes): solo la forma de la tendencia */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    <svg class="h-full w-full overflow-visible" viewBox="0 0 100 30" preserveAspectRatio="none">
      <path [attr.d]="area()" [attr.fill]="color()" fill-opacity="0.1" />
      <path
        [attr.d]="line()"
        fill="none"
        [attr.stroke]="color()"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        stroke-linejoin="round"
      />
    </svg>
  `,
})
export class SparklineComponent {
  readonly values = input.required<number[]>();
  readonly color = input('#4446c8');
  private readonly pts = computed(() => {
    const v = this.values();
    if (v.length < 2) return [] as [number, number][];
    const max = Math.max(...v);
    const min = Math.min(...v, 0);
    const span = max - min || 1;
    return v.map(
      (y, i) => [(i / (v.length - 1)) * 100, 28 - ((y - min) / span) * 26] as [number, number],
    );
  });
  protected readonly line = computed(() =>
    this.pts()
      .map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`)
      .join(' '),
  );
  protected readonly area = computed(() =>
    this.pts().length ? `${this.line()} L100,30 L0,30 Z` : '',
  );
}

export interface RankItem {
  key: string | number;
  /** Lo que va a la izquierda: número de puesto, iniciales en círculo o ícono */
  lead?: { rank?: number; initials?: string; color?: string; icon?: IconName };
  name: string;
  sub?: string;
  /** 0–100: largo de la barra */
  pct: number;
  value: string;
  valueTone?: 'danger' | 'muted';
  link?: string | unknown[];
}

/**
 * Ranking con barra (Equipo, Lo más vendido, Productos con más valor…). En una tarjeta angosta la
 * barra baja debajo del nombre y el monto queda entero; el nombre usa hasta 2 líneas.
 */
@Component({
  selector: 'app-rank-list',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block @container' },
  template: `
    <ol
      class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 divide-y divide-slate-100 @md:grid-cols-[auto_minmax(0,1fr)_minmax(3rem,6.5rem)_auto]"
    >
      @for (item of items(); track item.key; let i = $index) {
        <li class="col-span-full grid grid-cols-subgrid items-center py-2.5">
          @if (item.lead; as lead) {
            @if (lead.initials) {
              <span
                class="grid size-9 place-items-center rounded-full text-xs font-semibold text-white"
                [style.background]="lead.color || '#4446c8'"
                aria-hidden="true"
                >{{ lead.initials }}</span
              >
            } @else if (lead.icon) {
              <span
                class="grid size-9 place-items-center rounded-xl bg-anil-50 text-anil-700"
                aria-hidden="true"
              >
                <app-icon [name]="lead.icon" class="size-4" />
              </span>
            } @else {
              <span
                class="w-5 text-xs font-semibold tabular-nums"
                [class]="i < 3 ? 'text-anil-600' : 'text-slate-500'"
                >{{ lead.rank ?? i + 1 }}</span
              >
            }
          } @else {
            <span></span>
          }
          <span class="min-w-0">
            @if (item.link) {
              <a
                [routerLink]="item.link"
                class="line-clamp-2 text-sm font-medium text-slate-900 hover:text-anil-700 hover:underline"
                [title]="item.name"
                >{{ item.name }}</a
              >
            } @else {
              <span class="line-clamp-2 text-sm font-medium text-slate-900" [title]="item.name">{{
                item.name
              }}</span>
            }
            @if (item.sub) {
              <span class="block text-xs text-slate-500">{{ item.sub }}</span>
            }
            <span
              class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-100 @md:hidden"
              aria-hidden="true"
            >
              <span
                class="block h-full rounded-full bg-anil-600"
                [style.width.%]="clamp(item.pct)"
              ></span>
            </span>
          </span>
          <span
            class="hidden h-1.5 overflow-hidden rounded-full bg-slate-100 @md:block"
            aria-hidden="true"
          >
            <span
              class="block h-full rounded-full bg-anil-600"
              [style.width.%]="clamp(item.pct)"
            ></span>
          </span>
          <span
            class="text-right text-sm font-semibold whitespace-nowrap tabular-nums"
            [class]="
              item.valueTone === 'danger'
                ? 'text-rose-700'
                : item.valueTone === 'muted'
                  ? 'text-slate-500'
                  : 'text-slate-900'
            "
            >{{ item.value }}</span
          >
        </li>
      }
    </ol>
  `,
})
export class RankListComponent {
  readonly items = input.required<RankItem[]>();
  protected readonly clamp = (n: number) => Math.max(2, Math.min(100, n));
}

export interface BarItem {
  key: string;
  label: string;
  sub?: string;
  value: string;
  pct: number;
  color: string;
  danger?: boolean;
}

/** Barras horizontales con nombre arriba y monto a la derecha (Por categoría, mermas…) */
@Component({
  selector: 'app-hbars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ul class="space-y-3">
      @for (b of items(); track b.key) {
        <li>
          <div class="flex items-baseline justify-between gap-3 text-sm">
            <span class="min-w-0 font-medium text-slate-900"
              >{{ b.label }}
              @if (b.sub) {
                <span class="ml-1 text-xs font-normal text-slate-500">{{ b.sub }}</span>
              }
            </span>
            <b
              class="font-semibold whitespace-nowrap tabular-nums"
              [class]="b.danger ? 'text-rose-700' : 'text-slate-900'"
              >{{ b.value }}</b
            >
          </div>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div
              class="h-full rounded-full"
              [style.width.%]="b.pct < 1.5 ? 1.5 : b.pct"
              [style.background]="b.color"
            ></div>
          </div>
        </li>
      }
    </ul>
  `,
})
export class HBarsComponent {
  readonly items = input.required<BarItem[]>();
}

/** “Ver los N restantes”: abre la lista completa (en un modal) o lleva a otra pantalla */
@Component({
  selector: 'app-more-link',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-1 block border-t border-slate-100 pt-2' },
  template: `
    @if (link()) {
      <a
        [routerLink]="link()"
        [queryParams]="query()"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-anil-700 hover:underline"
      >
        {{ text() }} <app-icon name="chevron-right" class="size-4" />
      </a>
    } @else {
      <button
        type="button"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-anil-700 hover:underline"
        (click)="pressed.emit()"
      >
        {{ text() }} <app-icon name="chevron-right" class="size-4" />
      </button>
    }
  `,
})
export class MoreLinkComponent {
  readonly text = input.required<string>();
  readonly link = input<string | unknown[] | null>(null);
  readonly query = input<Record<string, string> | null>(null);
  readonly pressed = output<void>();
}

export interface Insight {
  key: string;
  icon: IconName;
  tone: 'up' | 'down' | 'neutral' | 'warning';
  /** Texto con partes en negrita: [normal, negrita, normal, …] */
  parts: string[];
}

const TONES: Record<Insight['tone'], string> = {
  up: 'bg-emerald-50 text-emerald-700',
  down: 'bg-rose-50 text-rose-700',
  neutral: 'bg-anil-50 text-anil-700',
  warning: 'bg-amber-50 text-amber-800',
};

/** “En resumen”: 3 o 4 frases con lo importante, sin tener que leer los gráficos */
@Component({
  selector: 'app-insights',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block @container' },
  template: `
    @if (items().length) {
      <section
        class="card bg-gradient-to-r from-white to-anil-50/60 p-4 sm:px-5"
        aria-labelledby="ins-title"
      >
        <h2
          id="ins-title"
          class="flex items-center gap-2 font-display text-[13px] font-semibold text-anil-700"
        >
          <app-icon name="trending-up" class="size-4" /> En resumen
        </h2>
        <ul class="mt-3 grid gap-x-5 gap-y-3 @2xl:grid-cols-2 @6xl:grid-cols-4">
          @for (it of items(); track it.key) {
            <li class="flex items-start gap-3">
              <span
                class="grid size-9 shrink-0 place-items-center rounded-xl"
                [class]="tones[it.tone]"
                aria-hidden="true"
              >
                <app-icon [name]="it.icon" class="size-[18px]" />
              </span>
              <!-- prettier-ignore -->
              <p class="text-sm leading-relaxed text-slate-700">@for (part of it.parts; track $index; let odd = $odd) {@if (odd) {<b class="font-semibold text-slate-900">{{ part }}</b>} @else {{{ part }}}}</p>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class InsightsComponent {
  readonly items = input.required<Insight[]>();
  protected readonly tones = TONES;
}
