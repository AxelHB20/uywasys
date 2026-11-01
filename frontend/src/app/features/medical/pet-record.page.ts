import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES, SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import { GROOMING_STATUS_LABELS, GroomingCard } from '../../core/services/grooming.models';
import { GroomingService } from '../../core/services/grooming.service';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { Immunization, ImmunizationCard } from '../../core/services/medical.models';
import { VISIT_STATUS_LABELS, VisitSummary } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';
import { ImmunizationFormComponent } from './immunization-form.component';
import { ImmunizationListComponent } from './immunization-list.component';
import { PetDocumentsComponent } from './pet-documents.component';

const STATUS_TONE: Record<VisitSummary['status'], BadgeTone> = {
  OPEN: 'info',
  CLOSED: 'success',
  CANCELLED: 'neutral',
};

/**
 * Historia clínica de una mascota: consultas con su diagnóstico, y el carnet de vacunas y
 * desparasitaciones (con antecedentes de otras clínicas y el carnet imprimible), y los archivos
 * y consentimientos firmados.
 */
@Component({
  selector: 'app-pet-record-page',
  imports: [
    RouterLink,
    FechaPipe,
    IconComponent,
    BadgeComponent,
    ImmunizationFormComponent,
    ImmunizationListComponent,
    PetDocumentsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      @if (card(); as c) {
        <a
          [routerLink]="['/clientes', c.pet.client.id]"
          class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <app-icon name="chevron-left" class="size-4" /> {{ c.pet.client.name }}
        </a>
      }

      @if (loading() && !card()) {
        <div class="card space-y-3 p-6" aria-busy="true" aria-label="Cargando historia clínica">
          <div class="h-6 w-64 animate-pulse rounded bg-slate-100"></div>
          <div class="h-4 w-40 animate-pulse rounded bg-slate-100"></div>
        </div>
      } @else if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
          <button type="button" class="btn btn-secondary mt-5" (click)="load()">Reintentar</button>
        </div>
      } @else if (card(); as c) {
        <!-- Encabezado -->
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-4">
            <span
              class="grid size-14 shrink-0 place-items-center rounded-2xl bg-anil-600 text-white"
              aria-hidden="true"
            >
              <app-icon [name]="speciesIcons[c.pet.species]" class="size-7" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Historia clínica {{ petCode(c.pet.number) }}
              </p>
              <h1 class="font-display text-2xl font-semibold break-words text-slate-900">
                {{ c.pet.name }}
                @if (c.pet.deceasedAt) {
                  <span class="ml-1 align-middle text-sm font-normal text-slate-500">
                    (fallecida el {{ c.pet.deceasedAt | fecha: 'calendar' }})
                  </span>
                }
              </h1>
              <p class="mt-0.5 text-sm text-slate-600">
                {{ speciesLabels[c.pet.species] }}
                @if (c.pet.breed) {
                  · {{ c.pet.breed }}
                }
                @if (c.pet.sex) {
                  · {{ sexLabels[c.pet.sex] }}{{ c.pet.neutered ? ' (esterilizado)' : '' }}
                }
                @if (petAge(c.pet.birthDate); as age) {
                  · {{ age }}
                }
                @if (c.pet.weightKg) {
                  · <span class="tabular-nums">{{ c.pet.weightKg }} kg</span>
                }
                <span class="tabular-nums"> · {{ formatPhone(c.pet.client.phone) }}</span>
              </p>
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap gap-2">
            @if (canEdit() && !c.pet.deceasedAt) {
              <a
                routerLink="/citas"
                [queryParams]="{
                  nueva: 1,
                  petId: c.pet.id,
                  mascota: c.pet.name,
                  cliente: c.pet.client.name,
                }"
                class="btn btn-secondary"
              >
                <app-icon name="calendar" class="size-4" /> Agendar cita
              </a>
              <a
                routerLink="/presupuestos/nuevo"
                [queryParams]="{
                  petId: c.pet.id,
                  mascota: c.pet.name,
                  cliente: c.pet.client.name,
                }"
                class="btn btn-secondary"
              >
                <app-icon name="clipboard-list" class="size-4" /> Presupuesto
              </a>
              <a
                routerLink="/grooming/ingreso"
                [queryParams]="{ petId: c.pet.id }"
                class="btn btn-secondary"
              >
                <app-icon name="scissors" class="size-4" /> Grooming
              </a>
            }
            <a [routerLink]="['/mascotas', c.pet.id, 'carnet']" class="btn btn-secondary shrink-0">
              <app-icon name="file-text" class="size-4" /> Imprimir carnet
            </a>
          </div>
        </div>

        @if (c.pet.aggressive || c.pet.allergies) {
          <div class="grid gap-3 sm:grid-cols-2" role="alert">
            @if (c.pet.aggressive) {
              <div class="flex gap-3 rounded-2xl bg-rose-50 p-4 text-rose-900 ring-1 ring-rose-200">
                <app-icon name="alert" class="mt-0.5 size-5 shrink-0 text-rose-600" />
                <p>
                  <span class="font-semibold">Agresivo.</span>
                  {{ c.pet.aggressiveNote ?? 'Manipular con precaución.' }}
                </p>
              </div>
            }
            @if (c.pet.allergies) {
              <div
                class="flex gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200"
              >
                <app-icon name="alert" class="mt-0.5 size-5 shrink-0 text-amber-600" />
                <p><span class="font-semibold">Alergias:</span> {{ c.pet.allergies }}</p>
              </div>
            }
          </div>
        }

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
          <!-- Consultas -->
          <section class="card overflow-hidden" aria-labelledby="hc-title">
            <div class="px-5 pt-5 sm:px-6">
              <h2 id="hc-title" class="font-display text-lg font-semibold text-slate-900">
                Atenciones
              </h2>
              <p class="mt-0.5 text-sm text-slate-500">
                {{ visitsTotal() }} {{ visitsTotal() === 1 ? 'registro' : 'registros' }}, de la más
                reciente a la más antigua.
              </p>
            </div>
            @if (visits().length) {
              <ol class="mt-3 divide-y divide-slate-100" role="list">
                @for (v of visits(); track v.id) {
                  <li>
                    <a
                      [routerLink]="['/atenciones', v.id]"
                      class="flex gap-4 px-5 py-4 hover:bg-slate-50 focus-visible:bg-slate-50 sm:px-6"
                    >
                      <div class="w-20 shrink-0 text-sm">
                        <p class="font-medium text-slate-900 tabular-nums">
                          {{ v.openedAt | fecha }}
                        </p>
                        <p class="text-xs text-slate-500">
                          {{ v.type === 'GROOMING' ? 'Grooming' : 'Consulta' }}
                        </p>
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="font-medium break-words text-slate-900">
                          {{ v.diagnosis ?? v.reason ?? 'Sin motivo anotado' }}
                        </p>
                        <p
                          class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500"
                        >
                          @if (v.diagnosis) {
                            <span
                              class="rounded-md px-1.5 py-0.5 text-xs font-medium"
                              [class]="
                                v.diagnosisDefinitive
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : 'bg-slate-100 text-slate-600'
                              "
                              >{{ v.diagnosisDefinitive ? 'Definitivo' : 'Presuntivo' }}</span
                            >
                            @if (v.reason) {
                              <span class="break-words">{{ v.reason }}</span>
                            }
                          }
                          <span>{{ v.attendedBy.fullName }}</span>
                          @if (v.weightKg) {
                            <span class="tabular-nums">· {{ v.weightKg }} kg</span>
                          }
                        </p>
                      </div>
                      @if (v.status !== 'CLOSED') {
                        <app-badge [tone]="statusTone[v.status]" class="self-start">{{
                          statusLabels[v.status]
                        }}</app-badge>
                      }
                    </a>
                  </li>
                }
              </ol>
              @if (visits().length < visitsTotal()) {
                <div class="border-t border-slate-100 p-4 text-center">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    [disabled]="loadingMore()"
                    (click)="more()"
                  >
                    Ver más
                  </button>
                </div>
              }
            } @else {
              <p class="px-5 pt-2 pb-6 text-sm text-slate-500 sm:px-6">
                Todavía no tiene atenciones registradas.
              </p>
            }
          </section>

          <!-- Carnet -->
          <section class="card p-5 sm:p-6" aria-labelledby="carnet-title">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="carnet-title" class="font-display text-lg font-semibold text-slate-900">
                  Vacunas y desparasitaciones
                </h2>
                <p class="mt-0.5 text-sm text-slate-500">
                  Lo aplicado en la clínica se registra desde la atención.
                </p>
              </div>
              @if (canEdit() && !adding()) {
                <button type="button" class="btn btn-secondary h-10" (click)="adding.set(true)">
                  <app-icon name="plus" class="size-4" /> Antecedente
                </button>
              }
            </div>
            @if (adding()) {
              <div class="mt-4 rounded-2xl bg-slate-50/70 p-4 ring-1 ring-slate-200">
                <p class="mb-3 text-sm text-slate-600">
                  Para vacunas aplicadas antes o en otra clínica (según el carnet que trae el
                  dueño).
                </p>
                <app-immunization-form
                  [petId]="c.pet.id"
                  (saved)="onChange($event)"
                  (cancelled)="adding.set(false)"
                />
              </div>
            }
            <div class="mt-2">
              <app-immunization-list
                [items]="immunizations()"
                [canVoid]="canEdit()"
                [showVisitLink]="true"
                (changed)="onChange($event)"
              />
            </div>
          </section>
        </div>

        @if (groomings().length) {
          <section class="card overflow-hidden" aria-labelledby="gr-title">
            <h2
              id="gr-title"
              class="px-5 pt-5 font-display text-lg font-semibold text-slate-900 sm:px-6"
            >
              Grooming
            </h2>
            <ul class="mt-2 divide-y divide-slate-100" role="list">
              @for (g of groomings(); track g.id) {
                <li>
                  <a
                    [routerLink]="['/grooming', g.id, 'constancia']"
                    class="flex items-center gap-4 px-5 py-3 hover:bg-slate-50 sm:px-6"
                  >
                    <span class="w-20 shrink-0 text-sm font-medium text-slate-900 tabular-nums">{{
                      g.checkInAt | fecha
                    }}</span>
                    <span class="min-w-0 flex-1">
                      <span
                        class="block truncate text-sm font-medium text-slate-900"
                        [class.line-through]="g.status === 'CANCELLED'"
                        >{{ servicesOf(g) }}</span
                      >
                      <span class="block truncate text-xs text-slate-500">
                        {{ g.code }} · {{ g.groomer?.fullName ?? 'Sin groomer' }}
                        @if (g.instructions) {
                          · {{ g.instructions }}
                        }
                      </span>
                    </span>
                    <span class="shrink-0 text-xs font-medium text-slate-500">{{
                      groomingLabels[g.status]
                    }}</span>
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <app-pet-documents [petId]="c.pet.id" />
      }
    </section>
  `,
})
export class PetRecordPage {
  private readonly api = inject(ImmunizationsService);
  private readonly visitsApi = inject(VisitsService);
  private readonly groomingApi = inject(GroomingService);
  private readonly session = inject(SessionService);

  /** :id de la ruta */
  readonly id = input.required<string>();

  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly statusLabels = VISIT_STATUS_LABELS;
  protected readonly statusTone = STATUS_TONE;
  protected readonly petCode = petCode;
  protected readonly petAge = petAge;
  protected readonly formatPhone = formatPhone;

  protected readonly card = signal<ImmunizationCard | null>(null);
  protected readonly immunizations = signal<Immunization[]>([]);
  protected readonly visits = signal<VisitSummary[]>([]);
  protected readonly groomings = signal<GroomingCard[]>([]);
  protected readonly groomingLabels = GROOMING_STATUS_LABELS;
  protected readonly servicesOf = (g: GroomingCard) =>
    g.services.map((s) => s.description).join(' + ') || 'Sin servicios';
  protected readonly visitsTotal = signal(0);
  private page = 1;
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );

  constructor() {
    effect(() => this.load(Number(this.id())));
  }

  protected load(id = Number(this.id())): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.page = 1;
    this.api.card(id).subscribe({
      next: (card) => {
        this.card.set(card);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la historia clínica.'));
        this.loading.set(false);
      },
    });
    this.api.forPet(id).subscribe({
      next: (list) => this.immunizations.set(list),
      error: () => this.immunizations.set([]),
    });
    this.groomingApi.forPet(id).subscribe({
      next: (list) => this.groomings.set(list),
      error: () => this.groomings.set([]),
    });
    this.visitsApi.list({ petId: id, page: 1 }).subscribe({
      next: (page) => {
        this.visits.set(page.items);
        this.visitsTotal.set(page.total);
      },
      error: () => this.visits.set([]),
    });
  }

  protected more(): void {
    this.loadingMore.set(true);
    this.visitsApi.list({ petId: Number(this.id()), page: this.page + 1 }).subscribe({
      next: (page) => {
        this.page = page.page;
        this.visits.update((list) => [...list, ...page.items]);
        this.visitsTotal.set(page.total);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  protected onChange(item: Immunization): void {
    this.adding.set(false);
    this.immunizations.update((list) => {
      const rest = list.filter((i) => i.id !== item.id);
      return [...rest, item].sort((a, b) =>
        a.appliedAt === b.appliedAt ? b.id - a.id : b.appliedAt.localeCompare(a.appliedAt),
      );
    });
  }
}
