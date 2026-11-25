import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  categoryLabel,
  compactMoney,
  expiryLabel,
  monthLabel,
  shortDay,
  stockLabel,
} from '../../core/services/reports.models';
import { ReportsService } from '../../core/services/reports.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { ReportsHeaderComponent } from './reports-header.component';
import { EchartComponent } from './ui/echart.component';
import { COLORS, bars, moneyTreemap } from './ui/report-charts';
import {
  ReportEmptyComponent,
  ReportErrorComponent,
  ReportSkeletonComponent,
} from './ui/report-states';
import {
  Insight,
  InsightsComponent,
  MoreLinkComponent,
  RankItem,
  RankListComponent,
  ReportCardComponent,
} from './ui/report-ui';

/** Más de esto es plata parada */
const SLOW_DAYS = 90;
const WEEKS = [
  { label: 'Vencido', from: -100000, to: -1 },
  { label: 'Esta sem.', from: 0, to: 6 },
  { label: '2.ª sem.', from: 7, to: 13 },
  { label: '3.ª sem.', from: 14, to: 20 },
  { label: '4.ª sem.', from: 21, to: 27 },
  { label: '5–6 sem.', from: 28, to: 41 },
  { label: '7–8 sem.', from: 42, to: 60 },
];

/** Inventario valorizado: dónde está la plata del almacén hoy, qué vence y qué no se mueve. */
@Component({
  selector: 'app-inventory-report-page',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    IconComponent,
    ModalComponent,
    ReportsHeaderComponent,
    EchartComponent,
    ReportCardComponent,
    RankListComponent,
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
      <app-reports-header description="Valor del almacén hoy, a costo de compra (sin IGV)" />

      @if (res.error() && !data()) {
        <app-report-error [message]="errorText()" (retry)="res.reload()" />
      } @else if (!data()) {
        <app-report-skeleton label="Cargando el inventario" />
      } @else {
        @let r = data()!;
        <div class="space-y-4">
          <ul class="grid grid-cols-2 gap-3 @4xl:grid-cols-4" aria-label="Totales">
            @for (k of kpis(); track k.label) {
              <li>
                <a
                  [routerLink]="k.link"
                  [queryParams]="k.query"
                  [fragment]="k.fragment"
                  class="card flex h-full flex-col p-4 transition-shadow hover:shadow-md"
                >
                  <span class="flex items-center justify-between gap-2">
                    <span class="text-[13px] font-semibold text-slate-600">{{ k.label }}</span>
                    <span
                      class="grid size-8 shrink-0 place-items-center rounded-xl"
                      [class]="k.tone"
                      aria-hidden="true"
                      ><app-icon [name]="k.icon" class="size-4"
                    /></span>
                  </span>
                  <b
                    class="mt-1 block font-display text-[22px] font-semibold whitespace-nowrap tabular-nums"
                    [class]="k.valueTone"
                    >{{ money(k.value) }}</b
                  >
                  <span class="text-xs text-slate-500">{{ k.detail }}</span>
                  <span
                    class="mt-auto inline-flex items-center gap-1 pt-2 text-[13px] font-semibold text-anil-700"
                    >{{ k.cta }} <app-icon name="chevron-right" class="size-3.5"
                  /></span>
                </a>
              </li>
            }
          </ul>
          @if (r.inactiveWithStock) {
            <p
              class="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700"
            >
              <app-icon name="info" class="size-4 shrink-0" />
              <span class="flex-1"
                >Incluye {{ r.inactiveWithStock }}
                {{ r.inactiveWithStock === 1 ? 'producto desactivado' : 'productos desactivados' }}
                que aún {{ r.inactiveWithStock === 1 ? 'tiene' : 'tienen' }} stock: la plata sigue
                en el almacén.</span
              >
              <a
                routerLink="/inventario"
                [queryParams]="{ estado: 'inactivos' }"
                class="font-semibold whitespace-nowrap text-anil-700 hover:underline"
                >Ver ›</a
              >
            </p>
          }

          @if (!r.totals.products) {
            <app-report-empty
              heading="No hay productos con stock"
              text="El valor aparece al registrar compras con su costo."
              icon="package"
            >
              <a routerLink="/inventario/compras/nueva" class="btn btn-primary">Registrar compra</a>
            </app-report-empty>
          } @else {
            <app-insights [items]="insights()" />

            <div class="grid gap-4 @4xl:grid-cols-[1.25fr_1fr]">
              <app-report-card
                heading="Dónde está tu dinero"
                subtitle="Valor por categoría: el tamaño es la plata invertida."
              >
                <app-echart [option]="treeOption()" [label]="treeLabel()" [height]="250" />
                <ul class="sr-only">
                  @for (c of treeItems(); track c.name) {
                    <li>{{ c.name }}: {{ money(c.value) }}</li>
                  }
                </ul>
              </app-report-card>
              <app-report-card
                heading="Qué vence y cuándo"
                subtitle="Valor de los lotes por semana, las próximas 8 semanas."
              >
                <ul class="grid grid-cols-7 gap-1" role="list">
                  @for (w of weeks(); track w.label) {
                    <li
                      class="flex flex-col items-center gap-1.5 text-center"
                      [attr.aria-label]="w.label + ': ' + (w.value ? money(w.value) : 'nada')"
                    >
                      <span
                        class="text-[11px] font-semibold whitespace-nowrap text-slate-900 tabular-nums"
                        >{{ w.value ? compact(w.value) : '—' }}</span
                      >
                      <span
                        class="flex h-24 w-full items-end overflow-hidden rounded-lg bg-slate-50"
                        aria-hidden="true"
                      >
                        <i
                          class="block w-full rounded-lg"
                          [style.height.%]="w.pct"
                          [style.background]="w.color"
                        ></i>
                      </span>
                      <span class="text-[11px] leading-tight text-slate-500">{{ w.label }}</span>
                    </li>
                  }
                </ul>
                @if (urgent(); as u) {
                  <p class="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    {{ u.lead }} <b>{{ u.name }}</b> ({{ u.detail }}): {{ u.tail }}
                  </p>
                } @else {
                  <p class="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                    Nada vence en los próximos 60 días.
                  </p>
                }
              </app-report-card>
            </div>

            <div class="grid gap-4 @4xl:grid-cols-[1.25fr_1fr]">
              <app-report-card
                heading="Entradas y salidas"
                subtitle="Compras y salidas (ventas, usos y bajas) por mes, a costo. La línea es el valor del almacén."
              >
                <app-echart
                  [option]="flowsOption()"
                  label="Compras y salidas por mes, con el valor del almacén"
                  [height]="240"
                />
                <p
                  class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"
                  aria-hidden="true"
                >
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="size-2.5 rounded-sm" [style.background]="colors.service"></i
                    >Compras</span
                  >
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="size-2.5 rounded-sm" [style.background]="colors.product"></i
                    >Salidas</span
                  >
                  <span class="inline-flex items-center gap-1.5"
                    ><i class="w-4 border-t-2 border-slate-900"></i>Valor del almacén</span
                  >
                </p>
              </app-report-card>
              <app-report-card
                heading="¿Para cuántos días te alcanza?"
                [subtitle]="
                  'Al ritmo de salidas de los últimos 90 días. Más de ' +
                  slow +
                  ' días es plata parada.'
                "
              >
                <ng-container
                  *ngTemplateOutlet="coverageList; context: { $implicit: coverage().slice(0, 8) }"
                />
                @if (coverage().length > 8) {
                  <app-more-link
                    [text]="'Ver las ' + coverage().length + ' categorías'"
                    (pressed)="modal.set('coverage')"
                  />
                }
                <p class="mt-2 text-right text-xs text-slate-500">┆ {{ slow }} días</p>
              </app-report-card>
            </div>

            <div class="grid gap-4 @4xl:grid-cols-[1.1fr_1fr]">
              <app-report-card
                heading="Productos con más valor"
                subtitle="Dónde está la plata del almacén, producto por producto."
              >
                <app-rank-list [items]="topProducts().slice(0, 6)" />
                @if (topProducts().length > 6) {
                  <app-more-link
                    [text]="'Ver los ' + (topProducts().length - 6) + ' restantes'"
                    (pressed)="modal.set('products')"
                  />
                }
              </app-report-card>
              <div class="flex flex-col gap-4">
                <app-report-card
                  heading="Por reponer"
                  subtitle="Bajo el mínimo, con cuánto se mueve. “Pedir” abre el producto para registrar la compra."
                >
                  @if (r.lowStockProducts.length) {
                    <ul class="divide-y divide-slate-100">
                      @for (p of r.lowStockProducts.slice(0, 5); track p.id) {
                        <li class="flex items-center gap-3 py-2.5">
                          <span
                            class="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"
                            aria-hidden="true"
                            ><app-icon name="shopping-cart" class="size-4"
                          /></span>
                          <span class="min-w-0 flex-1">
                            <b class="line-clamp-2 text-sm font-medium text-slate-900">{{
                              p.name
                            }}</b>
                            <span class="text-xs text-slate-500"
                              >Quedan {{ stock(p.stock, p.unit) }} · mínimo {{ p.minStock }}</span
                            >
                          </span>
                          <span class="shrink-0 text-right">
                            <a
                              [routerLink]="['/inventario', p.id]"
                              class="text-sm font-semibold text-anil-700 hover:underline"
                              >Pedir</a
                            >
                            <span class="block text-xs text-slate-500">{{
                              p.weeklyOut ? '~' + p.weeklyOut + ' por semana' : 'sin salidas'
                            }}</span>
                          </span>
                        </li>
                      }
                    </ul>
                    @if (r.totals.lowStock > 5) {
                      <app-more-link
                        [text]="'Ver los ' + r.totals.lowStock + ' en Inventario'"
                        link="/inventario"
                        [query]="{ filtro: 'low' }"
                      />
                    }
                  } @else {
                    <p class="flex items-center gap-2 text-sm text-emerald-700">
                      <app-icon name="check" class="size-4" /> Nada bajo el mínimo.
                    </p>
                  }
                </app-report-card>
                <app-report-card
                  id="sin-movimiento"
                  heading="Sin movimiento"
                  [subtitle]="
                    'Sin salidas en ' +
                    r.idleDays +
                    ' días: capital parado. Considera una promoción.'
                  "
                >
                  @if (r.idle.length) {
                    <ul class="divide-y divide-slate-100">
                      @for (p of r.idle.slice(0, idleAll() ? 999 : 5); track p.id) {
                        <li class="flex items-center gap-3 py-2.5">
                          <span
                            class="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"
                            aria-hidden="true"
                            ><app-icon name="history" class="size-4"
                          /></span>
                          <span class="min-w-0 flex-1">
                            <a
                              [routerLink]="['/inventario', p.id]"
                              class="line-clamp-2 text-sm font-medium text-slate-900 hover:text-anil-700"
                              >{{ p.name }}</a
                            >
                            <span class="text-xs text-slate-500"
                              >{{ stock(p.stock, p.unit) }} ·
                              {{
                                p.lastOutAt ? 'última salida ' + date(p.lastOutAt) : 'nunca salió'
                              }}</span
                            >
                          </span>
                          <b
                            class="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums"
                            >{{ money(p.value) }}</b
                          >
                        </li>
                      }
                    </ul>
                    @if (r.idle.length > 5 && !idleAll()) {
                      <app-more-link
                        [text]="'Ver los ' + (r.idle.length - 5) + ' restantes'"
                        (pressed)="idleAll.set(true)"
                      />
                    }
                  } @else {
                    <p class="flex items-center gap-2 text-sm text-emerald-700">
                      <app-icon name="check" class="size-4" /> Todo se movió en los últimos
                      {{ r.idleDays }} días.
                    </p>
                  }
                </app-report-card>
              </div>
            </div>

            <app-report-card
              heading="Lotes por vencer"
              subtitle="Vencidos y los que vencen en 60 días, del más urgente al menos urgente. Toca uno para abrir el producto."
            >
              @if (r.risk.length) {
                <table class="hidden w-full text-sm @2xl:table">
                  <caption class="sr-only">
                    Lotes vencidos y por vencer
                  </caption>
                  <thead>
                    <tr
                      class="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
                    >
                      <th scope="col" class="py-2 font-semibold">Producto</th>
                      <th scope="col" class="py-2 pl-3 font-semibold">Lote</th>
                      <th scope="col" class="py-2 pl-3 font-semibold">Vence</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Quedan</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Valor</th>
                      <th scope="col" class="py-2 pl-3 text-right font-semibold">Qué hacer</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (b of lots(); track b.batchId) {
                      <tr class="border-b border-slate-100">
                        <td class="py-2.5">
                          <a
                            [routerLink]="['/inventario', b.product.id]"
                            class="font-medium text-slate-900 hover:text-anil-700"
                            >{{ b.product.name }}</a
                          >
                        </td>
                        <td class="py-2.5 pl-3 text-slate-600 tabular-nums">
                          {{ b.lotNumber || '—' }}
                        </td>
                        <td class="py-2.5 pl-3">
                          <b
                            class="block font-medium"
                            [class]="b.days < 0 ? 'text-rose-700' : 'text-slate-900'"
                            >{{ date(b.expiresAt) }}</b
                          >
                          <span class="text-xs text-slate-500">{{ expiry(b.days) }}</span>
                        </td>
                        <td class="py-2.5 pl-3 text-right whitespace-nowrap tabular-nums">
                          {{ stock(b.quantity, b.product.unit) }}
                        </td>
                        <td
                          class="py-2.5 pl-3 text-right font-semibold whitespace-nowrap tabular-nums"
                        >
                          {{ b.value === null ? 'Sin costo' : money(b.value) }}
                        </td>
                        <td class="py-2.5 pl-3 text-right">
                          <span
                            class="rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                            [class]="action(b.days).tone"
                            >{{ action(b.days).text }}</span
                          >
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
                <ul class="divide-y divide-slate-100 @2xl:hidden">
                  @for (b of lots(); track b.batchId) {
                    <li class="flex items-center gap-3 py-2.5">
                      <span class="min-w-0 flex-1">
                        <a
                          [routerLink]="['/inventario', b.product.id]"
                          class="line-clamp-2 text-sm font-medium text-slate-900"
                          >{{ b.product.name }}</a
                        >
                        <span class="text-xs text-slate-500"
                          >Lote {{ b.lotNumber || '—' }} ·
                          {{ stock(b.quantity, b.product.unit) }}</span
                        >
                      </span>
                      <span class="shrink-0 text-right">
                        <b
                          class="block text-sm font-semibold whitespace-nowrap tabular-nums"
                          [class.text-rose-700]="b.days < 0"
                          >{{ b.value === null ? 'Sin costo' : money(b.value) }}</b
                        >
                        <span
                          class="text-xs whitespace-nowrap"
                          [class]="b.days < 0 ? 'text-rose-700' : 'text-slate-500'"
                          >{{ expiry(b.days) }}</span
                        >
                      </span>
                    </li>
                  }
                </ul>
                @if (r.risk.length > 8 && !lotsAll()) {
                  <app-more-link
                    [text]="'Ver los ' + (r.risk.length - 8) + ' restantes'"
                    (pressed)="lotsAll.set(true)"
                  />
                }
              } @else {
                <p class="flex items-center gap-2 text-sm text-emerald-700">
                  <app-icon name="check" class="size-4" /> Nada vencido ni por vencer en 60 días.
                </p>
              }
            </app-report-card>
          }
        </div>
      }
    </div>

    <app-modal
      [open]="modal() !== null"
      [title]="modal() === 'products' ? 'Productos con más valor' : '¿Para cuántos días alcanza?'"
      size="lg"
      (closed)="modal.set(null)"
    >
      @if (modal() === 'products') {
        <app-rank-list [items]="topProducts()" />
      } @else if (modal() === 'coverage') {
        <ng-container *ngTemplateOutlet="coverageList; context: { $implicit: coverage() }" />
      }
    </app-modal>
    <ng-template #coverageList let-rows>
      <ul class="space-y-2.5">
        @for (c of rows; track c.category) {
          <li>
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="font-medium text-slate-900">{{ c.label }}</span>
              <b
                class="font-semibold whitespace-nowrap tabular-nums"
                [class.text-rose-700]="c.slow"
                >{{ c.text }}</b
              >
            </div>
            <div class="relative mt-1.5 h-2 rounded-full bg-slate-100" aria-hidden="true">
              <i
                class="absolute inset-y-0 left-0 rounded-full"
                [style.width.%]="c.pct"
                [style.background]="c.slow ? colors.red : '#5a5ee0'"
              ></i>
              <i
                class="absolute -inset-y-1 border-l-[1.5px] border-dashed border-slate-400"
                [style.left.%]="markPct()"
              ></i>
            </div>
          </li>
        }
      </ul>
    </ng-template>
  `,
})
export class InventoryReportPage {
  private readonly api = inject(ReportsService);
  protected readonly money = money;
  protected readonly compact = compactMoney;
  protected readonly colors = COLORS;
  protected readonly slow = SLOW_DAYS;
  protected readonly stock = stockLabel;
  protected readonly expiry = expiryLabel;
  protected readonly date = (d: string) => shortDay(d.slice(0, 10));

  protected readonly modal = signal<'products' | 'coverage' | null>(null);
  protected readonly idleAll = signal(false);
  protected readonly lotsAll = signal(false);

  protected readonly res = rxResource({ stream: () => this.api.inventory() });
  /** Con error, value() lanza: se lee solo si hay datos */
  protected readonly data = computed(() => (this.res.hasValue() ? this.res.value() : undefined));
  protected readonly errorText = computed(() =>
    apiErrorMessage(this.res.error(), 'Revisa tu conexión e inténtalo de nuevo.'),
  );

  protected readonly kpis = computed(() => {
    const r = this.data();
    if (!r) return [];
    const t = r.totals;
    const lots = (level: string) => r.risk.filter((b) => b.level === level).length;
    const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
    return [
      {
        label: 'Valor del inventario',
        value: t.value,
        detail: n(t.products, 'producto con stock', 'productos con stock'),
        icon: 'package' as IconName,
        tone: 'bg-anil-50 text-anil-700',
        valueTone: 'text-slate-900',
        cta: 'Ver productos',
        link: '/inventario',
        query: null,
        fragment: undefined,
      },
      {
        label: 'Vencido',
        value: t.expired,
        detail: `${n(lots('EXPIRED'), 'lote', 'lotes')} · retirar y dar de baja`,
        icon: 'alert' as IconName,
        tone: 'bg-rose-50 text-rose-600',
        valueTone: t.expired ? 'text-rose-700' : 'text-slate-900',
        cta: 'Ver lotes',
        link: '/inventario',
        query: { filtro: 'expired' },
        fragment: undefined,
      },
      {
        label: 'Vence en 30 días',
        value: t.expiring30,
        detail: `${n(lots('RED'), 'lote', 'lotes')} · úsalos primero`,
        icon: 'clock' as IconName,
        tone: 'bg-amber-50 text-amber-700',
        valueTone: t.expiring30 ? 'text-amber-700' : 'text-slate-900',
        cta: 'Ver lotes',
        link: '/inventario',
        query: { filtro: 'exp30' },
        fragment: undefined,
      },
      {
        label: 'Sin movimiento',
        value: t.idle,
        detail: `${n(r.idle.length, 'producto', 'productos')} en ${r.idleDays} días`,
        icon: 'history' as IconName,
        tone: 'bg-slate-100 text-slate-600',
        valueTone: 'text-slate-900',
        cta: 'Ver la lista',
        link: '/reportes/inventario',
        query: null,
        fragment: 'sin-movimiento',
      },
    ];
  });

  /** Las 5 categorías más grandes y el resto junto en “Otras” */
  protected readonly treeItems = computed(() => {
    const list = (this.data()?.categories ?? []).filter((c) => c.value > 0);
    const top = list
      .slice(0, 6)
      .map((c) => ({ name: categoryLabel('PRODUCT', c.category), value: c.value }));
    if (list.length > 6) {
      const rest = list.slice(5);
      top.splice(5, 1, {
        name: `Otras (${rest.length})`,
        value: Math.round(rest.reduce((s, c) => s + c.value, 0) * 100) / 100,
      });
    }
    return top;
  });
  protected readonly treeOption = computed(() => moneyTreemap(this.treeItems()));
  protected readonly treeLabel = computed(() => {
    const t = this.treeItems()[0];
    const total = this.data()?.totals.value || 1;
    return t
      ? `Valor por categoría. La más grande: ${t.name}, ${Math.round((t.value / total) * 100)} % del almacén.`
      : 'Valor por categoría';
  });

  protected readonly weeks = computed(() => {
    const risk = this.data()?.risk ?? [];
    const values = WEEKS.map((w) =>
      risk
        .filter((b) => b.days >= w.from && b.days <= w.to)
        .reduce((s, b) => s + (b.value ?? 0), 0),
    );
    const max = Math.max(1, ...values);
    return WEEKS.map((w, i) => ({
      label: w.label,
      value: Math.round(values[i] * 100) / 100,
      pct: values[i] ? Math.max(6, (values[i] / max) * 100) : 0,
      color: i === 0 ? COLORS.red : i < 5 ? COLORS.product : '#fbbf24',
    }));
  });
  protected readonly urgent = computed(() => {
    const risk = this.data()?.risk ?? [];
    const b = risk.find((x) => x.days >= 0) ?? risk[0];
    if (!b) return null;
    const qty = stockLabel(b.quantity, b.product.unit);
    const detail = b.value === null ? qty : `${qty}, ${money(b.value)}`;
    if (b.days < 0)
      return { lead: 'Ya venció', name: b.product.name, detail, tail: 'retíralo y dalo de baja.' };
    const when =
      b.days === 0
        ? 'Hoy vence'
        : b.days < 7
          ? 'Esta semana vence'
          : `En ${Math.ceil(b.days / 7)} semanas vence`;
    return {
      lead: when,
      name: b.product.name,
      detail,
      tail: 'úsalo primero o pide cambio al proveedor.',
    };
  });

  protected readonly flowsOption = computed(() => {
    const flows = this.data()?.flows ?? [];
    const crosses =
      flows.length > 0 && flows[0].month.slice(0, 4) !== flows[flows.length - 1].month.slice(0, 4);
    return bars(
      flows.map((f, i) => monthLabel(f.month, crosses && (i === 0 || f.month.endsWith('-01')))),
      [
        { name: 'Compras', data: flows.map((f) => f.purchases), color: COLORS.service },
        { name: 'Salidas', data: flows.map((f) => f.outflows), color: COLORS.product },
      ],
      {
        titles: flows.map((f) => monthLabel(f.month, true)),
        highlight: flows.length - 1,
        line: {
          name: 'Valor del almacén',
          data: flows.map((f) => f.value),
          color: '#0f172a',
          format: (v) => compactMoney(v),
        },
      },
    );
  });

  protected readonly coverage = computed(() => {
    const list = this.data()?.coverage ?? [];
    const max = Math.max(SLOW_DAYS * 1.6, ...list.map((c) => Math.min(c.days ?? 0, 365)));
    return list.map((c) => ({
      category: c.category,
      label: categoryLabel('PRODUCT', c.category),
      text: c.days === null ? 'sin salidas' : c.days > 365 ? 'más de 1 año' : `${c.days} días`,
      slow: c.days === null || c.days > SLOW_DAYS,
      pct: c.days === null ? 100 : Math.max(3, (Math.min(c.days, 365) / max) * 100),
    }));
  });
  protected readonly markPct = computed(() => {
    const list = this.data()?.coverage ?? [];
    const max = Math.max(SLOW_DAYS * 1.6, ...list.map((c) => Math.min(c.days ?? 0, 365)));
    return (SLOW_DAYS / max) * 100;
  });

  protected readonly topProducts = computed<RankItem[]>(() => {
    const list = (this.data()?.products ?? []).filter((p) => p.value > 0);
    const max = Math.max(1, ...list.map((p) => p.value));
    return list.map((p, i) => ({
      key: p.id,
      lead: { rank: i + 1 },
      name: p.name,
      sub: `${stockLabel(p.stock, p.unit)} · ${categoryLabel('PRODUCT', p.category)}${p.active ? '' : ' · desactivado'}`,
      pct: (p.value / max) * 100,
      value: money(p.value),
      link: ['/inventario', p.id],
    }));
  });

  protected readonly lots = computed(() => {
    const risk = this.data()?.risk ?? [];
    return this.lotsAll() ? risk : risk.slice(0, 8);
  });
  protected action(days: number): { text: string; tone: string } {
    if (days < 0) return { text: 'Dar de baja', tone: 'bg-rose-50 text-rose-700' };
    if (days <= 30) return { text: 'Usar primero', tone: 'bg-amber-50 text-amber-800' };
    return { text: 'Vigilar', tone: 'bg-slate-100 text-slate-600' };
  }

  protected readonly insights = computed<Insight[]>(() => {
    const r = this.data();
    if (!r || !r.totals.value) return [];
    const t = r.totals;
    const out: Insight[] = [];
    const risk = t.expired + t.expiring30 + t.expiring60 + t.idle;
    if (risk > 0)
      out.push({
        key: 'risk',
        icon: 'alert',
        tone: 'down',
        parts: [
          '',
          `${money(risk)} (${Math.round((risk / t.value) * 100)} %)`,
          ' está en riesgo: vencido, por vencer o parado.',
        ],
      });
    const top = r.categories[0];
    if (top)
      out.push({
        key: 'top',
        icon: 'package',
        tone: 'neutral',
        parts: [
          '',
          categoryLabel('PRODUCT', top.category),
          ` concentra el ${Math.round((top.value / t.value) * 100)} % del dinero del almacén.`,
        ],
      });
    if (t.lowStock)
      out.push({
        key: 'low',
        icon: 'shopping-cart',
        tone: 'warning',
        parts: [
          '',
          `${t.lowStock} ${t.lowStock === 1 ? 'producto está' : 'productos están'}`,
          ' bajo el mínimo.',
        ],
      });
    const withDays = r.coverage.filter((c) => c.days);
    const daily = withDays.reduce((s, c) => s + c.value / (c.days as number), 0);
    if (daily > 0)
      out.push({
        key: 'turn',
        icon: 'refresh',
        tone: 'up',
        parts: [
          'El almacén se renueva cada ',
          `${Math.round(t.value / daily)} días`,
          ' en promedio.',
        ],
      });
    return out.slice(0, 4);
  });
}
