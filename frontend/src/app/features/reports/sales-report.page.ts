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
import { ROLE_LABELS } from '../../core/auth/auth.models';
import { METHOD_LABELS } from '../../core/services/cash.models';
import {
  GRAIN_LABELS,
  SPECIES_PLURAL,
  SalesReport,
  TRANSPORT_LABELS,
  bucketize,
  categoryLabel,
  compactMoney,
  kpiMoney,
  delta,
  monthLabel,
  quantityLabel,
} from '../../core/services/reports.models';
import { ReportsService } from '../../core/services/reports.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { initials } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { injectReportPeriod } from './report-period';
import { ReportPeriodComponent } from './report-period.component';
import { ReportsHeaderComponent } from './reports-header.component';
import { EchartComponent } from './ui/echart.component';
import { COLORS, PALETTE, bars, donut, heatmap, salesOverTime, twoLines } from './ui/report-charts';
import {
  ReportEmptyComponent,
  ReportErrorComponent,
  ReportSkeletonComponent,
} from './ui/report-states';
import {
  BarItem,
  DeltaComponent,
  HBarsComponent,
  Insight,
  InsightsComponent,
  MoreLinkComponent,
  RankItem,
  RankListComponent,
  ReportCardComponent,
  SparklineComponent,
} from './ui/report-ui';

// Tonos oscuros: las iniciales en blanco pasan 4.5:1
const AVATAR = ['#4446c8', '#7c3aed', '#0e7490', '#be185d', '#047857', '#c2410c'];
const DOW = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
const n = (v: number) => new Intl.NumberFormat('es-PE').format(v);
const longMonth = new Intl.DateTimeFormat('es-PE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Reporte de ventas: lo vendido y cobrado del período, cuándo, a quién y por qué medios. */
@Component({
  selector: 'app-sales-report-page',
  imports: [
    RouterLink,
    IconComponent,
    ModalComponent,
    ReportsHeaderComponent,
    ReportPeriodComponent,
    EchartComponent,
    ReportCardComponent,
    DeltaComponent,
    SparklineComponent,
    RankListComponent,
    HBarsComponent,
    MoreLinkComponent,
    InsightsComponent,
    ReportSkeletonComponent,
    ReportErrorComponent,
    ReportEmptyComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="@container space-y-5">
      <app-reports-header
        description="Lo que vendiste y cobraste, comparado con el período anterior"
      />
      <app-report-period
        [value]="period.state()"
        [today]="period.today"
        [previous]="report()?.previous ?? null"
        [previousEmpty]="noPrevious()"
        (choose)="period.set({ preset: $event })"
        (custom)="period.set($event)"
      />

      @if (res.error() && !report()) {
        <app-report-error [message]="errorText()" (retry)="res.reload()" />
      } @else if (!report()) {
        <app-report-skeleton label="Cargando las ventas" />
      } @else {
        @let r = report()!;
        <div
          class="space-y-4 transition-opacity"
          [class.opacity-60]="res.isLoading()"
          [attr.aria-busy]="res.isLoading()"
        >
          @if (res.error()) {
            <p role="alert" class="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              No se pudo actualizar; ves lo último que cargó.
              <button type="button" class="font-semibold underline" (click)="res.reload()">
                Reintentar
              </button>
            </p>
          }
          <!-- Indicadores -->
          <ul
            class="grid grid-cols-2 gap-3 @3xl:grid-cols-4 @4xl:grid-cols-[1fr_1fr] @6xl:grid-cols-[1.45fr_1fr_1fr_1fr_1fr]"
            aria-label="Indicadores del período"
          >
            <li
              class="card col-span-2 flex flex-col gap-2 bg-gradient-to-b from-white to-anil-50/40 p-4 @3xl:col-span-4 @4xl:col-span-1 @4xl:row-span-2 @6xl:row-span-1"
            >
              <span class="text-[13px] font-semibold text-slate-600">Vendido</span>
              <span class="flex flex-wrap items-center gap-2">
                <b
                  class="font-display text-[28px] leading-tight font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                  >{{ kpiMoney(r.kpis.sold) }}</b
                >
                <app-delta
                  [now]="r.kpis.sold"
                  [before]="r.previousKpis.sold"
                  [quiet]="noPrevious()"
                />
              </span>
              <span class="text-xs text-slate-500">{{
                r.kpis.pending > 0 ? money(r.kpis.pending) + ' por cobrar' : 'Todo cobrado'
              }}</span>
              <app-sparkline class="mt-auto min-h-12 flex-1" [values]="soldSpark()" />
              <span class="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                <i
                  class="block"
                  [style.width.%]="split().services"
                  [style.background]="colors.service"
                ></i>
                <i
                  class="block"
                  [style.width.%]="split().products"
                  [style.background]="colors.product"
                ></i>
              </span>
              <span class="flex justify-between text-xs text-slate-500">
                <span>Servicios {{ split().services }} %</span
                ><span>Productos {{ split().products }} %</span>
              </span>
            </li>
            <li
              class="col-span-2 grid grid-cols-subgrid gap-3 @3xl:col-span-4 @4xl:col-span-1 @4xl:grid-cols-2 @6xl:contents"
            >
              @for (k of kpis(); track k.label) {
                <div class="card @container flex min-w-0 flex-col gap-1.5 p-3.5 sm:p-4">
                  <span class="text-[13px] font-semibold text-slate-600">{{ k.label }}</span>
                  <b
                    class="font-display text-[18px] leading-tight font-semibold whitespace-nowrap text-slate-900 tabular-nums @[10.5rem]:text-[22px]"
                    >{{ k.value }}</b
                  >
                  <app-delta [now]="k.now" [before]="k.before" [quiet]="noPrevious()" />
                  <span class="text-xs leading-snug text-slate-500">{{ k.detail }}</span>
                  @if (k.spark.length > 1) {
                    <app-sparkline class="mt-auto h-10 pt-1" [values]="k.spark" />
                  }
                </div>
              }
            </li>
          </ul>

          @if (!hasSales()) {
            <app-report-empty
              heading="Aún no hay ventas en este período"
              text="Aparecen apenas se registran cargos en una atención o en la caja."
            >
              <button
                type="button"
                class="btn btn-secondary"
                (click)="period.set({ preset: 'last30' })"
              >
                Ver últimos 30 días
              </button>
              <a routerLink="/caja" class="btn btn-primary">Ir a la caja</a>
            </app-report-empty>
          } @else {
            <app-insights [items]="insights()" />

            <!-- Ventas en el tiempo -->
            <app-report-card
              [heading]="'Ventas ' + grainLabel()"
              subtitle="Toca una barra para ver el detalle. La línea punteada es el período anterior."
            >
              <div card-actions class="flex items-center gap-3">
                <span
                  class="hidden flex-wrap gap-3 text-xs text-slate-600 @lg:flex"
                  aria-hidden="true"
                >
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="size-2.5 rounded-sm" [style.background]="colors.service"></i
                    >Servicios</span
                  >
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="size-2.5 rounded-sm" [style.background]="colors.product"></i
                    >Productos</span
                  >
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="w-4 border-t-2 border-dashed border-slate-400"></i>Período
                    anterior</span
                  >
                </span>
                <span
                  role="group"
                  aria-label="Vista"
                  class="inline-flex rounded-xl bg-slate-100 p-0.5"
                >
                  <button
                    type="button"
                    class="grid size-9 place-items-center rounded-lg"
                    [class]="view() === 'chart' ? 'bg-white shadow-sm' : 'text-slate-500'"
                    [attr.aria-pressed]="view() === 'chart'"
                    aria-label="Ver gráfico"
                    (click)="view.set('chart')"
                  >
                    <app-icon name="chart-column" class="size-4" />
                  </button>
                  <button
                    type="button"
                    class="grid size-9 place-items-center rounded-lg"
                    [class]="view() === 'table' ? 'bg-white shadow-sm' : 'text-slate-500'"
                    [attr.aria-pressed]="view() === 'table'"
                    aria-label="Ver tabla"
                    (click)="view.set('table')"
                  >
                    <app-icon name="table" class="size-4" />
                  </button>
                </span>
              </div>
              @if (view() === 'chart') {
                <app-echart
                  [option]="timeOption()"
                  [label]="
                    'Ventas ' + grainLabel() + ' del período, comparadas con el período anterior'
                  "
                  [height]="260"
                />
              } @else {
                <table class="w-full text-sm">
                  <thead>
                    <tr
                      class="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
                    >
                      <th class="py-2 font-semibold">
                        {{
                          r.grain === 'hour'
                            ? 'Hora'
                            : r.grain === 'month'
                              ? 'Mes'
                              : r.grain === 'week'
                                ? 'Semana'
                                : 'Día'
                        }}
                      </th>
                      <th class="py-2 text-right font-semibold">Vendido</th>
                      <th class="py-2 text-right font-semibold">Cobrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (b of tableRows(); track b.key) {
                      <tr class="border-b border-slate-100">
                        <td class="py-2 pr-2 text-slate-700">{{ b.title }}</td>
                        <td class="py-2 text-right font-medium whitespace-nowrap tabular-nums">
                          {{ money(b.total) }}
                        </td>
                        <td
                          class="py-2 pl-2 text-right whitespace-nowrap text-slate-600 tabular-nums"
                        >
                          {{ money(b.collected) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </app-report-card>

            <div class="grid gap-4 @4xl:grid-cols-[1.15fr_1fr]">
              <app-report-card
                heading="Por categoría"
                subtitle="Lo vendido con IGV. Añil: servicios · naranja: productos."
              >
                <app-hbars [items]="categories().slice(0, 8)" />
                @if (categories().length > 8) {
                  <app-more-link
                    [text]="'Ver las ' + categories().length + ' categorías'"
                    (pressed)="modal.set('categories')"
                  />
                }
              </app-report-card>
              <app-report-card heading="Medios de pago" subtitle="Lo cobrado, menos devoluciones.">
                @if (methods().length) {
                  <div class="flex flex-col items-center gap-5 @sm:flex-row">
                    <div class="relative size-36 shrink-0">
                      <app-echart
                        [option]="methodsOption()"
                        label="Cobrado por medio de pago"
                        [height]="144"
                      />
                      <div
                        class="pointer-events-none absolute inset-0 grid place-content-center text-center"
                      >
                        <b class="font-display text-[15px] font-semibold text-slate-900">{{
                          compact(r.kpis.collected)
                        }}</b>
                        <span class="text-xs text-slate-500">cobrado</span>
                      </div>
                    </div>
                    <ul class="w-full divide-y divide-slate-100 text-sm">
                      @for (m of methods(); track m.label) {
                        <li class="flex items-center gap-2 py-1.5">
                          <i class="size-2.5 shrink-0 rounded-sm" [style.background]="m.color"></i>
                          <span class="flex-1 text-slate-700">{{ m.label }}</span>
                          <b class="font-semibold tabular-nums">{{ m.share }} %</b>
                          <span
                            class="w-24 text-right whitespace-nowrap text-slate-500 tabular-nums"
                            >{{ money(m.amount) }}</span
                          >
                        </li>
                      }
                    </ul>
                  </div>
                } @else {
                  <p class="text-sm text-slate-500">Nada cobrado en el período.</p>
                }
                @if (r.documents.length) {
                  <div class="mt-4 border-t border-slate-100 pt-4">
                    <h3 class="text-sm font-semibold text-slate-900">Comprobantes emitidos</h3>
                    <ul class="mt-2 grid grid-cols-3 gap-2">
                      @for (d of r.documents; track d.type) {
                        <li class="rounded-xl bg-slate-50 p-2.5">
                          <span class="block text-xs text-slate-500">{{ docLabels[d.type] }}</span>
                          <b
                            class="block font-display text-base font-semibold text-slate-900 tabular-nums"
                            >{{ d.count }}</b
                          >
                          <span class="block text-xs whitespace-nowrap text-slate-500 tabular-nums"
                            >{{ d.type === 'CREDIT_NOTE' && d.amount ? '−' : ''
                            }}{{ money(d.amount) }}</span
                          >
                        </li>
                      }
                    </ul>
                  </div>
                }
              </app-report-card>
            </div>

            <div class="grid gap-4 @4xl:grid-cols-[1.25fr_1fr]">
              <app-report-card
                heading="¿Cuándo vendes más?"
                subtitle="Por día de la semana y hora. Ayuda a decidir horarios y turnos."
              >
                @if (r.heatmap.length) {
                  <app-echart
                    class="@lg:hidden"
                    [option]="heatOptionCompact()"
                    [label]="heatLabel()"
                    [height]="250"
                  />
                  <app-echart
                    class="hidden @lg:block"
                    [option]="heatOption()"
                    [label]="heatLabel()"
                    [height]="250"
                  />
                  <p class="mt-2 text-sm text-slate-600">{{ heatLabel() }}</p>
                } @else {
                  <p class="text-sm text-slate-500">Sin ventas para armar el mapa.</p>
                }
              </app-report-card>
              <app-report-card
                heading="Por especie"
                subtitle="Lo vendido según la mascota atendida."
              >
                <div class="flex flex-col items-center gap-5 @sm:flex-row">
                  <div class="relative size-32 shrink-0">
                    <app-echart
                      [option]="speciesOption()"
                      label="Ventas por especie"
                      [height]="128"
                    />
                    <div
                      class="pointer-events-none absolute inset-0 grid place-content-center text-center"
                    >
                      <b class="font-display text-[15px] font-semibold text-slate-900">{{
                        petsTotal()
                      }}</b>
                      <span class="text-xs text-slate-500">{{
                        petsTotal() === 1 ? 'mascota' : 'mascotas'
                      }}</span>
                    </div>
                  </div>
                  <ul class="w-full divide-y divide-slate-100 text-sm">
                    @for (s of species(); track s.label) {
                      <li class="flex items-start gap-2 py-2">
                        <i
                          class="mt-1.5 size-2.5 shrink-0 rounded-sm"
                          [style.background]="s.color"
                        ></i>
                        <span class="min-w-0 flex-1">
                          <span class="block text-slate-700">{{ s.label }}</span>
                          @if (s.pets) {
                            <span class="block text-xs text-slate-500"
                              >{{ s.pets }} {{ s.pets === 1 ? 'mascota' : 'mascotas' }} ·
                              <span class="whitespace-nowrap tabular-nums">{{
                                money(s.amount / s.pets)
                              }}</span>
                              c/u</span
                            >
                          }
                        </span>
                        <b class="font-semibold whitespace-nowrap tabular-nums">{{
                          money(s.amount)
                        }}</b>
                      </li>
                    }
                  </ul>
                </div>
              </app-report-card>
            </div>

            <div class="grid gap-4 @4xl:grid-cols-2">
              <app-report-card
                heading="Equipo"
                subtitle="Quién atendió: el veterinario de la consulta o el groomer del servicio."
              >
                <app-rank-list [items]="team().slice(0, 6)" />
                @if (team().length > 6) {
                  <app-more-link
                    [text]="'Ver los ' + team().length"
                    (pressed)="modal.set('team')"
                  />
                }
              </app-report-card>
              <app-report-card
                heading="Lo más vendido"
                [subtitle]="'Los 6 primeros de ' + topItems().length + '.'"
              >
                <span
                  card-actions
                  role="group"
                  aria-label="Ver"
                  class="inline-flex rounded-xl bg-slate-100 p-0.5 text-sm"
                >
                  @for (k of kinds; track k.key) {
                    <button
                      type="button"
                      class="min-h-9 rounded-lg px-3"
                      [class]="
                        topKind() === k.key
                          ? 'bg-white font-semibold text-slate-900 shadow-sm'
                          : 'text-slate-600'
                      "
                      [attr.aria-pressed]="topKind() === k.key"
                      (click)="topKind.set(k.key)"
                    >
                      {{ k.label }}
                    </button>
                  }
                </span>
                @if (topItems().length) {
                  <app-rank-list [items]="topItems().slice(0, 6)" />
                  @if (topItems().length > 6) {
                    <app-more-link
                      [text]="'Ver los ' + (topItems().length - 6) + ' restantes'"
                      (pressed)="modal.set('items')"
                    />
                  }
                } @else {
                  <p class="text-sm text-slate-500">Nada vendido de este tipo.</p>
                }
              </app-report-card>
            </div>

            <div class="grid gap-4 @4xl:grid-cols-2">
              <app-report-card
                heading="Clientes"
                [subtitle]="'Atendidos ' + grainLabel() + ': los que vuelven y los nuevos.'"
              >
                @if (r.grain === 'hour') {
                  <p class="font-display text-[28px] font-semibold text-slate-900">
                    {{ n(r.clients.total) }} {{ r.clients.total === 1 ? 'cliente' : 'clientes' }}
                  </p>
                  <p class="text-sm text-slate-600">
                    {{ r.clients.newOnes }} por primera vez ·
                    {{ r.clients.total - r.clients.newOnes }} ya habían venido
                  </p>
                } @else {
                  <div class="flex flex-col gap-4 @md:flex-row @md:items-center">
                    <app-echart
                      class="min-w-0 flex-1"
                      [option]="clientsOption()"
                      [label]="
                        'Clientes ' +
                        grainLabel() +
                        ': ' +
                        r.clients.total +
                        ' en total, ' +
                        r.clients.newOnes +
                        ' nuevos'
                      "
                      [height]="200"
                    />
                    <div class="shrink-0 @md:w-36">
                      <b class="block font-display text-[28px] font-semibold text-slate-900"
                        >{{ returningShare() }} %</b
                      >
                      <span class="text-sm text-slate-600"
                        >volvió: {{ n(r.clients.repeat) }} de {{ n(r.clients.total) }} vinieron más
                        de una vez</span
                      >
                      <ul class="mt-2 space-y-1 text-xs text-slate-600">
                        <li class="flex items-center gap-1.5">
                          <i class="size-2.5 rounded-sm" [style.background]="colors.service"></i
                          >Vuelven (ya habían venido)
                        </li>
                        <li class="flex items-center gap-1.5">
                          <i class="size-2.5 rounded-sm bg-anil-300"></i>Primera vez ·
                          {{ n(r.clients.newOnes) }}
                        </li>
                      </ul>
                    </div>
                  </div>
                }
                @if (r.overdueBoosters) {
                  <a
                    routerLink="/vacunas"
                    class="mt-4 flex items-center gap-2 rounded-xl bg-anil-50 px-3 py-2.5 text-sm text-anil-800 hover:bg-anil-100"
                  >
                    <app-icon name="syringe" class="size-4 shrink-0" />
                    <span class="flex-1"
                      ><b
                        >{{ r.overdueBoosters }}
                        {{ r.overdueBoosters === 1 ? 'mascota tiene' : 'mascotas tienen' }}</b
                      >
                      el refuerzo vencido: una buena razón para que vuelvan.</span
                    >
                    <span class="font-semibold whitespace-nowrap">Ver ›</span>
                  </a>
                }
              </app-report-card>
              <app-report-card
                heading="Mejores clientes"
                subtitle="Quién más te compró en el período. Toca uno para abrir su ficha."
              >
                @if (bestClients().length) {
                  <app-rank-list [items]="bestClients().slice(0, 6)" />
                  @if (bestClients().length > 6) {
                    <app-more-link
                      [text]="'Ver los ' + bestClients().length"
                      (pressed)="modal.set('clients')"
                    />
                  }
                } @else {
                  <p class="text-sm text-slate-500">Solo hubo ventas de mostrador.</p>
                }
              </app-report-card>
            </div>
          }

          <div class="space-y-4">
            <app-report-card
              heading="Te deben hoy"
              subtitle="Lo vendido y aún no cobrado, de cualquier fecha, por antigüedad."
            >
              @if (r.receivables.total > 0) {
                <div
                  class="grid gap-5 @lg:grid-cols-[12rem_minmax(0,1fr)] @4xl:grid-cols-[14rem_minmax(0,1fr)] @4xl:gap-8"
                >
                  <div>
                    <b
                      class="block font-display text-[26px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                      >{{ money(r.receivables.total) }}</b
                    >
                    <span class="text-sm text-slate-600"
                      >de {{ r.receivables.clients }}
                      {{ r.receivables.clients === 1 ? 'cliente' : 'clientes' }}</span
                    >
                    <span
                      class="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full"
                      aria-hidden="true"
                    >
                      @for (a of aging(); track a.label) {
                        <i
                          class="block"
                          [style.flex]="a.amount || 0.0001"
                          [style.background]="a.color"
                        ></i>
                      }
                    </span>
                    <ul class="mt-3 space-y-1.5 text-sm">
                      @for (a of aging(); track a.label) {
                        <li class="flex items-center gap-2">
                          <i class="size-2.5 shrink-0 rounded-sm" [style.background]="a.color"></i>
                          <span class="flex-1 text-slate-600">{{ a.label }}</span>
                          <b
                            class="font-semibold whitespace-nowrap tabular-nums"
                            [class.text-rose-700]="a.late && a.amount"
                            >{{ money(a.amount) }}</b
                          >
                        </li>
                      }
                    </ul>
                  </div>
                  <div>
                    <app-rank-list [items]="debtors().slice(0, 5)" />
                    <div
                      class="mt-1 flex flex-wrap gap-x-6 border-t border-slate-100 [&>app-more-link]:mt-0 [&>app-more-link]:border-0"
                    >
                      @if (debtors().length > 5) {
                        <app-more-link
                          [text]="'Ver los ' + debtors().length + ' clientes'"
                          (pressed)="modal.set('debtors')"
                        />
                      }
                      <app-more-link [text]="'Cobrar en Caja'" link="/caja" />
                    </div>
                  </div>
                </div>
              } @else {
                <p class="flex items-center gap-2 text-sm text-emerald-700">
                  <app-icon name="check" class="size-4" /> Nadie te debe: todo está cobrado.
                </p>
              }
            </app-report-card>
            @if (r.transport.count || r.transport.pendingHome) {
              <app-report-card
                heading="Movilidad"
                subtitle="Recojos y entregas cobrados. El precio lo pone recepción en cada caso."
              >
                <div class="flex flex-col gap-4 @3xl:flex-row @3xl:items-center @3xl:gap-8">
                  @if (r.transport.count) {
                    <p class="flex shrink-0 flex-wrap items-baseline gap-x-2">
                      <b
                        class="font-display text-[26px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                        >{{ money(r.transport.amount) }}</b
                      >
                      <span class="text-sm text-slate-600"
                        >{{ r.transport.count }}
                        {{ r.transport.count === 1 ? 'servicio' : 'servicios' }} ·
                        {{ money(r.transport.amount / r.transport.count) }} en promedio</span
                      >
                    </p>
                    <div class="min-w-0 flex-1">
                      <span
                        class="flex h-3 gap-0.5 overflow-hidden rounded-full"
                        aria-hidden="true"
                      >
                        @for (t of transport(); track t.label) {
                          <i class="block" [style.flex]="t.count" [style.background]="t.color"></i>
                        }
                      </span>
                      <ul class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        @for (t of transport(); track t.label) {
                          <li class="inline-flex items-center gap-2">
                            <i class="size-2.5 rounded-sm" [style.background]="t.color"></i
                            ><span>{{ t.label }}</span
                            ><b class="tabular-nums">{{ t.count }}</b>
                          </li>
                        }
                      </ul>
                    </div>
                  } @else {
                    <p class="flex-1 text-sm text-slate-500">
                      No se cobró movilidad en el período.
                    </p>
                  }
                  @if (r.transport.pendingHome) {
                    <a
                      routerLink="/cola"
                      class="flex shrink-0 items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 hover:bg-amber-100"
                    >
                      <app-icon name="truck" class="size-4 shrink-0" />
                      <span class="flex-1"
                        ><b
                          >{{ r.transport.pendingHome }}
                          {{ r.transport.pendingHome === 1 ? 'mascota' : 'mascotas' }}</b
                        >
                        por llevar a casa hoy.</span
                      >
                      <span class="font-semibold whitespace-nowrap text-anil-700"
                        >Ver en Cola ›</span
                      >
                    </a>
                  }
                </div>
              </app-report-card>
            }
          </div>

          @if (r.grain !== 'month') {
            <app-report-card
              heading="Últimos 12 meses"
              subtitle="Lo vendido cada mes, comparado con el mismo mes del año anterior."
            >
              <div class="flex flex-col gap-5 @3xl:flex-row @3xl:items-center">
                <app-echart
                  class="min-w-0 flex-1"
                  [option]="monthsOption()"
                  label="Ventas por mes de los últimos 12 meses y del año anterior"
                  [height]="220"
                />
                <dl
                  class="grid shrink-0 grid-cols-1 gap-3 text-sm @lg:grid-cols-3 @3xl:w-48 @3xl:grid-cols-1"
                >
                  <div>
                    <dt class="text-xs text-slate-500">Últimos 12 meses</dt>
                    <dd>
                      <b
                        class="block font-display text-lg font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                        >{{ money(yearTotals().now) }}</b
                      >
                      <app-delta [now]="yearTotals().now" [before]="yearTotals().before" />
                    </dd>
                  </div>
                  <div>
                    <dt class="text-xs text-slate-500">Mejor mes</dt>
                    <dd>
                      <b class="block font-semibold text-slate-900">{{ yearTotals().best.title }}</b
                      ><span class="tabular-nums text-slate-600">{{
                        money(yearTotals().best.sold)
                      }}</span>
                    </dd>
                  </div>
                  <div>
                    <dt class="text-xs text-slate-500">Mes más flojo</dt>
                    <dd>
                      <b class="block font-semibold text-slate-900">{{
                        yearTotals().worst.title
                      }}</b
                      ><span class="tabular-nums text-slate-600">{{
                        money(yearTotals().worst.sold)
                      }}</span>
                    </dd>
                  </div>
                </dl>
              </div>
            </app-report-card>
          }
        </div>
      }
    </div>

    <app-modal
      [open]="modal() !== null"
      [title]="modalTitle()"
      size="lg"
      (closed)="modal.set(null)"
    >
      @switch (modal()) {
        @case ('categories') {
          <app-hbars [items]="categories()" />
        }
        @case ('team') {
          <app-rank-list [items]="team()" />
        }
        @case ('items') {
          <app-rank-list [items]="topItems()" />
        }
        @case ('clients') {
          <app-rank-list [items]="bestClients()" />
        }
        @case ('debtors') {
          <app-rank-list [items]="debtors()" />
        }
      }
    </app-modal>
  `,
})
export class SalesReportPage {
  private readonly api = inject(ReportsService);
  protected readonly period = injectReportPeriod();
  protected readonly money = money;
  protected readonly kpiMoney = kpiMoney;
  /** El período anterior no tuvo nada: se dice una vez arriba, no en cada tarjeta */
  protected readonly noPrevious = computed(() => {
    const p = this.report()?.previousKpis;
    return !!p && !p.sold && !p.collected && !p.visits;
  });
  protected readonly compact = compactMoney;
  protected readonly n = n;
  protected readonly colors = COLORS;
  protected readonly docLabels = {
    BOLETA: 'Boletas',
    FACTURA: 'Facturas',
    CREDIT_NOTE: 'Notas de crédito',
  };
  protected readonly kinds = [
    { key: 'SERVICE' as const, label: 'Servicios' },
    { key: 'PRODUCT' as const, label: 'Productos' },
  ];

  protected readonly view = signal<'chart' | 'table'>('chart');
  protected readonly topKind = signal<'SERVICE' | 'PRODUCT'>('SERVICE');
  protected readonly modal = signal<'categories' | 'team' | 'items' | 'clients' | 'debtors' | null>(
    null,
  );

  /** Una consulta por período; si se cambia rápido, la anterior se cancela (no se mezclan números) */
  protected readonly res = rxResource({
    params: () => ({ from: this.period.state().from, to: this.period.state().to }),
    stream: ({ params }) => this.api.sales(params.from, params.to),
  });
  /** Mientras llega el nuevo, se queda lo anterior en tenue */
  protected readonly report = linkedSignal<SalesReport | undefined, SalesReport | null>({
    source: () => (this.res.hasValue() ? this.res.value() : undefined),
    computation: (v, prev) => v ?? prev?.value ?? null,
  });

  protected readonly errorText = computed(() =>
    apiErrorMessage(this.res.error(), 'Revisa tu conexión e inténtalo de nuevo.'),
  );
  protected readonly hasSales = computed(() => {
    const k = this.report()?.kpis;
    return !!k && (k.sold > 0 || k.collected !== 0);
  });
  protected readonly grainLabel = computed(() => GRAIN_LABELS[this.report()?.grain ?? 'day']);
  /** El período llega hasta hoy: el último grupo va en curso */
  private readonly partialLast = computed(() => this.report()?.to === this.period.today);

  protected readonly buckets = computed(() => {
    const r = this.report();
    return r ? bucketize(r) : [];
  });
  /** En la tabla por hora, solo las horas con algo */
  protected readonly tableRows = computed(() => {
    const list = this.buckets();
    return this.report()?.grain === 'hour' ? list.filter((b) => b.total || b.collected) : list;
  });
  protected readonly soldSpark = computed(() => this.buckets().map((b) => b.total));

  protected readonly split = computed(() => {
    const r = this.report();
    const services = r
      ? r.categories.filter((c) => c.kind === 'SERVICE').reduce((s, c) => s + c.amount, 0)
      : 0;
    const total = r?.kpis.sold || 0;
    const pct = total ? Math.round((services / total) * 100) : 0;
    return { services: pct, products: total ? 100 - pct : 0 };
  });

  protected readonly kpis = computed(() => {
    const r = this.report();
    if (!r) return [];
    const k = r.kpis;
    const p = r.previousKpis;
    return [
      {
        label: 'Cobrado',
        value: kpiMoney(k.collected),
        now: k.collected,
        before: p.collected,
        spark: this.buckets().map((b) => b.collected),
        detail: `${n(k.receipts)} ${k.receipts === 1 ? 'cobro' : 'cobros'}${k.sold ? ` · ${Math.round((k.collected / k.sold) * 100)} % de lo vendido` : ''}`,
      },
      {
        label: 'Atenciones',
        value: n(k.visits),
        now: k.visits,
        before: p.visits,
        spark: (r.series ?? []).map((b) => b.visits),
        detail: 'Consultas, vacunas y grooming',
      },
      {
        label: 'Ticket promedio',
        value: money(k.averageTicket),
        now: k.averageTicket,
        before: p.averageTicket,
        spark: (r.series ?? []).map((b) => b.averageTicket),
        detail: 'Lo cobrado entre los cobros',
      },
      {
        label: 'Clientes nuevos',
        value: n(k.firstTime),
        now: k.firstTime,
        before: p.firstTime,
        spark: r.clients.series.map((s) => s.newOnes),
        detail: r.clients.total
          ? `Vinieron por primera vez, de ${n(r.clients.total)} atendidos`
          : 'Vinieron por primera vez',
      },
    ];
  });

  protected readonly timeOption = computed(() => {
    const r = this.report();
    const prev = r?.previousSeries ?? [];
    return salesOverTime(
      this.buckets().map((b, i) => ({
        label: b.label,
        title: b.title,
        services: b.services,
        products: b.products,
        previous: prev[i]?.sold ?? null,
      })),
      this.partialLast(),
    );
  });

  protected readonly categories = computed<BarItem[]>(() => {
    const list = this.report()?.categories ?? [];
    const max = Math.max(1, ...list.map((c) => c.amount));
    return list.map((c) => ({
      key: `${c.kind}-${c.category}`,
      label: categoryLabel(c.kind, c.category),
      sub: c.kind === 'SERVICE' ? 'servicio' : 'producto',
      value: money(c.amount),
      pct: (c.amount / max) * 100,
      color: c.kind === 'SERVICE' ? COLORS.service : COLORS.product,
    }));
  });

  protected readonly methods = computed(() => {
    const list = (this.report()?.methods ?? []).filter((m) => m.amount > 0);
    const total = list.reduce((s, m) => s + m.amount, 0);
    return list.map((m, i) => ({
      label: METHOD_LABELS[m.method],
      amount: m.amount,
      share: total ? Math.round((m.amount / total) * 100) : 0,
      color: PALETTE[i % PALETTE.length],
    }));
  });
  protected readonly methodsOption = computed(() =>
    donut(this.methods().map((m) => ({ name: m.label, value: m.amount, color: m.color }))),
  );

  protected readonly heatOption = computed(() => heatmap(this.report()?.heatmap ?? [], 1));
  protected readonly heatOptionCompact = computed(() => heatmap(this.report()?.heatmap ?? [], 2));
  /** “Vendes más los sábados de 10 a 12 h” */
  protected readonly heatPeak = computed(() => {
    const cells = this.report()?.heatmap ?? [];
    if (!cells.length) return null;
    const slots = new Map<string, number>();
    for (const c of cells) {
      const k = `${c.dow}-${c.hour - (c.hour % 2)}`;
      slots.set(k, (slots.get(k) ?? 0) + c.amount);
    }
    const [key] = [...slots.entries()].reduce((m, e) => (e[1] > m[1] ? e : m));
    const [dow, hour] = key.split('-').map(Number);
    return { day: DOW[dow - 1], from: hour, to: hour + 2 };
  });
  protected readonly heatLabel = computed(() => {
    const p = this.heatPeak();
    return p
      ? `Vendes más los ${p.day} de ${p.from} a ${p.to} h.`
      : 'Sin ventas para armar el mapa.';
  });

  protected readonly species = computed(() =>
    (this.report()?.species ?? []).map((s, i) => ({
      label: s.species ? SPECIES_PLURAL[s.species] : 'Sin mascota (mostrador)',
      amount: s.amount,
      pets: s.pets,
      color: PALETTE[i % PALETTE.length],
    })),
  );
  protected readonly petsTotal = computed(() => this.species().reduce((s, x) => s + x.pets, 0));
  protected readonly speciesOption = computed(() =>
    donut(this.species().map((s) => ({ name: s.label, value: s.amount, color: s.color }))),
  );

  protected readonly team = computed<RankItem[]>(() => {
    const list = this.report()?.professionals ?? [];
    const max = Math.max(1, ...list.map((p) => p.amount));
    return list.map((p, i) => ({
      key: p.user?.id ?? 'counter',
      lead: p.user
        ? { initials: initials(p.user.fullName), color: AVATAR[i % AVATAR.length] }
        : { icon: 'receipt' as IconName },
      name: p.user?.fullName ?? 'Mostrador (sin atención)',
      sub: p.user
        ? `${ROLE_LABELS[p.user.role]} · ${p.visits} ${p.visits === 1 ? 'atención' : 'atenciones'}`
        : 'Ventas en caja y movilidad de consultas',
      pct: (p.amount / max) * 100,
      value: money(p.amount),
    }));
  });

  protected readonly topItems = computed<RankItem[]>(() => {
    const list = (this.report()?.items ?? []).filter((i) => i.kind === this.topKind());
    const max = Math.max(1, ...list.map((i) => i.amount));
    const icon = (cat: string | null): IconName =>
      cat === 'GROOMING'
        ? 'scissors'
        : cat === 'VACCINATION' || cat === 'VACCINE'
          ? 'syringe'
          : cat === 'LAB'
            ? 'flask'
            : this.topKind() === 'PRODUCT'
              ? 'package'
              : 'stethoscope';
    return list.map((i) => ({
      key: `${i.kind}-${i.id ?? i.name}`,
      lead: {
        icon:
          i.name === 'Movilidad' || i.name === 'Movilidad a domicilio' ? 'truck' : icon(i.category),
      },
      name: i.name,
      sub: quantityLabel(i),
      pct: (i.amount / max) * 100,
      value: money(i.amount),
    }));
  });

  protected readonly returningShare = computed(() => {
    const c = this.report()?.clients;
    return c && c.total ? Math.round((c.repeat / c.total) * 100) : 0;
  });
  protected readonly clientsOption = computed(() => {
    const r = this.report();
    if (!r) return {};
    const labels = this.buckets().map((b) => b.label);
    const titles = this.buckets().map((b) => b.title);
    return bars(
      labels,
      [
        {
          name: 'Vuelven',
          data: r.clients.series.map((s) => s.returning),
          color: COLORS.service,
          stack: 'c',
        },
        {
          name: 'Nuevos',
          data: r.clients.series.map((s) => s.newOnes),
          color: '#a3a8fb',
          stack: 'c',
        },
      ],
      { format: (v) => n(v), axis: (v) => n(v), titles },
    );
  });

  protected readonly bestClients = computed<RankItem[]>(() => {
    const list = this.report()?.topClients ?? [];
    const max = Math.max(1, ...list.map((c) => c.amount));
    return list.slice(0, 6).map((c, i) => ({
      key: c.client.id,
      lead: { icon: (i === 0 ? 'star' : 'user') as IconName },
      name: c.client.name,
      sub: `${c.visits} ${c.visits === 1 ? 'visita' : 'visitas'} · ${c.pets} ${c.pets === 1 ? 'mascota' : 'mascotas'}`,
      pct: (c.amount / max) * 100,
      value: money(c.amount),
      link: ['/clientes', c.client.id],
    }));
  });

  protected readonly aging = computed(() => {
    const a = this.report()?.receivables.aging ?? { upTo7: 0, upTo30: 0, older: 0 };
    return [
      { label: 'Hasta 7 días', amount: a.upTo7, color: '#a3a8fb', late: false },
      { label: '8 a 30 días', amount: a.upTo30, color: COLORS.service, late: false },
      { label: 'Más de 30 días', amount: a.older, color: COLORS.red, late: true },
    ];
  });
  protected readonly debtors = computed<RankItem[]>(() => {
    const list = this.report()?.receivables.top ?? [];
    const max = Math.max(1, ...list.map((d) => d.amount));
    return list.map((d) => {
      const days = Math.floor((Date.now() - Date.parse(d.oldestAt)) / 86_400_000);
      return {
        key: d.client.id,
        lead: { icon: 'user' as IconName },
        name: d.client.name,
        sub: `${d.charges} ${d.charges === 1 ? 'cargo' : 'cargos'} · ${days <= 0 ? 'desde hoy' : days === 1 ? 'desde ayer' : `desde hace ${days} días`}`,
        pct: (d.amount / max) * 100,
        value: money(d.amount),
        valueTone: days > 30 ? ('danger' as const) : undefined,
        link: ['/clientes', d.client.id],
      };
    });
  });

  protected readonly transport = computed(() =>
    (this.report()?.transport.byType ?? []).map((t, i) => ({
      label: TRANSPORT_LABELS[t.transport],
      count: t.count,
      color: PALETTE[i % PALETTE.length],
    })),
  );

  protected readonly yearTotals = computed(() => {
    const months = this.report()?.months ?? [];
    const now = months.reduce((s, m) => s + m.sold, 0);
    const before = months.reduce((s, m) => s + m.previous, 0);
    const title = (m: string) => {
      const label = longMonth.format(new Date(`${m}-15T12:00:00Z`)).replace(' de ', ' ');
      return label.charAt(0).toUpperCase() + label.slice(1);
    };
    const withSales = months.filter((m) => m.sold > 0);
    const best = withSales.reduce(
      (a, m) => (m.sold > a.sold ? m : a),
      withSales[0] ?? { month: '', sold: 0 },
    );
    const worst = withSales.reduce(
      (a, m) => (m.sold < a.sold ? m : a),
      withSales[0] ?? { month: '', sold: 0 },
    );
    return {
      now: Math.round(now * 100) / 100,
      before: Math.round(before * 100) / 100,
      best: { title: best.month ? title(best.month) : '—', sold: best.sold },
      worst: { title: worst.month ? title(worst.month) : '—', sold: worst.sold },
    };
  });
  protected readonly monthsOption = computed(() => {
    const months = this.report()?.months ?? [];
    const crosses =
      months.length > 0 &&
      months[0].month.slice(0, 4) !== months[months.length - 1].month.slice(0, 4);
    return twoLines(
      months.map((m, i) => monthLabel(m.month, crosses && (i === 0 || m.month.endsWith('-01')))),
      months.map((m) => m.sold),
      months.map((m) => m.previous),
      months.map((m) => monthLabel(m.month, true)),
    );
  });

  /** Tres o cuatro frases con lo importante del período */
  protected readonly insights = computed<Insight[]>(() => {
    const r = this.report();
    if (!r || r.kpis.sold <= 0) return [];
    const out: Insight[] = [];
    const d = delta(r.kpis.sold, r.previousKpis.sold);
    if (d.percent !== null && d.trend !== 'flat')
      out.push({
        key: 'trend',
        icon: d.trend === 'up' ? 'trending-up' : 'trending-down',
        tone: d.trend === 'up' ? 'up' : 'down',
        parts: [
          'Vendiste ',
          `${Math.abs(d.percent)} % ${d.trend === 'up' ? 'más' : 'menos'}`,
          ' que en el período anterior.',
        ],
      });
    const list = this.buckets().filter(
      (b, i, all) => b.total > 0 && !(this.partialLast() && i === all.length - 1),
    );
    if (list.length > 1) {
      const best = list.reduce((m, b) => (b.total > m.total ? b : m));
      const what =
        r.grain === 'hour'
          ? 'Tu mejor hora fue'
          : r.grain === 'day'
            ? 'Tu mejor día fue el'
            : r.grain === 'week'
              ? 'Tu mejor semana fue la del'
              : 'Tu mejor mes fue';
      out.push({
        key: 'best',
        icon: 'calendar',
        tone: 'neutral',
        parts: [`${what} `, best.title.toLowerCase(), `: ${money(best.total)}.`],
      });
    }
    const peak = this.heatPeak();
    if (peak && r.grain !== 'hour')
      out.push({
        key: 'peak',
        icon: 'clock',
        tone: 'warning',
        parts: ['Vendes más los ', `${peak.day} de ${peak.from} a ${peak.to} h`, '.'],
      });
    if (r.receivables.total > 0)
      out.push({
        key: 'debt',
        icon: 'receipt',
        tone: r.receivables.aging.older > 0 ? 'down' : 'neutral',
        parts: [
          'Te deben ',
          money(r.receivables.total),
          r.receivables.aging.older > 0
            ? `; ${money(r.receivables.aging.older)} tienen más de 30 días.`
            : '.',
        ],
      });
    return out.slice(0, 4);
  });

  protected readonly modalTitle = computed(() => {
    switch (this.modal()) {
      case 'categories':
        return 'Ventas por categoría';
      case 'team':
        return 'Equipo';
      case 'items':
        return this.topKind() === 'SERVICE' ? 'Servicios vendidos' : 'Productos vendidos';
      case 'clients':
        return 'Mejores clientes';
      case 'debtors':
        return 'Te deben hoy';
      default:
        return '';
    }
  });
}
