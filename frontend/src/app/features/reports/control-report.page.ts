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
import { ROLE_LABELS } from '../../core/auth/auth.models';
import {
  ControlReport,
  GRAIN_LABELS,
  bucketLabels,
  compactMoney,
  delta,
  reasonLabel,
  stockLabel,
} from '../../core/services/reports.models';
import { ReportsService } from '../../core/services/reports.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { injectReportPeriod } from './report-period';
import { ReportPeriodComponent } from './report-period.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ReportsHeaderComponent } from './reports-header.component';
import { EchartComponent } from './ui/echart.component';
import { COLORS, PALETTE, bars, closingsChart, donut } from './ui/report-charts';
import { ReportErrorComponent, ReportSkeletonComponent } from './ui/report-states';
import {
  BarItem,
  DeltaComponent,
  HBarsComponent,
  Insight,
  InsightsComponent,
  MoreLinkComponent,
  ReportCardComponent,
} from './ui/report-ui';

const dateTime = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Lima',
});
const dayOnly = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'America/Lima',
});
const when = (iso: string) => dateTime.format(new Date(iso)).replace('.', '');
const day = (iso: string) => dayOnly.format(new Date(iso)).replace('.', '');
/** “Carlos” de “Dr. Carlos Mendoza Ríos” */
const firstName = (name?: string) =>
  (name ?? 'Alguien').split(' ').find((w) => !w.endsWith('.')) ?? 'Alguien';
const signed = (v: number) => (v > 0 ? `+${money(v)}` : v < 0 ? `−${money(-v)}` : money(0));

/**
 * Control del dueño: ¿se escapa plata? Descuentos, anulaciones, cierres de caja con diferencia,
 * mermas y cambios de precio del período. Todo sale de lo que el sistema ya guarda.
 */
@Component({
  selector: 'app-control-report-page',
  imports: [
    NgTemplateOutlet,
    ModalComponent,
    RouterLink,
    IconComponent,
    ReportsHeaderComponent,
    ReportPeriodComponent,
    EchartComponent,
    ReportCardComponent,
    DeltaComponent,
    HBarsComponent,
    MoreLinkComponent,
    InsightsComponent,
    ReportSkeletonComponent,
    ReportErrorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="@container space-y-5">
      <app-reports-header
        description="¿Se te está escapando plata? Descuentos, anulaciones, caja y mermas del período"
      />
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
        <app-report-skeleton label="Cargando el control" />
      } @else {
        @let r = report()!;
        @let k = r.kpis;
        <div
          class="space-y-4 transition-opacity"
          [class.opacity-60]="res.isLoading()"
          [attr.aria-busy]="res.isLoading()"
        >
          <ul class="grid grid-cols-2 gap-3 @4xl:grid-cols-4" aria-label="Indicadores del período">
            <li class="card min-w-0 p-4">
              <span
                class="flex items-center justify-between gap-2 text-[13px] font-semibold text-slate-600"
                >Descuentos
                <span
                  class="grid size-8 place-items-center rounded-xl bg-anil-50 text-anil-700"
                  aria-hidden="true"
                  ><app-icon name="tag" class="size-4" /></span
              ></span>
              <b
                class="block font-display text-[22px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                >{{ money(k.discounts) }}</b
              >
              <span class="block text-xs text-slate-500"
                >{{ k.discountCount }} {{ k.discountCount === 1 ? 'descuento' : 'descuentos'
                }}{{
                  k.discountPercent !== null && k.discounts
                    ? ' · ' + k.discountPercent + ' % de lo vendido'
                    : ''
                }}</span
              >
              <app-delta
                class="mt-1.5"
                [now]="k.discounts"
                [before]="r.previousKpis.discounts"
                good="down"
              />
            </li>
            <li class="card min-w-0 p-4">
              <span
                class="flex items-center justify-between gap-2 text-[13px] font-semibold text-slate-600"
                >Anulado
                <span
                  class="grid size-8 place-items-center rounded-xl bg-rose-50 text-rose-600"
                  aria-hidden="true"
                  ><app-icon name="ban" class="size-4" /></span
              ></span>
              <b
                class="block font-display text-[22px] font-semibold whitespace-nowrap tabular-nums"
                [class]="k.voided ? 'text-rose-700' : 'text-slate-900'"
                >{{ money(k.voided) }}</b
              >
              <span class="block text-xs text-slate-500"
                >{{ k.voidCount }} {{ k.voidCount === 1 ? 'anulación' : 'anulaciones' }} con
                motivo</span
              >
              <app-delta
                class="mt-1.5"
                [now]="k.voided"
                [before]="r.previousKpis.voided"
                good="down"
              />
            </li>
            <li class="card min-w-0 p-4">
              <span
                class="flex items-center justify-between gap-2 text-[13px] font-semibold text-slate-600"
                >Diferencias de caja
                <span
                  class="grid size-8 place-items-center rounded-xl bg-amber-50 text-amber-700"
                  aria-hidden="true"
                  ><app-icon name="banknote" class="size-4" /></span
              ></span>
              <b
                class="block font-display text-[22px] font-semibold whitespace-nowrap tabular-nums"
                [class]="k.cashNet < 0 ? 'text-amber-700' : 'text-slate-900'"
                >{{ signed(k.cashNet) }}</b
              >
              <span class="block text-xs text-slate-500"
                >{{ k.cashWithDifference }} de {{ k.cashSessions }}
                {{ k.cashSessions === 1 ? 'cierre' : 'cierres' }} con diferencia</span
              >
            </li>
            <li class="card min-w-0 p-4">
              <span
                class="flex items-center justify-between gap-2 text-[13px] font-semibold text-slate-600"
                >Mermas y ajustes
                <span
                  class="grid size-8 place-items-center rounded-xl bg-slate-100 text-slate-600"
                  aria-hidden="true"
                  ><app-icon name="trash" class="size-4" /></span
              ></span>
              <b
                class="block font-display text-[22px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                >{{ money(k.waste) }}</b
              >
              <span class="block text-xs text-slate-500">Bajas y conteos, a costo</span>
              <app-delta
                class="mt-1.5"
                [now]="k.waste"
                [before]="r.previousKpis.waste"
                good="down"
              />
            </li>
          </ul>

          <app-insights [items]="insights()" />

          <div class="grid gap-4 @4xl:grid-cols-[1.25fr_1fr]">
            <app-report-card
              [heading]="'Descuentos y anulaciones ' + grainLabel()"
              subtitle="Si un grupo se dispara, revisa quién y por qué abajo."
            >
              @if (r.grain === 'hour') {
                <ul class="divide-y divide-slate-100 text-sm">
                  <li class="flex items-center justify-between py-2.5">
                    <span class="flex items-center gap-2"
                      ><app-icon name="tag" class="size-4 text-anil-600" />{{ k.discountCount }}
                      {{ k.discountCount === 1 ? 'descuento' : 'descuentos' }}</span
                    ><b class="tabular-nums">{{ money(k.discounts) }}</b>
                  </li>
                  <li class="flex items-center justify-between py-2.5">
                    <span class="flex items-center gap-2"
                      ><app-icon name="ban" class="size-4 text-rose-600" />{{
                        k.voidCount
                          ? k.voidCount + (k.voidCount === 1 ? ' anulación' : ' anulaciones')
                          : 'Sin anulaciones'
                      }}</span
                    ><b class="tabular-nums">{{ money(k.voided) }}</b>
                  </li>
                </ul>
                <p class="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                  Con un solo día se muestra el total; la tendencia aparece desde 7 días.
                </p>
              } @else if (k.discounts || k.voided) {
                <app-echart
                  [option]="seriesOption()"
                  [label]="'Descuentos y anulaciones ' + grainLabel()"
                  [height]="230"
                />
                <p class="mt-2 flex gap-4 text-xs text-slate-600" aria-hidden="true">
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="size-2.5 rounded-sm bg-anil-500"></i>Descuentos</span
                  >
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="size-2.5 rounded-sm" [style.background]="colors.red"></i
                    >Anulado</span
                  >
                </p>
              } @else {
                <p class="flex items-center gap-2 text-sm text-emerald-700">
                  <app-icon name="check" class="size-4" /> Sin descuentos ni anulaciones en el
                  período.
                </p>
              }
            </app-report-card>
            <app-report-card
              heading="Descuentos por motivo"
              subtitle="El motivo es obligatorio al dar un descuento."
            >
              @if (reasons().length) {
                <div class="flex flex-col items-center gap-5 @sm:flex-row">
                  <div class="relative size-32 shrink-0">
                    <app-echart
                      [option]="reasonsOption()"
                      label="Descuentos por motivo"
                      [height]="128"
                    />
                    <div
                      class="pointer-events-none absolute inset-0 grid place-content-center text-center"
                    >
                      <b class="font-display text-[15px] font-semibold text-slate-900">{{
                        compact(k.discounts)
                      }}</b>
                      <span class="text-xs text-slate-500">en total</span>
                    </div>
                  </div>
                  <ul class="w-full divide-y divide-slate-100 text-sm">
                    @for (x of reasons(); track x.label) {
                      <li class="flex items-center gap-2 py-1.5">
                        <i class="size-2.5 shrink-0 rounded-sm" [style.background]="x.color"></i>
                        <span class="flex-1 text-slate-700"
                          >{{ x.label }}
                          <span class="text-xs text-slate-500">· {{ x.count }}</span></span
                        >
                        <b class="font-semibold whitespace-nowrap tabular-nums">{{
                          money(x.amount)
                        }}</b>
                      </li>
                    }
                  </ul>
                </div>
                @if (r.discountClients.length) {
                  <h3
                    class="mt-4 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900"
                  >
                    Clientes con más descuento
                  </h3>
                  <ng-container
                    *ngTemplateOutlet="
                      clientList;
                      context: { $implicit: r.discountClients.slice(0, 3) }
                    "
                  />
                  @if (r.discountClients.length > 3) {
                    <app-more-link
                      [text]="'Ver los ' + r.discountClients.length + ' clientes'"
                      (pressed)="modal.set('clients')"
                    />
                  }
                }
              } @else {
                <p class="text-sm text-slate-500">No hubo descuentos en el período.</p>
              }
            </app-report-card>
          </div>

          <div class="grid gap-4 @4xl:grid-cols-2">
            <app-report-card
              heading="Descuentos por persona"
              [subtitle]="
                'Quién dio descuentos. El tope por cobro es ' + r.maxDiscountPercent + ' %.'
              "
            >
              @if (byUser().length) {
                <app-hbars [items]="byUser()" />
                @if (r.maxApplied !== null) {
                  <p
                    class="mt-3 rounded-xl px-3 py-2.5 text-sm"
                    [class]="
                      r.maxApplied > r.maxDiscountPercent
                        ? 'bg-rose-50 text-rose-800'
                        : 'bg-slate-50 text-slate-600'
                    "
                  >
                    @if (r.maxApplied > r.maxDiscountPercent) {
                      Hubo un descuento de <b>{{ r.maxApplied }} %</b>, más que el tope: revísalo en
                      Actividad.
                    } @else {
                      Ningún descuento pasó el tope. El más alto fue de <b>{{ r.maxApplied }} %</b>.
                    }
                  </p>
                }
              } @else {
                <p class="text-sm text-slate-500">Nadie dio descuentos en el período.</p>
              }
            </app-report-card>
            <app-report-card
              heading="Anulaciones"
              subtitle="Cargos quitados y cobros anulados, con quién y por qué."
            >
              @if (r.voids.items.length) {
                <ul class="divide-y divide-slate-100">
                  @for (v of r.voids.items.slice(0, 5); track $index) {
                    <li class="flex items-center gap-3 py-2.5">
                      <span
                        class="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600"
                        aria-hidden="true"
                        ><app-icon name="ban" class="size-4"
                      /></span>
                      <span class="min-w-0 flex-1">
                        <b class="line-clamp-2 text-sm font-medium text-slate-900">{{
                          v.kind === 'charge' ? 'Cargo quitado: ' + v.title : v.title + ' anulado'
                        }}</b>
                        <span class="text-xs text-slate-500"
                          >{{ v.user ?? '—' }}{{ v.reason ? ' · “' + v.reason + '”' : '' }}</span
                        >
                      </span>
                      <span class="shrink-0 text-right">
                        <b class="block text-sm font-semibold whitespace-nowrap tabular-nums">{{
                          money(v.amount)
                        }}</b>
                        <span class="text-xs whitespace-nowrap text-slate-500">{{
                          when(v.at)
                        }}</span>
                      </span>
                    </li>
                  }
                </ul>
                <app-more-link
                  [text]="
                    'Ver ' +
                    (r.voids.count === 1 ? 'la anulación' : 'las ' + r.voids.count) +
                    ' en Actividad'
                  "
                  link="/actividad"
                />
              } @else {
                <p class="flex items-center gap-2 text-sm text-emerald-700">
                  <app-icon name="check" class="size-4" /> Ninguna anulación en el período.
                </p>
              }
            </app-report-card>
          </div>

          <div class="grid gap-4 @4xl:grid-cols-2">
            <app-report-card heading="Cierres de caja" [subtitle]="closingsSubtitle()">
              @if (k.cashSessions) {
                <app-echart
                  [option]="closingsOption()"
                  [label]="
                    k.cashWithDifference +
                    ' de ' +
                    k.cashSessions +
                    ' cierres con diferencia; neto ' +
                    signed(k.cashNet)
                  "
                  [height]="170"
                />
                @if (r.closings.items.length) {
                  <ul class="mt-2 divide-y divide-slate-100">
                    @for (c of r.closings.items.slice(0, 4); track c.id) {
                      <li>
                        <a
                          [routerLink]="['/caja/cierres', c.id]"
                          class="flex items-center gap-3 py-2.5 hover:bg-slate-50"
                        >
                          <span
                            class="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"
                            aria-hidden="true"
                            ><app-icon name="banknote" class="size-4"
                          /></span>
                          <span class="min-w-0 flex-1">
                            <b class="block text-sm font-medium text-slate-900"
                              >Cierre del {{ day(c.at) }}</b
                            >
                            <span class="text-xs text-slate-500"
                              >{{ c.user ?? '—' }}{{ c.note ? ' · “' + c.note + '”' : '' }}</span
                            >
                          </span>
                          <span class="shrink-0 text-right">
                            <b
                              class="block text-sm font-semibold whitespace-nowrap tabular-nums"
                              [class]="c.difference < 0 ? 'text-rose-700' : 'text-emerald-700'"
                              >{{ signed(c.difference) }}</b
                            >
                            <span class="text-xs text-slate-500">{{
                              c.difference < 0 ? 'faltó' : 'sobró'
                            }}</span>
                          </span>
                        </a>
                      </li>
                    }
                  </ul>
                  @if (r.closings.items.length > 4) {
                    <app-more-link
                      [text]="'Ver los ' + r.closings.items.length + ' con diferencia en Caja'"
                      link="/caja"
                    />
                  }
                } @else {
                  <p class="mt-2 flex items-center gap-2 text-sm text-emerald-700">
                    <app-icon name="check" class="size-4" /> Todos los cierres cuadraron exacto.
                  </p>
                }
              } @else {
                <div class="py-4 text-center">
                  <span
                    class="mx-auto grid size-11 place-items-center rounded-2xl bg-anil-50 text-anil-700"
                    aria-hidden="true"
                    ><app-icon name="banknote" class="size-5"
                  /></span>
                  <b class="mt-2 block text-sm font-semibold text-slate-900"
                    >Sin cierres en el período</b
                  >
                  <span class="text-sm text-slate-500">{{
                    r.grain === 'hour'
                      ? 'La caja de hoy sigue abierta o aún no se cierra.'
                      : 'Aparecen al cerrar la caja.'
                  }}</span>
                </div>
              }
            </app-report-card>
            <app-report-card
              heading="Mermas y ajustes de inventario"
              subtitle="Lo que salió del almacén sin venderse, a costo."
            >
              @if (r.waste.items.length) {
                <app-hbars [items]="wasteBars()" />
                <ng-container
                  *ngTemplateOutlet="wasteList; context: { $implicit: r.waste.items.slice(0, 4) }"
                />
                @if (r.waste.items.length > 4) {
                  <app-more-link
                    [text]="'Ver las ' + r.waste.items.length + ' salidas'"
                    (pressed)="modal.set('waste')"
                  />
                }
              } @else {
                <p class="flex items-center gap-2 text-sm text-emerald-700">
                  <app-icon name="check" class="size-4" /> Sin mermas ni ajustes en el período.
                </p>
              }
            </app-report-card>
          </div>

          <div class="grid gap-4 @4xl:grid-cols-[1.5fr_1fr]">
            <app-report-card
              heading="Por persona"
              subtitle="Cobros, descuentos, anulaciones y caja de cada uno en el período."
            >
              @if (r.people.length) {
                <table class="hidden w-full text-sm @xl:table">
                  <caption class="sr-only">
                    Actividad de cada persona en el período
                  </caption>
                  <thead>
                    <tr
                      class="border-b border-slate-200 text-xs font-semibold tracking-wide text-slate-500 uppercase"
                    >
                      <th scope="col" class="py-2 text-left font-semibold">Persona</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Cobros</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Cobrado</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Descuentos</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Anul.</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Caja</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of r.people; track p.user.id) {
                      <tr class="border-b border-slate-100">
                        <td class="py-2.5">
                          <b class="line-clamp-2 font-medium text-slate-900">{{
                            p.user.fullName
                          }}</b
                          ><span class="text-xs text-slate-500">{{ roles[p.user.role] }}</span>
                        </td>
                        <td class="py-2.5 pl-3 text-right tabular-nums">{{ p.receipts }}</td>
                        <td
                          class="py-2.5 pl-3 text-right font-semibold whitespace-nowrap tabular-nums"
                        >
                          {{ money(p.collected) }}
                        </td>
                        <td class="py-2.5 pl-3 text-right whitespace-nowrap">
                          <b class="block font-semibold tabular-nums">{{ money(p.discounts) }}</b>
                          @if (p.discountPercent) {
                            <span
                              class="text-xs tabular-nums"
                              [class]="
                                p.discountPercent > r.maxDiscountPercent / 2
                                  ? 'text-amber-700'
                                  : 'text-slate-500'
                              "
                              >{{ p.discountPercent }} %</span
                            >
                          }
                        </td>
                        <td class="py-2.5 pl-3 text-right tabular-nums">{{ p.voids }}</td>
                        <td
                          class="py-2.5 pl-3 text-right font-semibold whitespace-nowrap tabular-nums"
                          [class]="
                            p.cashDifference === null || p.cashDifference === 0
                              ? 'text-slate-400'
                              : p.cashDifference < 0
                                ? 'text-rose-700'
                                : 'text-emerald-700'
                          "
                        >
                          {{ p.cashDifference === null ? '—' : signed(p.cashDifference) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
                <ul class="divide-y divide-slate-100 @xl:hidden">
                  @for (p of r.people; track p.user.id) {
                    <li class="py-2.5">
                      <div class="flex justify-between gap-3">
                        <span class="min-w-0"
                          ><b class="line-clamp-2 text-sm font-medium text-slate-900">{{
                            p.user.fullName
                          }}</b
                          ><span class="text-xs text-slate-500"
                            >{{ roles[p.user.role] }} · {{ p.receipts }}
                            {{ p.receipts === 1 ? 'cobro' : 'cobros' }}</span
                          ></span
                        >
                        <b class="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums">{{
                          money(p.collected)
                        }}</b>
                      </div>
                      <div class="mt-1.5 flex flex-wrap gap-1.5 text-xs font-semibold">
                        <span class="rounded-full bg-anil-50 px-2 py-0.5 text-anil-800"
                          >Desc. {{ money(p.discounts)
                          }}{{ p.discountPercent ? ' · ' + p.discountPercent + ' %' : '' }}</span
                        >
                        <span class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600"
                          >{{ p.voids }} anul.</span
                        >
                        @if (p.cashDifference !== null) {
                          <span
                            class="rounded-full px-2 py-0.5"
                            [class]="
                              p.cashDifference < 0
                                ? 'bg-rose-50 text-rose-700'
                                : p.cashDifference > 0
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600'
                            "
                            >Caja {{ signed(p.cashDifference) }}</span
                          >
                        }
                      </div>
                    </li>
                  }
                </ul>
              } @else {
                <p class="text-sm text-slate-500">Sin movimientos en el período.</p>
              }
            </app-report-card>
            <app-report-card
              heading="Cambios de precio"
              subtitle="Precios del catálogo y de movilidad cambiados en el período."
            >
              @if (r.priceChanges.items.length) {
                <ul class="divide-y divide-slate-100">
                  @for (c of r.priceChanges.items.slice(0, 5); track $index) {
                    <li class="flex items-center gap-3 py-2.5">
                      <span
                        class="grid size-9 shrink-0 place-items-center rounded-xl bg-anil-50 text-anil-700"
                        aria-hidden="true"
                        ><app-icon
                          [name]="c.action === 'charge.transport_price' ? 'truck' : 'pencil'"
                          class="size-4"
                      /></span>
                      <span class="min-w-0 flex-1">
                        <b class="line-clamp-2 text-sm font-medium text-slate-900">{{ c.name }}</b>
                        <span class="text-xs text-slate-500"
                          >{{ c.before === null ? '—' : money(c.before) }} →
                          {{ c.after === null ? '—' : money(c.after) }} · {{ c.user ?? '—' }}</span
                        >
                      </span>
                      <span class="shrink-0 text-xs whitespace-nowrap text-slate-500">{{
                        when(c.at)
                      }}</span>
                    </li>
                  }
                </ul>
                <app-more-link
                  [text]="
                    'Ver ' +
                    (r.priceChanges.count === 1 ? 'el cambio' : 'los ' + r.priceChanges.count) +
                    ' en Actividad'
                  "
                  link="/actividad"
                />
              } @else {
                <p class="text-sm text-slate-500">No se cambiaron precios en el período.</p>
              }
            </app-report-card>
          </div>
        </div>
      }
    </div>
    <app-modal
      [open]="modal() !== null"
      [title]="
        modal() === 'clients' ? 'Clientes con más descuento' : 'Mermas y ajustes de inventario'
      "
      size="lg"
      (closed)="modal.set(null)"
    >
      @if (report(); as r) {
        @if (modal() === 'clients') {
          <ng-container *ngTemplateOutlet="clientList; context: { $implicit: r.discountClients }" />
        } @else if (modal() === 'waste') {
          <ng-container *ngTemplateOutlet="wasteList; context: { $implicit: r.waste.items }" />
        }
      }
    </app-modal>
    <ng-template #clientList let-rows>
      <ul class="divide-y divide-slate-100 text-sm">
        @for (c of rows; track c.client.id) {
          <li class="flex items-center justify-between gap-3 py-2">
            <a
              [routerLink]="['/clientes', c.client.id]"
              class="min-w-0 truncate font-medium text-slate-900 hover:text-anil-700"
              >{{ c.client.name }}</a
            >
            <span class="shrink-0 text-right"
              ><b class="tabular-nums">{{ money(c.amount) }}</b>
              <span class="text-xs text-slate-500">· {{ c.count }}</span></span
            >
          </li>
        }
      </ul>
    </ng-template>
    <ng-template #wasteList let-rows>
      <ul class="mt-3 divide-y divide-slate-100 border-t border-slate-100">
        @for (w of rows; track $index) {
          <li class="flex items-center gap-3 py-2.5">
            <span
              class="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"
              aria-hidden="true"
              ><app-icon name="trash" class="size-4"
            /></span>
            <span class="min-w-0 flex-1">
              <b class="line-clamp-2 text-sm font-medium text-slate-900"
                >{{ w.product }} · {{ w.type === 'WASTE' ? 'baja' : 'ajuste por conteo' }}</b
              >
              <span class="text-xs text-slate-500"
                >{{ stock(w.quantity, w.unit) }}{{ w.lot ? ' · lote ' + w.lot : ''
                }}{{ w.reason ? ' · “' + w.reason + '”' : '' }}</span
              >
            </span>
            <span class="shrink-0 text-right">
              <b class="block text-sm font-semibold whitespace-nowrap tabular-nums">{{
                w.value === null ? 'Sin costo' : money(w.value)
              }}</b>
              <span class="text-xs text-slate-500">{{ day(w.at) }}</span>
            </span>
          </li>
        }
      </ul>
    </ng-template>
  `,
})
export class ControlReportPage {
  protected readonly modal = signal<'clients' | 'waste' | null>(null);
  private readonly api = inject(ReportsService);
  protected readonly period = injectReportPeriod();
  protected readonly money = money;
  protected readonly compact = compactMoney;
  protected readonly signed = signed;
  protected readonly when = when;
  protected readonly day = day;
  protected readonly stock = stockLabel;
  protected readonly roles = ROLE_LABELS;
  protected readonly colors = COLORS;

  protected readonly res = rxResource({
    params: () => ({ from: this.period.state().from, to: this.period.state().to }),
    stream: ({ params }) => this.api.control(params.from, params.to),
  });
  protected readonly report = linkedSignal<ControlReport | undefined, ControlReport | null>({
    source: () => (this.res.hasValue() ? this.res.value() : undefined),
    computation: (v, prev) => v ?? prev?.value ?? null,
  });
  protected readonly errorText = computed(() =>
    apiErrorMessage(this.res.error(), 'Revisa tu conexión e inténtalo de nuevo.'),
  );
  protected readonly grainLabel = computed(() => GRAIN_LABELS[this.report()?.grain ?? 'day']);

  private readonly labels = computed(() => {
    const r = this.report();
    if (!r) return [];
    const manyYears = r.from.slice(0, 4) !== r.to.slice(0, 4);
    return r.series.map((s) => bucketLabels(r.grain, s, manyYears));
  });
  protected readonly seriesOption = computed(() => {
    const r = this.report();
    if (!r) return {};
    return bars(
      this.labels().map((l) => l.label),
      [
        { name: 'Descuentos', data: r.series.map((s) => s.discounts), color: '#5a5ee0' },
        { name: 'Anulado', data: r.series.map((s) => s.voided), color: COLORS.red },
      ],
      { titles: this.labels().map((l) => l.title) },
    );
  });

  protected readonly reasons = computed(() =>
    (this.report()?.discountsByReason ?? []).map((x, i) => ({
      label: reasonLabel(x.reason),
      amount: x.amount,
      count: x.count,
      color: PALETTE[i % PALETTE.length],
    })),
  );
  protected readonly reasonsOption = computed(() =>
    donut(this.reasons().map((x) => ({ name: x.label, value: x.amount, color: x.color }))),
  );

  protected readonly byUser = computed<BarItem[]>(() => {
    const list = this.report()?.discountsByUser ?? [];
    const max = Math.max(1, ...list.map((x) => x.amount));
    return list.map((x) => ({
      key: String(x.user?.id ?? 0),
      label: x.user?.fullName ?? 'Sin usuario',
      sub: `${x.user ? ROLE_LABELS[x.user.role].toLowerCase() + ' · ' : ''}${x.count} ${x.count === 1 ? 'descuento' : 'descuentos'}${x.percent ? ' · ' + x.percent + ' %' : ''}`,
      value: money(x.amount),
      pct: (x.amount / max) * 100,
      color: '#5a5ee0',
    }));
  });

  protected readonly closingsSubtitle = computed(() => {
    const r = this.report();
    return r && r.closings.buckets.length
      ? `Sobrantes y faltantes sumados ${GRAIN_LABELS[r.grain]}.`
      : 'Cada cierre: un punto si cuadró exacto, una barra si sobró o faltó.';
  });
  protected readonly closingsOption = computed(() => {
    const r = this.report();
    if (!r) return {};
    if (r.closings.buckets.length) {
      const labels = this.labels();
      return closingsChart(
        labels.map((l) => l.label),
        labels.map((l) => l.title),
        r.closings.buckets.map((b) => b.surplus),
        r.closings.buckets.map((b) => b.shortage),
      );
    }
    const pts = r.closings.points;
    return closingsChart(
      pts.map((p) => day(p.at)),
      pts.map((p) => `Cierre del ${when(p.at)}`),
      pts.map((p) => (p.difference > 0 ? p.difference : 0)),
      pts.map((p) => (p.difference < 0 ? p.difference : 0)),
    );
  });

  protected readonly wasteBars = computed<BarItem[]>(() => {
    const list = this.report()?.waste.byType ?? [];
    const max = Math.max(1, ...list.map((x) => x.amount));
    return list.map((x) => ({
      key: x.type,
      label: x.type === 'WASTE' ? 'Bajas (vencido, roto, perdido)' : 'Ajustes por conteo',
      sub: `${x.count} ${x.count === 1 ? 'vez' : 'veces'}`,
      value: money(x.amount),
      pct: (x.amount / max) * 100,
      color: x.type === 'WASTE' ? '#64748b' : '#94a3b8',
    }));
  });

  protected readonly insights = computed<Insight[]>(() => {
    const r = this.report();
    if (!r) return [];
    const k = r.kpis;
    const out: Insight[] = [];
    const top = r.discountsByUser[0];
    if (top && k.discounts > 0)
      out.push({
        key: 'disc',
        icon: 'tag',
        tone: 'neutral',
        parts: [
          '',
          firstName(top.user?.fullName),
          ` dio el ${Math.round((top.amount / k.discounts) * 100)} % de los descuentos (${money(top.amount)}).`,
        ],
      });
    const dv = delta(k.voided, r.previousKpis.voided);
    if (dv.percent !== null && dv.trend !== 'flat')
      out.push({
        key: 'voids',
        icon: 'ban',
        tone: dv.trend === 'down' ? 'up' : 'down',
        parts: [
          'Las anulaciones ',
          `${dv.trend === 'up' ? 'subieron' : 'bajaron'} ${Math.abs(dv.percent)} %`,
          ' contra el período anterior.',
        ],
      });
    else if (!k.voided)
      out.push({
        key: 'voids',
        icon: 'ban',
        tone: 'up',
        parts: ['', 'Ninguna anulación', ' en el período.'],
      });
    if (k.cashSessions)
      out.push({
        key: 'cash',
        icon: 'banknote' as IconName,
        tone: k.cashWithDifference ? 'warning' : 'up',
        parts: [
          '',
          `${k.cashSessions - k.cashWithDifference} de ${k.cashSessions}`,
          ` ${k.cashSessions === 1 ? 'cierre cuadró' : 'cierres cuadraron'} exacto.`,
        ],
      });
    const waste = r.waste.byType.find((w) => w.type === 'WASTE');
    if (k.waste > 0 && waste)
      out.push({
        key: 'waste',
        icon: 'trash',
        tone: 'neutral',
        parts: [
          'El ',
          `${Math.round((waste.amount / k.waste) * 100)} %`,
          ' de las mermas fueron bajas; el resto, ajustes por conteo.',
        ],
      });
    return out.slice(0, 4);
  });
}
