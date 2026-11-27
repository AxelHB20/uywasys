import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SPECIES_LABELS } from '../../core/services/clients.models';
import {
  statusLabel,
  HospitalizationCard,
  relativeTime,
  temperatureFlag,
  whenOf,
} from '../../core/services/hospitalization.models';
import { HospitalizationService } from '../../core/services/hospitalization.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { apiErrorMessage } from '../../shared/utils/validators';
import { SPECIES_ICONS } from '../../shared/utils/records';

const REFRESH_MS = 60_000;

/**
 * Tablero de hospitalización: cada internado con su jaula, días, dosis atrasadas, la próxima
 * que toca y sus últimos signos. Se actualiza solo cada minuto.
 */
@Component({
  selector: 'app-hospitalization-board',
  imports: [RouterLink, IconComponent, FechaPipe, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900">Hospitalización</h1>
          <p class="mt-1 text-sm text-slate-600">
            Pacientes internados, su hoja de tratamiento y lo que toca a cada hora.
          </p>
        </div>
        <p class="text-xs text-slate-600" aria-live="polite">
          @if (updatedAt(); as t) {
            Actualizado {{ t | fecha: 'time' }} · se actualiza solo
          }
        </p>
      </header>

      @if (loading() && !cards().length) {
        <div
          class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-label="Cargando internados"
        >
          @for (i of [1, 2, 3]; track i) {
            <div class="card h-56 animate-pulse bg-slate-50"></div>
          }
        </div>
      } @else if (error(); as e) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ e }}</p>
          <button type="button" class="btn btn-secondary mt-5" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <!-- Resumen en una línea: lo urgente lleva al paciente -->
        @if (active().length) {
          <p
            class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
            aria-label="Resumen de hospitalización"
          >
            <span class="font-medium text-slate-900">
              <span class="font-display text-lg font-semibold tabular-nums">{{
                active().length
              }}</span>
              {{ active().length === 1 ? 'internado' : 'internados' }}
            </span>
            @if (overdue(); as n) {
              <a
                [routerLink]="['/hospitalizacion', active()[0].id]"
                [queryParams]="{ registrar: 1 }"
                class="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-rose-50 px-3 font-medium text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100"
              >
                <app-icon name="alert" class="size-4" /> {{ n }}
                {{ n === 1 ? 'dosis atrasada' : 'dosis atrasadas' }}
              </a>
            }
            @if (due(); as n) {
              <span
                class="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-50 px-3 font-medium text-amber-900 ring-1 ring-amber-200"
              >
                <app-icon name="clock" class="size-4" /> {{ n }}
                {{ n === 1 ? 'toca ahora' : 'tocan ahora' }}
              </span>
            }
            @if (!overdue() && !due()) {
              <span class="inline-flex items-center gap-1.5 text-emerald-800">
                <app-icon name="check" class="size-4" /> Todo al día
              </span>
            }
          </p>
        }

        @if (!active().length) {
          <div class="card flex flex-col items-center px-6 py-14 text-center">
            <span class="grid size-14 place-items-center rounded-2xl bg-anil-50 text-anil-600">
              <app-icon name="bed" class="size-7" />
            </span>
            <p class="mt-4 font-display text-lg font-semibold text-slate-900">
              No hay pacientes internados
            </p>
            <p class="mt-1 max-w-md text-sm text-slate-600">
              Para internar, abre la consulta del paciente y usa <strong>Internar</strong>. Aquí
              verás sus indicaciones, las dosis que tocan y sus signos vitales.
            </p>
            <a routerLink="/atenciones" class="btn btn-secondary mt-5">Ir a atenciones</a>
          </div>
        } @else {
          <ul
            class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="Pacientes internados"
          >
            @for (c of active(); track c.id) {
              <li class="min-w-0">
                <!-- Toda la tarjeta abre la hoja; "Registrar" va encima, aparte -->
                <article
                  class="card relative flex h-full flex-col p-5 transition-shadow hover:shadow-md"
                  [class.ring-rose-300]="c.overdue > 0"
                >
                  <div class="flex items-start gap-3">
                    <div class="min-w-0 flex-1">
                      <p class="flex items-center gap-2">
                        <a
                          [routerLink]="['/hospitalizacion', c.id]"
                          class="truncate font-display text-lg font-semibold text-slate-900 after:absolute after:inset-0 after:rounded-2xl hover:text-anil-700 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-anil-500"
                          >{{ c.pet.name }}</a
                        >
                      </p>
                      <p class="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
                        <app-icon
                          [name]="icons[c.pet.species]"
                          class="size-4 shrink-0 text-slate-500"
                        />
                        {{ species[c.pet.species]
                        }}{{ c.pet.weightKg ? ' · ' + c.pet.weightKg + ' kg' : '' }}
                      </p>
                      <p class="truncate text-sm text-slate-600">{{ c.client.name }}</p>
                    </div>
                    <span class="shrink-0 text-right">
                      <span class="block text-sm font-semibold text-slate-900"
                        >Día {{ c.days }}</span
                      >
                      <span class="block text-xs text-slate-600">{{ c.code }}</span>
                    </span>
                  </div>

                  <p class="mt-3 line-clamp-2 text-sm text-slate-800">
                    {{ c.diagnosis || c.reason }}
                  </p>

                  @if (c.pet.aggressive || c.pet.allergies) {
                    <p class="mt-2 flex flex-wrap gap-1.5">
                      @if (c.pet.aggressive) {
                        <app-badge tone="danger">Agresivo</app-badge>
                      }
                      @if (c.pet.allergies) {
                        <app-badge tone="warning">Alergias: {{ c.pet.allergies }}</app-badge>
                      }
                    </p>
                  }

                  <div class="mt-auto space-y-2 pt-4">
                    @if (c.overdue || c.next) {
                      <div
                        class="relative z-10 flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                        [class]="
                          c.overdue
                            ? 'bg-rose-50 text-rose-900'
                            : c.due
                              ? 'bg-amber-50 text-amber-900'
                              : 'bg-slate-50 text-slate-700'
                        "
                      >
                        <app-icon [name]="c.overdue ? 'alert' : 'clock'" class="size-4 shrink-0" />
                        <span class="min-w-0 flex-1 line-clamp-2">
                          @if (c.overdue) {
                            <span class="font-semibold"
                              >{{ c.overdue }}
                              {{ c.overdue === 1 ? 'dosis atrasada' : 'dosis atrasadas' }}</span
                            >
                            @if (c.due) {
                              · {{ c.due }} toca ahora
                            }
                          } @else if (c.next; as n) {
                            <span class="font-semibold tabular-nums">{{ when(n.at) }}</span> ·
                            {{ n.description }}
                          }
                        </span>
                        @if (c.overdue || c.due) {
                          <a
                            [routerLink]="['/hospitalizacion', c.id]"
                            [queryParams]="{ registrar: 1 }"
                            class="btn h-9 shrink-0 bg-white px-3 text-sm ring-1 pointer-coarse:h-11"
                            [class]="
                              c.overdue
                                ? 'text-rose-800 ring-rose-300 hover:bg-rose-100'
                                : 'text-amber-900 ring-amber-300 hover:bg-amber-100'
                            "
                            [attr.aria-label]="'Registrar dosis de ' + c.pet.name"
                            >Registrar</a
                          >
                        } @else if (c.next; as n) {
                          <span class="shrink-0 text-xs">{{ relative(n.at) }}</span>
                        }
                      </div>
                    } @else if (!c.activeOrders) {
                      <p class="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        Sin indicaciones activas
                      </p>
                    }
                    <div
                      class="flex items-center gap-3 border-t border-slate-100 pt-3 text-sm tabular-nums text-slate-700"
                    >
                      @if (c.lastVitals; as v) {
                        @if (v.temperatureC !== null) {
                          <span class="inline-flex items-center gap-1" [class]="tempClass(c)">
                            <app-icon name="thermometer" class="size-4" aria-hidden="true" />
                            <span class="sr-only">Temperatura</span>{{ v.temperatureC }}°<span
                              class="sr-only"
                              >{{ tempText(c) }}</span
                            >
                          </span>
                        }
                        @if (v.heartRate !== null) {
                          <span class="inline-flex items-center gap-1">
                            <app-icon name="heart-pulse" class="size-4" aria-hidden="true" />
                            <span class="sr-only">Frecuencia cardiaca</span>{{ v.heartRate }}
                          </span>
                        }
                        <span class="ml-auto text-xs text-slate-600"
                          >signos {{ relative(v.at) }}</span
                        >
                      } @else {
                        <span class="text-slate-600">Sin signos registrados</span>
                      }
                    </div>
                  </div>
                </article>
              </li>
            }
          </ul>
        }

        @if (recent().length) {
          <section aria-labelledby="recent-title" class="card p-5">
            <h2 id="recent-title" class="font-display text-base font-semibold text-slate-900">
              Altas recientes
            </h2>
            <ul class="mt-3 divide-y divide-slate-100">
              @for (c of recent(); track c.id) {
                <li>
                  <a
                    [routerLink]="['/hospitalizacion', c.id]"
                    class="flex min-h-12 items-center gap-3 py-2.5 text-sm hover:text-anil-700"
                  >
                    <app-icon
                      [name]="icons[c.pet.species]"
                      class="size-5 shrink-0 text-slate-500"
                    />
                    <span class="min-w-0 flex-1 truncate">
                      <span class="font-medium text-slate-900">{{ c.pet.name }}</span>
                      <span class="text-slate-600"> · {{ c.diagnosis || c.reason }}</span>
                    </span>
                    <app-badge
                      [tone]="
                        c.status === 'DECEASED' ? 'neutral' : c.voluntary ? 'warning' : 'success'
                      "
                      >{{ statusLabel(c) }}</app-badge
                    >
                    <span class="hidden shrink-0 text-xs text-slate-500 sm:inline">{{
                      c.dischargedAt | fecha: 'datetime'
                    }}</span>
                  </a>
                </li>
              }
            </ul>
          </section>
        }
      }
    </section>
  `,
})
export class HospitalizationBoardPage {
  private readonly api = inject(HospitalizationService);

  protected readonly icons = SPECIES_ICONS;
  protected readonly species = SPECIES_LABELS;
  protected readonly statusLabel = statusLabel;
  protected readonly cards = signal<HospitalizationCard[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly updatedAt = signal<Date | null>(null);
  private readonly now = signal(new Date());

  protected readonly active = computed(() => {
    // Primero los que tienen dosis atrasadas, luego los que tocan ahora
    return this.cards()
      .filter((c) => c.status === 'ACTIVE')
      .sort(
        (a, b) =>
          b.overdue - a.overdue || b.due - a.due || a.admittedAt.localeCompare(b.admittedAt),
      );
  });
  protected readonly recent = computed(() => this.cards().filter((c) => c.status !== 'ACTIVE'));
  protected readonly overdue = computed(() => this.active().reduce((s, c) => s + c.overdue, 0));
  protected readonly due = computed(() => this.active().reduce((s, c) => s + c.due, 0));

  constructor() {
    this.load();
    const timer = setInterval(() => this.load(true), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected load(silent = false): void {
    if (!silent) this.loading.set(true);
    this.api.board().subscribe({
      next: (list) => {
        this.cards.set(list);
        this.now.set(new Date());
        this.updatedAt.set(new Date());
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        if (!silent) this.error.set(apiErrorMessage(e, 'No se pudo cargar hospitalización.'));
        this.loading.set(false);
      },
    });
  }

  protected when(iso: string): string {
    return whenOf(iso, this.now());
  }

  protected relative(iso: string): string {
    return relativeTime(iso, this.now());
  }

  protected tempClass(c: HospitalizationCard): string {
    const flag = temperatureFlag(c.pet.species, c.lastVitals?.temperatureC ?? null);
    return flag === 'high'
      ? 'font-semibold text-rose-700'
      : flag === 'low'
        ? 'font-semibold text-sky-700'
        : '';
  }

  protected tempText(c: HospitalizationCard): string {
    const flag = temperatureFlag(c.pet.species, c.lastVitals?.temperatureC ?? null);
    return flag === 'high' ? ' (alta)' : flag === 'low' ? ' (baja)' : '';
  }
}
