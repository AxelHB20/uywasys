import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  GRAIN_LABELS,
  MarginReport,
  MarginRow,
  MarginSort,
  bucketLabels,
  categoryLabel,
  delta,
  quantityLabel,
  sortMargin,
} from '../../core/services/reports.models';
import { ReportsService } from '../../core/services/reports.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { injectReportPeriod } from './report-period';
import { ReportPeriodComponent } from './report-period.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ReportsHeaderComponent } from './reports-header.component';
import { EchartComponent } from './ui/echart.component';
import { COLORS, bars, profitMap } from './ui/report-charts';
import {
  ReportEmptyComponent,
  ReportErrorComponent,
  ReportSkeletonComponent,
} from './ui/report-states';
import {
  DeltaComponent,
  Insight,
  InsightsComponent,
  MoreLinkComponent,
  ReportCardComponent,
} from './ui/report-ui';

const COLUMNS: { key: MarginSort; label: string; align: 'left' | 'right' }[] = [
  { key: 'name', label: 'Nombre', align: 'left' },
  { key: 'revenue', label: 'Venta sin IGV', align: 'right' },
  { key: 'cost', label: 'Costo', align: 'right' },
  { key: 'margin', label: 'Margen', align: 'right' },
  { key: 'marginPercent', label: '% margen', align: 'right' },
];
/** Debajo de esto, el precio merece una revisión */
const LOW_MARGIN = 25;
const PAGE = 8;
const pct = (v: number | null) =>
  v === null ? '—' : `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(v)} %`;

/** Margen: lo que te deja cada venta después del costo de lo que salió del almacén. */
@Component({
  selector: 'app-margin-report-page',
  imports: [
    RouterLink,
    NgTemplateOutlet,
    ModalComponent,
    MoreLinkComponent,
    IconComponent,
    ReportsHeaderComponent,
    ReportPeriodComponent,
    EchartComponent,
    ReportCardComponent,
    DeltaComponent,
    InsightsComponent,
    ReportSkeletonComponent,
    ReportErrorComponent,
    ReportEmptyComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="@container space-y-5">
      <app-reports-header description="Lo que te deja cada venta después del costo" />
      <app-report-period
        [value]="period.state()"
        [today]="period.today"
        [previous]="report()?.previous ?? null"
        (choose)="period.set({ preset: $event })"
        (custom)="period.set($event)"
      />

      @if (res.error() && !report()) {
        <app-report-error [message]="errorText()" (retry)="res.reload()" />
      } @else if (!report()) {
        <app-report-skeleton label="Cargando el margen" />
      } @else {
        @let r = report()!;
        @let t = r.totals.all;
        <div
          class="space-y-4 transition-opacity"
          [class.opacity-60]="res.isLoading()"
          [attr.aria-busy]="res.isLoading()"
        >
          <ul
            class="grid grid-cols-2 gap-3 @4xl:grid-cols-[1fr_1fr_1.25fr_1fr]"
            aria-label="Totales"
          >
            <li
              class="card col-span-2 flex items-center justify-between gap-3 bg-gradient-to-b from-emerald-50 to-white p-4 ring-1 ring-emerald-200 @4xl:order-3 @4xl:col-span-1"
            >
              <div class="min-w-0">
                <span class="text-[13px] font-semibold text-slate-600">Margen bruto</span>
                <b
                  class="block font-display text-[24px] leading-tight font-semibold whitespace-nowrap text-emerald-700 tabular-nums"
                  >{{ money(t.margin) }}</b
                >
                <span class="text-xs text-slate-500">{{
                  t.marginPercent !== null ? 'de la venta con costo' : 'Sin ventas con costo'
                }}</span>
              </div>
              @if (t.marginPercent !== null) {
                <div class="shrink-0 text-right">
                  <b class="font-display text-xl font-semibold text-emerald-700 tabular-nums">{{
                    pct(t.marginPercent)
                  }}</b>
                  <span
                    class="mt-1 block h-1.5 w-16 overflow-hidden rounded-full bg-emerald-100"
                    aria-hidden="true"
                  >
                    <i
                      class="block h-full rounded-full bg-emerald-500"
                      [style.width.%]="t.marginPercent < 0 ? 0 : t.marginPercent"
                    ></i>
                  </span>
                </div>
              }
            </li>
            <li class="card min-w-0 p-4 @4xl:order-1">
              <span
                class="flex flex-wrap items-center justify-between gap-1 text-[13px] font-semibold text-slate-600"
                >Venta sin IGV <app-delta [now]="t.revenue" [before]="r.previousTotals.revenue"
              /></span>
              <b
                class="block font-display text-[22px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                >{{ money(t.revenue) }}</b
              >
              <span class="block text-xs text-slate-500"
                >Productos
                <span class="whitespace-nowrap">{{ money(r.totals.products.revenue) }}</span></span
              >
              <span class="block text-xs text-slate-500"
                >Servicios
                <span class="whitespace-nowrap">{{ money(r.totals.services.revenue) }}</span></span
              >
            </li>
            <li class="card min-w-0 p-4 @4xl:order-2">
              <span class="text-[13px] font-semibold text-slate-600">Costo de lo vendido</span>
              <b
                class="block font-display text-[22px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                >{{ money(t.cost) }}</b
              >
              <span class="text-xs text-slate-500">Productos e insumos, a costo del lote</span>
            </li>
            <li
              class="card col-span-2 min-w-0 p-4 @4xl:order-4 @4xl:col-span-1"
              [class.ring-1]="t.rowsWithoutCost"
              [class.ring-amber-300]="t.rowsWithoutCost"
            >
              <span class="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
                @if (t.rowsWithoutCost) {
                  <app-icon name="alert" class="size-3.5 text-amber-600" />
                }
                Sin costo registrado
              </span>
              <b
                class="block font-display text-[22px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                >{{ money(t.revenueWithoutCost) }}</b
              >
              <span class="text-xs text-slate-500">{{
                t.rowsWithoutCost
                  ? t.rowsWithoutCost + ' sin costo: no entran al margen'
                  : 'Todo lo vendido tiene costo'
              }}</span>
            </li>
          </ul>

          @if (!t.revenue) {
            <app-report-empty
              heading="Aún no hay ventas en este período"
              text="El margen aparece apenas se registran cargos."
              icon="trending-up"
            >
              <button
                type="button"
                class="btn btn-secondary"
                (click)="period.set({ preset: 'last30' })"
              >
                Ver últimos 30 días
              </button>
            </app-report-empty>
          } @else {
            <app-insights [items]="insights()" />

            <div class="grid gap-4 @4xl:grid-cols-[1.25fr_1fr]">
              <app-report-card
                [heading]="'Margen ' + grainLabel()"
                subtitle="Lo que te quedó en soles y qué parte de cada venta fue margen."
              >
                @if (r.grain !== 'hour') {
                  <ul
                    card-actions
                    class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600"
                    aria-label="Leyenda"
                  >
                    <li class="inline-flex items-center gap-1.5">
                      <i
                        class="size-2.5 rounded-sm"
                        [style.background]="colors.green"
                        aria-hidden="true"
                      ></i
                      >Margen en S/
                    </li>
                    <li class="inline-flex items-center gap-1.5">
                      <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
                        <path d="M0 4h18" [attr.stroke]="colors.ink" stroke-width="2" />
                        <circle
                          cx="9"
                          cy="4"
                          r="3"
                          fill="#fff"
                          [attr.stroke]="colors.ink"
                          stroke-width="1.6"
                        />
                      </svg>
                      % de margen
                    </li>
                  </ul>
                }
                @if (r.grain === 'hour') {
                  <p class="font-display text-[28px] font-semibold text-emerald-700 tabular-nums">
                    {{ money(t.margin) }}
                  </p>
                  <p class="text-sm text-slate-600">
                    {{ pct(t.marginPercent) }} de {{ money(t.revenue) }} vendidos sin IGV.
                  </p>
                  <p class="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                    Con un solo día no se dibuja tendencia: aparece desde 7 días.
                  </p>
                } @else {
                  <app-echart
                    [option]="seriesOption()"
                    [label]="'Margen ' + grainLabel() + ' en soles y en porcentaje'"
                    [height]="230"
                  />
                }
              </app-report-card>
              <app-report-card
                heading="Servicios y productos"
                subtitle="Cuánto de cada venta es costo y cuánto te queda."
              >
                @for (s of split(); track s.label) {
                  <div class="py-2">
                    <div class="flex items-baseline justify-between text-sm">
                      <b class="font-semibold text-slate-900">{{ s.label }}</b>
                      <span class="text-slate-600"
                        >venta
                        <span class="whitespace-nowrap tabular-nums">{{
                          money(s.revenue)
                        }}</span></span
                      >
                    </div>
                    <div
                      class="mt-2 flex h-6 gap-0.5 overflow-hidden rounded-lg"
                      role="img"
                      [attr.aria-label]="s.label + ': margen ' + pct(s.percent)"
                    >
                      <span
                        class="flex items-center px-2 text-xs font-semibold whitespace-nowrap text-white"
                        [style.flex]="s.margin > 0 ? s.margin : 0.0001"
                        [style.background]="s.color"
                      >
                        {{
                          s.percent !== null && s.percent >= 18 ? 'margen ' + pct(s.percent) : ''
                        }}
                      </span>
                      <span class="bg-slate-300" [style.flex]="s.cost || 0.0001"></span>
                    </div>
                    <div class="mt-1.5 flex justify-between text-xs text-slate-500">
                      <span
                        >Te quedó
                        <b class="whitespace-nowrap text-emerald-700 tabular-nums">{{
                          money(s.margin)
                        }}</b></span
                      >
                      <span
                        >Costo
                        <b class="whitespace-nowrap text-slate-700 tabular-nums">{{
                          money(s.cost)
                        }}</b></span
                      >
                    </div>
                  </div>
                }
                <p class="mt-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  El costo de un servicio son sus insumos (jeringas, vacunas, champú) a costo del
                  lote; no incluye la mano de obra.
                </p>
              </app-report-card>
            </div>

            <div class="grid gap-4 @4xl:grid-cols-2">
              <app-report-card
                heading="Mapa de rentabilidad"
                subtitle="Cada punto es un servicio o producto: a la derecha vende más, arriba deja más. Tamaño = veces vendido."
              >
                @if (bubbles().length > 1) {
                  <app-echart
                    [option]="mapOption()"
                    label="Servicios y productos según su venta y su porcentaje de margen"
                    [height]="320"
                  />
                  <ul class="mt-2 grid grid-cols-2 gap-2 text-xs @lg:grid-cols-4">
                    @for (q of quadrants(); track q.label) {
                      <li class="rounded-xl px-2.5 py-2" [class]="q.tone">
                        <b class="block">{{ q.label }}</b
                        >{{ q.count }} · {{ q.hint }}
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-sm text-slate-500">
                    Hace falta más de un servicio o producto con costo para armar el mapa.
                  </p>
                }
              </app-report-card>
              <app-report-card
                heading="Margen por categoría"
                [subtitle]="'% que te queda en cada categoría. En rojo, menos de ' + low + ' %.'"
              >
                <ng-container
                  *ngTemplateOutlet="catList; context: { $implicit: byCategory().slice(0, 8) }"
                />
                @if (byCategory().length > 8) {
                  <app-more-link
                    [text]="'Ver las ' + byCategory().length + ' categorías'"
                    (pressed)="modal.set('categories')"
                  />
                }
              </app-report-card>
            </div>

            <div class="grid gap-4 @4xl:grid-cols-[1.25fr_1fr]">
              <app-report-card
                heading="Revisa estos precios"
                [subtitle]="
                  'Se venden a pérdida o dejan menos de ' +
                  low +
                  ' %. Toca uno para cambiar el precio.'
                "
              >
                @if (review().length) {
                  <ul class="divide-y divide-slate-100">
                    @for (x of review(); track x.key) {
                      <li>
                        <a
                          [routerLink]="x.link"
                          class="flex items-center gap-3 py-2.5 hover:bg-slate-50"
                        >
                          <span
                            class="grid size-9 shrink-0 place-items-center rounded-xl"
                            [class]="
                              x.loss ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700'
                            "
                            aria-hidden="true"
                          >
                            <app-icon name="alert" class="size-4" />
                          </span>
                          <span class="min-w-0 flex-1">
                            <b
                              class="line-clamp-2 text-sm font-medium text-slate-900"
                              [title]="x.name"
                              >{{ x.name }}</b
                            >
                            <span class="block text-xs text-slate-500">{{ x.detail }}</span>
                          </span>
                          <span class="shrink-0 text-right">
                            <b
                              class="block text-sm font-semibold whitespace-nowrap tabular-nums"
                              [class]="x.loss ? 'text-rose-700' : 'text-amber-800'"
                              >{{ pct(x.percent) }}</b
                            >
                            <span class="text-xs text-slate-500">{{
                              x.loss ? 'pérdida' : 'margen bajo'
                            }}</span>
                          </span>
                        </a>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="flex items-center gap-2 text-sm text-emerald-700">
                    <app-icon name="check" class="size-4" /> Todo deja al menos {{ low }} %.
                  </p>
                }
              </app-report-card>
              <app-report-card
                heading="Sin costo registrado"
                subtitle="Lo vendido sin costo no entra al margen; si fuera mucho, el margen engaña."
              >
                @if (withoutCost().length) {
                  <ng-container
                    *ngTemplateOutlet="costList; context: { $implicit: withoutCost().slice(0, 5) }"
                  />
                  @if (withoutCost().length > 5) {
                    <app-more-link
                      [text]="'Ver los ' + withoutCost().length"
                      (pressed)="modal.set('withoutCost')"
                    />
                  }
                  <p class="mt-2 text-xs text-slate-500">
                    Registra el costo en la compra del lote o en el producto.
                  </p>
                } @else {
                  <p
                    class="flex items-start gap-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800"
                  >
                    <app-icon name="check" class="mt-0.5 size-4 shrink-0" />
                    <span
                      ><b class="block">Todo tiene costo</b>Los servicios sin insumos (como la
                      consulta) tienen costo S/ 0 y margen 100 %: es correcto.</span
                    >
                  </p>
                }
                @if (r.discounts > 0) {
                  <div
                    class="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4"
                  >
                    <span class="text-sm"
                      ><b class="block font-semibold text-slate-900"
                        >Sin descuentos habrías dejado</b
                      ><span class="text-xs text-slate-500"
                        >Se descontó {{ money(r.discounts) }} (ver Control)</span
                      ></span
                    >
                    <b
                      class="font-display text-lg font-semibold whitespace-nowrap text-emerald-700 tabular-nums"
                      >{{ money(withoutDiscounts()) }}</b
                    >
                  </div>
                }
              </app-report-card>
            </div>

            <!-- Detalle -->
            <app-report-card
              heading="Detalle"
              subtitle="Ordena por cualquier columna. Busca por nombre."
            >
              <span
                card-actions
                role="group"
                aria-label="Ver"
                class="inline-flex rounded-xl bg-slate-100 p-0.5 text-sm"
              >
                @for (tb of tabs; track tb.key) {
                  <button
                    type="button"
                    class="min-h-9 rounded-lg px-3"
                    [class]="
                      tab() === tb.key
                        ? 'bg-white font-semibold text-slate-900 shadow-sm'
                        : 'text-slate-600'
                    "
                    [attr.aria-pressed]="tab() === tb.key"
                    (click)="setTab(tb.key)"
                  >
                    {{ tb.label }}
                    {{ tb.key === 'services' ? r.services.length : r.products.length }}
                  </button>
                }
              </span>
              <div class="mb-3 flex flex-wrap items-center gap-3">
                <label class="relative min-w-0 flex-1 @lg:max-w-sm">
                  <span class="sr-only">Buscar por nombre</span>
                  <app-icon
                    name="search"
                    class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    class="field-input pl-9"
                    placeholder="Buscar servicio o producto"
                    [value]="query()"
                    (input)="setQuery($any($event.target).value)"
                  />
                </label>
              </div>
              @if (!visibleRows().length) {
                <p class="py-6 text-center text-sm text-slate-500">
                  Nada coincide con “{{ query() }}”.
                </p>
              } @else {
                <!-- Tarjeta ancha: tabla -->
                <table class="hidden w-full text-sm @2xl:table">
                  <caption class="sr-only">
                    Margen por
                    {{
                      tab() === 'services' ? 'servicio' : 'producto'
                    }}
                  </caption>
                  <thead>
                    <tr class="border-b border-slate-200">
                      @for (c of columns; track c.key) {
                        <th
                          scope="col"
                          class="py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"
                          [class.text-right]="c.align === 'right'"
                          [class.text-left]="c.align === 'left'"
                          [class.pl-3]="c.key !== 'name'"
                          [attr.aria-sort]="
                            sort() === c.key ? (desc() ? 'descending' : 'ascending') : 'none'
                          "
                        >
                          <button
                            type="button"
                            class="inline-flex min-h-8 items-center gap-1 uppercase hover:text-slate-900"
                            (click)="sortBy(c.key)"
                          >
                            {{ c.label }}
                            @if (sort() === c.key) {
                              <app-icon
                                [name]="desc() ? 'chevron-down' : 'chevron-up'"
                                class="size-3.5"
                              />
                            }
                          </button>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of visibleRows(); track row.kind + row.id + row.name) {
                      <tr class="border-b border-slate-100">
                        <td class="py-2.5">
                          <span
                            class="line-clamp-2 font-medium text-slate-900"
                            [title]="row.name"
                            >{{ row.name }}</span
                          >
                          <span class="text-xs text-slate-500">{{ meta(row) }}</span>
                        </td>
                        <td class="py-2.5 pl-3 text-right whitespace-nowrap tabular-nums">
                          {{ money(row.revenue) }}
                        </td>
                        <td
                          class="py-2.5 pl-3 text-right whitespace-nowrap text-slate-600 tabular-nums"
                        >
                          {{ row.cost === null ? 'Sin costo' : money(row.cost) }}
                        </td>
                        <td
                          class="py-2.5 pl-3 text-right font-semibold whitespace-nowrap tabular-nums"
                          [class.text-rose-700]="(row.margin ?? 0) < 0"
                        >
                          {{ money(row.margin) }}
                        </td>
                        <td class="py-2.5 pl-3">
                          <span class="flex items-center justify-end gap-2">
                            <span
                              class="hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 @4xl:block"
                              aria-hidden="true"
                            >
                              <i
                                class="block h-full rounded-full"
                                [style.width.%]="barPct(row.marginPercent)"
                                [style.background]="
                                  (row.marginPercent ?? 0) < 0 ? colors.red : colors.green
                                "
                              ></i>
                            </span>
                            <b
                              class="w-16 text-right font-semibold whitespace-nowrap tabular-nums"
                              [class.text-rose-700]="(row.marginPercent ?? 0) < 0"
                              >{{ pct(row.marginPercent) }}</b
                            >
                          </span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
                <!-- Tarjeta angosta: filas de 2 líneas, el % bajo el margen -->
                <ul class="divide-y divide-slate-100 @2xl:hidden">
                  <li
                    class="flex items-center justify-between pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"
                  >
                    <span>Nombre</span>
                    <button
                      type="button"
                      class="inline-flex min-h-8 items-center gap-1 uppercase"
                      (click)="sortBy('margin')"
                    >
                      Margen
                      <app-icon [name]="desc() ? 'chevron-down' : 'chevron-up'" class="size-3.5" />
                    </button>
                  </li>
                  @for (row of visibleRows(); track row.kind + row.id + row.name) {
                    <li class="flex justify-between gap-3 py-2.5">
                      <span class="min-w-0">
                        <b class="line-clamp-2 text-sm font-medium text-slate-900">{{
                          row.name
                        }}</b>
                        <span class="text-xs text-slate-500"
                          >{{ meta(row) }} ·
                          <span class="whitespace-nowrap">{{ money(row.revenue) }}</span></span
                        >
                      </span>
                      <span class="shrink-0 text-right">
                        <b
                          class="block text-sm font-semibold whitespace-nowrap tabular-nums"
                          [class.text-rose-700]="(row.margin ?? 0) < 0"
                          >{{ row.margin === null ? 'Sin costo' : money(row.margin) }}</b
                        >
                        <span
                          class="text-xs whitespace-nowrap tabular-nums"
                          [class]="
                            (row.marginPercent ?? 0) < 0 ? 'text-rose-700' : 'text-emerald-700'
                          "
                          >{{ pct(row.marginPercent)
                          }}{{ (row.marginPercent ?? 0) < 0 ? ' · pérdida' : '' }}</span
                        >
                      </span>
                    </li>
                  }
                </ul>
                @if (remaining() > 0) {
                  <div class="mt-1 border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      class="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-anil-700 hover:underline"
                      (click)="showAll.set(true)"
                    >
                      Ver los {{ remaining() }} restantes
                      <app-icon name="chevron-right" class="size-4" />
                    </button>
                  </div>
                }
              }
            </app-report-card>
          }
        </div>
      }
    </div>
    <app-modal
      [open]="modal() !== null"
      [title]="modal() === 'categories' ? 'Margen por categoría' : 'Vendido sin costo registrado'"
      size="lg"
      (closed)="modal.set(null)"
    >
      @if (modal() === 'categories') {
        <ng-container *ngTemplateOutlet="catList; context: { $implicit: byCategory() }" />
      } @else if (modal() === 'withoutCost') {
        <ng-container *ngTemplateOutlet="costList; context: { $implicit: withoutCost() }" />
      }
    </app-modal>
    <ng-template #catList let-rows>
      <ul class="divide-y divide-slate-100">
        @for (c of rows; track c.key) {
          <li
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 @md:grid-cols-[minmax(6rem,9rem)_minmax(3rem,1fr)_auto_auto]"
          >
            <span class="truncate text-sm font-medium text-slate-900" [title]="c.label">{{
              c.label
            }}</span>
            <span
              class="order-3 col-span-2 mt-1 block h-2 overflow-hidden rounded-full bg-slate-100 @md:order-none @md:col-span-1 @md:mt-0"
              aria-hidden="true"
            >
              <i
                class="block h-full rounded-full"
                [style.width.%]="c.percent === null || c.percent < 0 ? 2 : c.percent"
                [style.background]="c.color"
              ></i>
            </span>
            <b
              class="text-right text-sm font-semibold whitespace-nowrap tabular-nums"
              [class.text-rose-700]="c.percent !== null && c.percent < low"
              >{{ pct(c.percent) }}</b
            >
            <span
              class="hidden text-right text-xs whitespace-nowrap text-slate-500 tabular-nums @md:block"
              >{{ money(c.margin) }}</span
            >
          </li>
        }
      </ul>
    </ng-template>
    <ng-template #costList let-rows>
      <ul class="divide-y divide-slate-100">
        @for (x of rows; track x.key) {
          <li class="flex items-center justify-between gap-3 py-2 text-sm">
            <a
              [routerLink]="x.link"
              class="min-w-0 truncate font-medium text-anil-700 hover:underline"
              >{{ x.name }}</a
            >
            <span class="whitespace-nowrap text-slate-600 tabular-nums">{{
              money(x.revenue)
            }}</span>
          </li>
        }
      </ul>
    </ng-template>
  `,
})
export class MarginReportPage {
  private readonly api = inject(ReportsService);
  protected readonly period = injectReportPeriod();
  protected readonly money = money;
  protected readonly pct = pct;
  protected readonly low = LOW_MARGIN;
  protected readonly colors = COLORS;
  protected readonly modal = signal<'categories' | 'withoutCost' | null>(null);
  protected readonly columns = COLUMNS;
  protected readonly tabs = [
    { key: 'services' as const, label: 'Servicios' },
    { key: 'products' as const, label: 'Productos' },
  ];

  protected readonly tab = signal<'services' | 'products'>('services');
  protected readonly sort = signal<MarginSort>('margin');
  protected readonly desc = signal(true);
  protected readonly query = signal('');
  protected readonly showAll = signal(false);

  protected readonly res = rxResource({
    params: () => ({ from: this.period.state().from, to: this.period.state().to }),
    stream: ({ params }) => this.api.margin(params.from, params.to),
  });
  protected readonly report = linkedSignal<MarginReport | undefined, MarginReport | null>({
    source: () => (this.res.hasValue() ? this.res.value() : undefined),
    computation: (v, prev) => v ?? prev?.value ?? null,
  });
  protected readonly errorText = computed(() =>
    apiErrorMessage(this.res.error(), 'Revisa tu conexión e inténtalo de nuevo.'),
  );
  protected readonly grainLabel = computed(() => GRAIN_LABELS[this.report()?.grain ?? 'day']);
  private readonly allRows = computed(() => {
    const r = this.report();
    return r ? [...r.services, ...r.products] : [];
  });

  protected readonly seriesOption = computed(() => {
    const r = this.report();
    if (!r) return {};
    const manyYears = r.from.slice(0, 4) !== r.to.slice(0, 4);
    const labels = r.series.map((s) => bucketLabels(r.grain, s, manyYears));
    return bars(
      labels.map((l) => l.label),
      [{ name: 'Margen en S/', data: r.series.map((s) => s.margin), color: COLORS.green }],
      {
        titles: labels.map((l) => l.title),
        line: {
          name: '% margen',
          data: r.series.map((s) => s.marginPercent),
          color: COLORS.ink,
          format: (v) => `${Math.round(v)} %`,
          max: 100,
        },
      },
    );
  });

  protected readonly split = computed(() => {
    const r = this.report();
    if (!r) return [];
    return [
      // Verde oscuro en los dos: el texto blanco encima se lee (contraste 5.5:1)
      { label: 'Servicios', t: r.totals.services, color: '#047857' },
      { label: 'Productos', t: r.totals.products, color: '#047857' },
    ]
      .filter((x) => x.t.revenue > 0)
      .map((x) => ({
        label: x.label,
        revenue: x.t.revenue,
        cost: x.t.cost,
        margin: x.t.margin,
        percent: x.t.marginPercent,
        color: x.color,
      }));
  });

  protected readonly bubbles = computed(() =>
    this.allRows()
      .filter((r) => r.marginPercent !== null && r.revenue > 0)
      .map((r) => ({
        name: r.name,
        revenue: r.revenue,
        percent: r.marginPercent as number,
        times: r.quantity,
        product: r.kind === 'PRODUCT',
      })),
  );
  protected readonly mapOption = computed(() => profitMap(this.bubbles(), 4));
  protected readonly quadrants = computed(() => {
    const list = this.bubbles();
    const sorted = [...list].sort((a, b) => a.revenue - b.revenue);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].revenue : 0;
    const count = (up: boolean, right: boolean) =>
      list.filter((p) => p.percent >= 50 === up && p.revenue >= median === right).length;
    return [
      {
        label: 'Estrellas',
        count: count(true, true),
        hint: 'venden y dejan',
        tone: 'bg-emerald-50 text-emerald-800',
      },
      {
        label: 'Joyas',
        count: count(true, false),
        hint: 'dejan, venden poco',
        tone: 'bg-slate-100 text-slate-700',
      },
      {
        label: 'Revisa el precio',
        count: count(false, true),
        hint: 'venden, dejan poco',
        tone: 'bg-orange-50 text-orange-800',
      },
      {
        label: 'Poco aporte',
        count: count(false, false),
        hint: 'ni venden ni dejan',
        tone: 'bg-rose-50 text-rose-800',
      },
    ];
  });

  protected readonly byCategory = computed(() => {
    const map = new Map<string, { key: string; label: string; revenue: number; margin: number }>();
    for (const r of this.allRows()) {
      if (r.margin === null) continue;
      const key = `${r.kind}-${r.category}`;
      const row = map.get(key) ?? {
        key,
        label: categoryLabel(r.kind, r.category),
        revenue: 0,
        margin: 0,
      };
      row.revenue += r.revenue;
      row.margin += r.margin;
      map.set(key, row);
    }
    return [...map.values()]
      .map((c) => {
        const percent = c.revenue > 0 ? Math.round((c.margin / c.revenue) * 1000) / 10 : null;
        return {
          ...c,
          margin: Math.round(c.margin * 100) / 100,
          percent,
          color:
            percent === null || percent < LOW_MARGIN
              ? COLORS.red
              : percent < 60
                ? COLORS.product
                : COLORS.green,
        };
      })
      .sort((a, b) => b.margin - a.margin);
  });

  private linkOf(r: MarginRow): unknown[] {
    return r.kind === 'PRODUCT' && r.id ? ['/inventario', r.id] : ['/servicios'];
  }

  protected readonly review = computed(() =>
    this.allRows()
      .filter((r) => r.marginPercent !== null && r.marginPercent < LOW_MARGIN && r.quantity > 0)
      .sort((a, b) => (a.marginPercent as number) - (b.marginPercent as number))
      .slice(0, 5)
      .map((r) => {
        const unitPrice = r.revenue / r.quantity;
        const unitCost = (r.cost ?? 0) / r.quantity;
        return {
          key: `${r.kind}-${r.id}-${r.name}`,
          name: r.name,
          percent: r.marginPercent,
          loss: (r.marginPercent as number) < 0,
          detail: `Sale a ${money(unitPrice)} sin IGV · cuesta ${money(unitCost)}`,
          link: this.linkOf(r),
        };
      }),
  );

  protected readonly withoutCost = computed(() =>
    this.allRows()
      .filter((r) => r.cost === null)
      .map((r) => ({
        key: `${r.kind}-${r.id}-${r.name}`,
        name: r.name,
        revenue: r.revenue,
        link: this.linkOf(r),
      })),
  );
  /** Margen + descuentos sin IGV (los descuentos vienen con IGV) */
  protected readonly withoutDiscounts = computed(() => {
    const r = this.report();
    return r ? Math.round((r.totals.all.margin + r.discounts / 1.18) * 100) / 100 : 0;
  });

  private readonly filtered = computed(() => {
    const r = this.report();
    if (!r) return [];
    const q = this.query().trim().toLocaleLowerCase('es');
    const rows = this.tab() === 'services' ? r.services : r.products;
    const list = q ? rows.filter((x) => x.name.toLocaleLowerCase('es').includes(q)) : rows;
    return sortMargin(list, this.sort(), this.desc());
  });
  protected readonly visibleRows = computed(() =>
    this.showAll() || this.query() ? this.filtered() : this.filtered().slice(0, PAGE),
  );
  protected readonly remaining = computed(() => this.filtered().length - this.visibleRows().length);

  protected readonly insights = computed<Insight[]>(() => {
    const r = this.report();
    if (!r) return [];
    const t = r.totals.all;
    const out: Insight[] = [];
    if (t.marginPercent !== null)
      out.push({
        key: 'per100',
        icon: 'percent',
        tone: 'up',
        parts: [
          'De cada ',
          'S/ 100',
          ' vendidos sin IGV te quedan ',
          `S/ ${Math.round(t.marginPercent)}`,
          '.',
        ],
      });
    const worst = this.review()[0];
    if (worst)
      out.push({
        key: 'worst',
        icon: 'alert',
        tone: worst.loss ? 'down' : 'warning',
        parts: [
          '',
          worst.name,
          worst.loss
            ? ' se vende a pérdida.'
            : ` deja solo ${pct(worst.percent)}: revisa el precio.`,
        ],
      });
    if (r.discounts > 0)
      out.push({
        key: 'disc',
        icon: 'tag',
        tone: 'neutral',
        parts: ['Los descuentos te restaron ', money(r.discounts), '.'],
      });
    const d = delta(t.margin, r.previousTotals.margin);
    if (d.percent !== null && d.trend !== 'flat')
      out.push({
        key: 'trend',
        icon: d.trend === 'up' ? 'trending-up' : 'trending-down',
        tone: d.trend === 'up' ? 'up' : 'down',
        parts: [
          'Tu margen ',
          `${d.trend === 'up' ? 'subió' : 'bajó'} ${Math.abs(d.percent)} %`,
          ' contra el período anterior.',
        ],
      });
    return out.slice(0, 4);
  });

  protected meta(row: MarginRow): string {
    return quantityLabel(row);
  }
  protected barPct(v: number | null): number {
    if (v === null) return 0;
    return Math.max(4, Math.min(100, Math.abs(v)));
  }
  protected setTab(tab: 'services' | 'products'): void {
    this.tab.set(tab);
    this.showAll.set(false);
  }
  protected setQuery(q: string): void {
    this.query.set(q);
  }
  protected sortBy(key: MarginSort): void {
    if (this.sort() === key) this.desc.update((d) => !d);
    else {
      this.sort.set(key);
      this.desc.set(key !== 'name');
    }
  }
}
