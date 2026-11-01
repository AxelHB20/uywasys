import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES } from '../../core/services/clients.models';
import {
  ESTIMATE_STATUS_LABELS,
  Estimate,
  EstimateStatus,
} from '../../core/services/estimates.models';
import { EstimatesService } from '../../core/services/estimates.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { SPECIES_ICONS } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

type Filter = 'OPEN' | 'ACCEPTED' | 'CONVERTED' | '';

export const ESTIMATE_TONE: Record<EstimateStatus, BadgeTone> = {
  PENDING: 'warning',
  ACCEPTED: 'info',
  CONVERTED: 'success',
  REJECTED: 'neutral',
  EXPIRED: 'danger',
};

/** Presupuestos: los que esperan respuesta, los aceptados por cargar y el historial. */
@Component({
  selector: 'app-estimates-page',
  imports: [RouterLink, FechaPipe, BadgeComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-5">
      <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900">Presupuestos</h1>
          <p class="mt-1 text-sm text-slate-600">
            Cirugías y tratamientos con precio cerrado. Aceptados, se cargan a la atención.
          </p>
        </div>
        @if (canEdit()) {
          <a routerLink="/presupuestos/nuevo" class="btn btn-primary self-start sm:self-auto">
            <app-icon name="plus" class="size-4" /> Nuevo presupuesto
          </a>
        }
      </header>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Estado">
          @for (f of filters; track f.value) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="filter() === f.value"
              class="h-9 rounded-lg px-3.5 text-sm font-medium transition-colors sm:px-4"
              [class]="
                filter() === f.value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              "
              (click)="filter.set(f.value)"
            >
              {{ f.label }}
            </button>
          }
        </div>
        @if (items().length) {
          <p class="text-sm text-slate-600">
            {{ items().length }} {{ items().length === 1 ? 'presupuesto' : 'presupuestos' }} ·
            <span class="font-medium text-slate-900 tabular-nums">{{ money(sum()) }}</span>
          </p>
        }
      </div>

      <div class="card overflow-hidden">
        @if (list.isLoading() && !list.value()) {
          <div class="space-y-3 p-6" aria-busy="true" aria-label="Cargando presupuestos">
            @for (n of [1, 2, 3]; track n) {
              <div class="h-14 animate-pulse rounded-xl bg-slate-100"></div>
            }
          </div>
        } @else if (list.error()) {
          <div class="flex flex-col items-center px-6 py-12 text-center">
            <app-icon name="alert" class="size-8 text-rose-600" />
            <p class="mt-3 font-medium text-slate-900">{{ errorText() }}</p>
            <button type="button" class="btn btn-secondary mt-5" (click)="list.reload()">
              Reintentar
            </button>
          </div>
        } @else if (items().length) {
          <ul class="divide-y divide-slate-100" role="list">
            @for (e of items(); track e.id) {
              <li>
                <a
                  [routerLink]="['/presupuestos', e.id]"
                  class="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 focus-visible:bg-slate-50 sm:px-6"
                >
                  <span
                    class="grid size-10 shrink-0 place-items-center rounded-xl bg-anil-50 text-anil-600"
                    aria-hidden="true"
                  >
                    <app-icon [name]="speciesIcons[e.pet.species]" class="size-5" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span class="font-semibold text-slate-900">{{ e.title }}</span>
                      <app-badge [tone]="tone[e.status]">{{ labels[e.status] }}</app-badge>
                    </p>
                    <p class="mt-0.5 truncate text-sm text-slate-500">
                      {{ e.code }} · {{ e.pet.name }} · {{ e.client.name }}
                    </p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="font-semibold text-slate-900 tabular-nums">{{ money(e.total) }}</p>
                    <p class="text-xs text-slate-500">
                      @if (e.status === 'PENDING' || e.status === 'EXPIRED') {
                        vence {{ e.validUntil | fecha: 'calendar' }}
                      } @else {
                        {{ e.createdAt | fecha }}
                      }
                    </p>
                  </div>
                  <app-icon
                    name="chevron-right"
                    class="size-4 shrink-0 text-slate-400 max-sm:hidden"
                  />
                </a>
              </li>
            }
          </ul>
        } @else {
          <div class="flex flex-col items-center px-6 py-14 text-center">
            <span class="grid size-12 place-items-center rounded-2xl bg-anil-50 text-anil-600">
              <app-icon name="clipboard-list" class="size-6" />
            </span>
            <p class="mt-3 font-medium text-slate-900">{{ emptyText() }}</p>
            <p class="mt-1 max-w-sm text-sm text-slate-500">
              Arma el presupuesto con los servicios y productos del catálogo, imprímelo o envíalo
              por WhatsApp.
            </p>
          </div>
        }
      </div>
    </section>
  `,
})
export class EstimatesPage {
  private readonly api = inject(EstimatesService);
  private readonly session = inject(SessionService);

  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'OPEN', label: 'Abiertos' },
    { value: 'ACCEPTED', label: 'Por cargar' },
    { value: 'CONVERTED', label: 'Cargados' },
    { value: '', label: 'Todos' },
  ];
  protected readonly labels = ESTIMATE_STATUS_LABELS;
  protected readonly tone = ESTIMATE_TONE;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly money = money;
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );

  protected readonly filter = signal<Filter>('OPEN');
  protected readonly list = rxResource({
    params: () => ({ status: this.filter() }),
    stream: ({ params }) => this.api.list({ status: params.status }),
  });
  protected readonly items = computed<Estimate[]>(() => this.list.value() ?? []);
  protected readonly sum = computed(
    () => Math.round(this.items().reduce((s, e) => s + e.total * 100, 0)) / 100,
  );
  protected readonly emptyText = computed(
    () =>
      ({
        OPEN: 'No hay presupuestos esperando respuesta.',
        ACCEPTED: 'No hay presupuestos aceptados por cargar.',
        CONVERTED: 'Todavía no se cargó ningún presupuesto.',
        '': 'Todavía no hay presupuestos.',
      })[this.filter()],
  );

  protected errorText(): string {
    return apiErrorMessage(this.list.error(), 'No se pudieron cargar los presupuestos.');
  }
}
