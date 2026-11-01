import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import {
  COMMISSION_PERIOD_LABELS,
  CommissionPeriod,
  CommissionReport,
  Groomer,
  periodRange,
} from '../../core/services/grooming.models';
import { GroomingService } from '../../core/services/grooming.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

type Preset = Exclude<CommissionPeriod, 'custom'>;
const PRESETS = Object.keys(COMMISSION_PERIOD_LABELS) as Preset[];

/**
 * Comisiones de grooming por período. El administrador ve a todo el equipo; el groomer, lo
 * suyo. Cada servicio usa el porcentaje que el groomer tenía al entregarlo.
 */
@Component({
  selector: 'app-grooming-commissions-page',
  imports: [ReactiveFormsModule, RouterLink, FechaPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <a
        routerLink="/grooming"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <app-icon name="chevron-left" class="size-4" /> Tablero de grooming
      </a>

      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900">
            {{ isAdmin() ? 'Comisiones de grooming' : 'Mis comisiones' }}
          </h1>
          <p class="mt-1 text-sm text-slate-500">
            Sobre lo cobrado de los servicios entregados (con IGV), del {{ calendar(from()) }} al
            {{ calendar(to()) }}.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-secondary self-start sm:self-auto"
          [disabled]="downloading() || !report()?.lines?.length"
          (click)="download()"
        >
          @if (downloading()) {
            <app-icon name="loader" class="size-4 animate-spin" />
          } @else {
            <app-icon name="download" class="size-4" />
          }
          Descargar Excel
        </button>
      </div>

      <!-- Período -->
      <div class="card flex flex-col gap-4 p-4 lg:flex-row lg:items-end">
        <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Período">
          @for (p of presets; track p) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="period() === p"
              class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition-colors"
              [class]="
                period() === p
                  ? 'bg-anil-600 text-white ring-anil-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-400'
              "
              (click)="choose(p)"
            >
              {{ presetLabels[p] }}
            </button>
          }
        </div>
        <div class="grid grid-cols-2 gap-3 lg:ml-auto lg:flex">
          <div>
            <label for="cm-from" class="field-label">Desde</label>
            <input
              id="cm-from"
              type="date"
              class="field-input"
              [formControl]="fromControl"
              [max]="today"
            />
          </div>
          <div>
            <label for="cm-to" class="field-label">Hasta</label>
            <input
              id="cm-to"
              type="date"
              class="field-input"
              [formControl]="toControl"
              [max]="today"
            />
          </div>
          @if (isAdmin() && groomers().length > 1) {
            <div class="col-span-2 lg:w-56">
              <label for="cm-groomer" class="field-label">Groomer</label>
              <select id="cm-groomer" class="field-input" [formControl]="groomerControl">
                <option [ngValue]="null">Todo el equipo</option>
                @for (g of groomers(); track g.id) {
                  <option [ngValue]="g.id">{{ g.fullName }}</option>
                }
              </select>
            </div>
          }
        </div>
      </div>

      @if (loading() && !report()) {
        <div class="grid gap-4 sm:grid-cols-4" aria-busy="true" aria-label="Cargando comisiones">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="h-28 animate-pulse rounded-2xl bg-slate-100"></div>
          }
        </div>
      } @else if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
          <button type="button" class="btn btn-secondary mt-5" (click)="load()">Reintentar</button>
        </div>
      } @else if (report(); as r) {
        <!-- Totales -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4" [class.opacity-60]="loading()">
          <div class="card p-5">
            <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Servicios entregados
            </p>
            <p
              class="mt-2 font-display text-2xl font-semibold whitespace-nowrap sm:text-3xl text-slate-900 tabular-nums"
            >
              {{ r.totals.services }}
            </p>
          </div>
          <div class="card p-5">
            <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Cobrado</p>
            <p
              class="mt-2 font-display text-2xl font-semibold whitespace-nowrap sm:text-3xl text-slate-900 tabular-nums"
            >
              {{ money(r.totals.paid) }}
            </p>
          </div>
          <div class="card p-5">
            <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Por cobrar</p>
            <p
              class="mt-2 font-display text-2xl font-semibold whitespace-nowrap sm:text-3xl tabular-nums"
              [class]="r.totals.pending > 0 ? 'text-amber-700' : 'text-slate-900'"
            >
              {{ money(r.totals.pending) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Comisiona cuando se cobre</p>
          </div>
          <div class="card p-5 ring-1 ring-emerald-200">
            <p class="text-xs font-semibold tracking-wide text-emerald-700 uppercase">Comisiones</p>
            <p
              class="mt-2 font-display text-2xl font-semibold whitespace-nowrap sm:text-3xl text-emerald-700 tabular-nums"
            >
              {{ money(r.totals.commission) }}
            </p>
          </div>
        </div>

        @if (r.lines.length) {
          <!-- Por groomer -->
          @if (isAdmin()) {
            <section class="card overflow-hidden" aria-labelledby="cm-team">
              <h2
                id="cm-team"
                class="px-5 pt-5 font-display text-lg font-semibold text-slate-900 sm:px-6"
              >
                Por groomer
              </h2>
              <div class="mt-3 overflow-x-auto">
                <table class="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr
                      class="border-y border-slate-100 bg-slate-50/60 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
                    >
                      <th class="px-5 py-2.5 sm:px-6">Groomer</th>
                      <th class="px-3 py-2.5 text-right">% actual</th>
                      <th class="px-3 py-2.5 text-right">Servicios</th>
                      <th class="px-3 py-2.5 text-right">Cobrado</th>
                      <th class="px-3 py-2.5 text-right">Por cobrar</th>
                      <th class="px-5 py-2.5 text-right sm:px-6">Comisión</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (row of r.rows; track row.groomer?.id ?? 0) {
                      <tr>
                        <td class="px-5 py-3 sm:px-6">
                          @if (row.groomer) {
                            <span class="font-medium text-slate-900">{{
                              row.groomer.fullName
                            }}</span>
                            @if (row.currentPercent === null) {
                              <a
                                routerLink="/usuarios"
                                class="mt-0.5 block text-xs font-medium text-amber-700 hover:underline"
                              >
                                Sin comisión configurada
                              </a>
                            }
                          } @else {
                            <span class="font-medium text-slate-500">Sin groomer asignado</span>
                            <span class="mt-0.5 block text-xs text-slate-500"
                              >No generan comisión</span
                            >
                          }
                        </td>
                        <td class="px-3 py-3 text-right tabular-nums">
                          {{ row.currentPercent === null ? '—' : row.currentPercent + ' %' }}
                        </td>
                        <td class="px-3 py-3 text-right tabular-nums">{{ row.services }}</td>
                        <td class="px-3 py-3 text-right tabular-nums">{{ money(row.paid) }}</td>
                        <td
                          class="px-3 py-3 text-right tabular-nums"
                          [class.text-amber-700]="row.pending > 0"
                        >
                          {{ money(row.pending) }}
                        </td>
                        <td
                          class="px-5 py-3 text-right font-semibold text-slate-900 tabular-nums sm:px-6"
                        >
                          {{ money(row.commission) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }

          <!-- Detalle -->
          <section class="card overflow-hidden" aria-labelledby="cm-detail">
            <h2
              id="cm-detail"
              class="px-5 pt-5 font-display text-lg font-semibold text-slate-900 sm:px-6"
            >
              Servicios entregados
            </h2>
            <ul class="mt-2 divide-y divide-slate-100" role="list">
              @for (l of r.lines; track l.id) {
                <li>
                  <a
                    [routerLink]="['/grooming', l.id, 'constancia']"
                    class="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
                  >
                    <span
                      class="shrink-0 text-sm whitespace-nowrap text-slate-500 tabular-nums sm:w-36"
                      >{{ l.deliveredAt | fecha: 'datetime' }}</span
                    >
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-slate-900"
                        >{{ l.pet.name }} · {{ l.services }}</span
                      >
                      <span class="block truncate text-xs text-slate-500">
                        {{ l.code }} · {{ l.client.name }}
                        @if (isAdmin()) {
                          · {{ l.groomer?.fullName ?? 'Sin groomer' }}
                        }
                      </span>
                    </span>
                    <span
                      class="flex shrink-0 items-baseline gap-3 text-sm tabular-nums sm:justify-end"
                    >
                      <span class="text-slate-600">{{ money(l.paid) }}</span>
                      @if (l.pending > 0) {
                        <span
                          class="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                          >debe {{ money(l.pending) }}</span
                        >
                      }
                      <span class="text-xs text-slate-500">× {{ l.percent }} %</span>
                      <span class="w-20 text-right font-semibold text-slate-900">{{
                        money(l.commission)
                      }}</span>
                    </span>
                  </a>
                </li>
              }
            </ul>
          </section>
          <p class="text-xs text-slate-500">
            Cada servicio usa el porcentaje que el groomer tenía al entregarse: cambiarlo en
            Usuarios no altera lo ya entregado. Los productos que se venden en el grooming no
            comisionan.
          </p>
        } @else {
          <div class="card flex flex-col items-center px-6 py-14 text-center">
            <span class="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
              <app-icon name="scissors" class="size-6" />
            </span>
            <p class="mt-3 font-medium text-slate-900">
              No hay servicios entregados en este período
            </p>
            <p class="mt-1 text-sm text-slate-500">
              Elige otro período o revisa el tablero de grooming.
            </p>
          </div>
        }
      }
    </section>
  `,
})
export class GroomingCommissionsPage {
  private readonly api = inject(GroomingService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  protected readonly presets = PRESETS;
  protected readonly presetLabels = COMMISSION_PERIOD_LABELS;
  protected readonly money = money;
  protected readonly today = limaToday();
  protected readonly calendar = (day: string) => formatDate(day, 'calendar');
  protected readonly isAdmin = this.session.isAdmin;

  protected readonly period = signal<CommissionPeriod>('week');
  protected readonly from = signal(periodRange('week', this.today).from);
  protected readonly to = signal(this.today);
  protected readonly groomerId = signal<number | null>(null);
  protected readonly fromControl = new FormControl(this.from(), { nonNullable: true });
  protected readonly toControl = new FormControl(this.to(), { nonNullable: true });
  protected readonly groomerControl = new FormControl<number | null>(null);

  protected readonly report = signal<CommissionReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly downloading = signal(false);
  protected readonly groomers = signal<Groomer[]>([]);
  private readonly key = computed(() => `${this.from()}|${this.to()}|${this.groomerId() ?? ''}`);

  constructor() {
    if (this.isAdmin())
      this.api.groomers().subscribe({ next: (g) => this.groomers.set(g), error: () => undefined });
    this.fromControl.valueChanges.subscribe((v) => this.custom('from', v));
    this.toControl.valueChanges.subscribe((v) => this.custom('to', v));
    this.groomerControl.valueChanges.subscribe((v) => this.groomerId.set(v));
    effect(() => {
      this.key();
      untracked(() => this.load());
    });
  }

  protected choose(preset: Preset): void {
    const range = periodRange(preset, this.today);
    this.period.set(preset);
    this.from.set(range.from);
    this.to.set(range.to);
    this.fromControl.setValue(range.from, { emitEvent: false });
    this.toControl.setValue(range.to, { emitEvent: false });
  }

  protected load(): void {
    const from = this.from();
    const to = this.to();
    if (!from || !to || from > to) return;
    this.loading.set(true);
    this.api.commissions(from, to, this.groomerId()).subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(apiErrorMessage(error, 'No se pudieron calcular las comisiones.'));
      },
    });
  }

  protected download(): void {
    const from = this.from();
    const to = this.to();
    this.downloading.set(true);
    this.api.commissionsExcel(from, to, this.groomerId()).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `comisiones-${from}-a-${to}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error: unknown) => {
        this.downloading.set(false);
        this.toast.error(apiErrorMessage(error, 'No se pudo generar el Excel.'));
      },
    });
  }

  private custom(edge: 'from' | 'to', value: string): void {
    if (!value) return;
    this.period.set('custom');
    if (edge === 'from') this.from.set(value);
    else this.to.set(value);
    if (this.from() > this.to()) this.toast.error('La fecha inicial va antes que la final.');
  }
}
