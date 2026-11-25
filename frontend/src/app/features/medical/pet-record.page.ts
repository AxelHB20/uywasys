import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { limaClock } from '../../core/services/appointments.models';
import { QueueService } from '../../core/services/queue.service';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { limaToday } from '../../shared/utils/dates';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES, SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import { GROOMING_STATUS_LABELS, GroomingCard } from '../../core/services/grooming.models';
import { GroomingService } from '../../core/services/grooming.service';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { dueState, Immunization, ImmunizationCard } from '../../core/services/medical.models';
import { VISIT_STATUS_LABELS, VisitSummary } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { apiErrorDetails, apiErrorMessage } from '../../shared/utils/validators';
import { ImmunizationFormComponent } from './immunization-form.component';
import { ImmunizationListComponent } from './immunization-list.component';
import { PetDocumentsComponent } from './pet-documents.component';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { WeightChartComponent } from '../../shared/ui/charts/weight-chart.component';
import { WeightPoint } from '../../core/services/visits.models';

const nextDay = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

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
  host: {
    '(document:click)': 'onDocClick($event)',
    '(document:keydown.escape)': 'menuOpen.set(false)',
  },
  imports: [
    BackLinkComponent,
    ReactiveFormsModule,
    ModalComponent,
    RouterLink,
    FechaPipe,
    IconComponent,
    BadgeComponent,
    ImmunizationFormComponent,
    ImmunizationListComponent,
    PetDocumentsComponent,
    WeightChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      @if (card(); as c) {
        <app-back-link
          [fallback]="'/clientes/' + c.pet.client.id"
          [fallbackLabel]="c.pet.client.name"
        />
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
        <!-- Encabezado: la mascota y su dueño; abajo o al lado, una acción principal y lo demás en ⋯ -->
        <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div class="flex min-w-0 items-start gap-4">
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
                  · {{ sexLabels[c.pet.sex]
                  }}{{
                    c.pet.neutered
                      ? c.pet.sex === 'FEMALE'
                        ? ' (esterilizada)'
                        : ' (esterilizado)'
                      : ''
                  }}
                }
                @if (petAge(c.pet.birthDate); as age) {
                  · {{ age }}
                }
                @if (c.pet.weightKg) {
                  · <span class="tabular-nums">{{ c.pet.weightKg }} kg</span>
                }
              </p>
              <p class="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
                Dueño:
                <a
                  [routerLink]="['/clientes', c.pet.client.id]"
                  class="font-semibold text-anil-700 hover:underline"
                  >{{ c.pet.client.name }} ›</a
                >
                <span class="tabular-nums">· {{ formatPhone(c.pet.client.phone) }}</span>
              </p>
              @if (c.nextAppointment) {
                <p
                  class="mt-2 inline-flex items-center gap-2 rounded-xl bg-anil-50 px-3 py-1.5 text-sm text-anil-900 ring-1 ring-anil-200"
                >
                  <app-icon name="calendar" class="size-4 shrink-0 text-anil-600" />
                  <span
                    ><strong class="font-semibold">Próxima cita:</strong> {{ nextLabel() }}</span
                  >
                </p>
              }
            </div>
          </div>

          <div class="relative flex shrink-0 gap-2" data-record-menu>
            @if (canEdit() && !c.pet.deceasedAt) {
              @if (canAttend()) {
                <button
                  type="button"
                  class="btn btn-primary flex-1 xl:flex-none"
                  [disabled]="saving()"
                  (click)="attend()"
                >
                  <app-icon name="stethoscope" class="size-4" /> Atender
                </button>
              } @else {
                <button
                  type="button"
                  class="btn btn-primary flex-1 xl:flex-none"
                  (click)="openQueue()"
                >
                  <app-icon name="clock" class="size-4" /> A la cola
                </button>
              }
              <a
                routerLink="/citas"
                [queryParams]="{
                  nueva: 1,
                  petId: c.pet.id,
                  mascota: c.pet.name,
                  cliente: c.pet.client.name,
                }"
                class="btn btn-secondary flex-1 xl:flex-none"
              >
                <app-icon name="calendar" class="size-4" /> Agendar
              </a>
            }
            @if (visitsTotal()) {
              <a
                [routerLink]="['/mascotas', c.pet.id, 'historia']"
                class="btn btn-secondary hidden flex-1 sm:inline-flex xl:flex-none"
              >
                <app-icon name="history" class="size-4" /> Historia completa
              </a>
            }
            <button
              type="button"
              class="btn btn-secondary size-11 shrink-0 px-0"
              aria-label="Más acciones"
              aria-controls="record-menu"
              [attr.aria-expanded]="menuOpen()"
              (click)="menuOpen.set(!menuOpen())"
            >
              <app-icon name="more-horizontal" class="size-4" />
            </button>
            @if (menuOpen()) {
              <div
                id="record-menu"
                class="panel-in absolute top-full right-0 z-30 mt-2 w-64 origin-top-right rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5"
                role="menu"
              >
                @if (visitsTotal()) {
                  <a
                    role="menuitem"
                    [routerLink]="['/mascotas', c.pet.id, 'historia']"
                    class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm text-slate-800 hover:bg-slate-50 sm:hidden"
                  >
                    <app-icon name="history" class="size-4 text-slate-500" /> Historia completa
                  </a>
                }
                @if (canEdit() && !c.pet.deceasedAt) {
                  <a
                    role="menuitem"
                    routerLink="/presupuestos/nuevo"
                    [queryParams]="{
                      petId: c.pet.id,
                      mascota: c.pet.name,
                      cliente: c.pet.client.name,
                    }"
                    class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm text-slate-800 hover:bg-slate-50"
                  >
                    <app-icon name="clipboard-list" class="size-4 text-slate-500" /> Presupuesto
                  </a>
                  <a
                    role="menuitem"
                    routerLink="/grooming/ingreso"
                    [queryParams]="{ petId: c.pet.id }"
                    class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm text-slate-800 hover:bg-slate-50"
                  >
                    <app-icon name="scissors" class="size-4 text-slate-500" /> Ingreso a grooming
                  </a>
                }
                <a
                  role="menuitem"
                  [routerLink]="['/mascotas', c.pet.id, 'carnet']"
                  class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm text-slate-800 hover:bg-slate-50"
                >
                  <app-icon name="file-text" class="size-4 text-slate-500" /> Imprimir carnet de
                  vacunas
                </a>
              </div>
            }
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
                {{ visitsTotal() }}
                {{ visitsTotal() === 1 ? 'atención médica' : 'atenciones médicas' }}, de la más
                reciente a la más antigua.
                @if (groomings().length) {
                  Los baños están en Grooming.
                }
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
                        <span
                          class="mt-1 inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ring-1"
                          [class]="
                            v.type === 'HOSPITALIZATION'
                              ? 'bg-violet-50 text-violet-800 ring-violet-600/20'
                              : 'bg-slate-100 text-slate-700 ring-slate-500/20'
                          "
                          >{{ v.type === 'HOSPITALIZATION' ? 'Internamiento' : 'Consulta' }}</span
                        >
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

          <div class="min-w-0 space-y-6">
            @if (weights().length > 1) {
              <!-- Curva de peso -->
              <section class="card p-5 sm:p-6" aria-labelledby="weight-title">
                <div class="flex items-baseline justify-between gap-3">
                  <h2 id="weight-title" class="font-display text-lg font-semibold text-slate-900">
                    Peso
                  </h2>
                  @if (weightChange(); as w) {
                    <p class="text-sm text-slate-600">
                      <span class="font-semibold text-slate-900 tabular-nums">{{ w.last }} kg</span>
                      <span
                        class="ml-1 font-medium tabular-nums"
                        [class]="w.alert ? 'text-amber-800' : 'text-slate-600'"
                        >({{ w.diff > 0 ? '+' : w.diff < 0 ? '−' : '' }}{{ w.abs }} kg)</span
                      >
                    </p>
                  }
                </div>
                <app-weight-chart class="mt-4" [points]="weights()" />
              </section>
            }
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
              @if (dueSummary(); as d) {
                <p
                  class="mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm ring-1"
                  [class]="
                    d.overdue
                      ? 'bg-rose-50 text-rose-900 ring-rose-200'
                      : 'bg-slate-50 text-slate-700 ring-slate-200'
                  "
                >
                  <app-icon
                    [name]="d.overdue ? 'alert' : 'calendar'"
                    class="mt-0.5 size-4 shrink-0"
                    [class]="d.overdue ? 'text-rose-600' : 'text-slate-500'"
                  />
                  <span
                    ><strong class="font-semibold">{{
                      d.overdue ? 'Vencido:' : 'Próximo refuerzo:'
                    }}</strong>
                    {{ d.text }}</span
                  >
                </p>
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
        </div>

        <app-pet-documents [petId]="c.pet.id" />

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
      }
    </section>

    <app-modal
      [open]="queueOpen()"
      [title]="'Poner a ' + (card()?.pet?.name ?? '') + ' en la cola'"
      description="Se agrega a la cola de atención de hoy."
      (closed)="queueOpen.set(false)"
    >
      <form
        id="record-queue-form"
        [formGroup]="queueForm"
        (ngSubmit)="addToQueue()"
        novalidate
        class="space-y-4"
      >
        <div>
          <label for="rq-reason" class="field-label">Motivo de la visita</label>
          <input
            id="rq-reason"
            formControlName="reason"
            class="field-input"
            autocomplete="off"
            maxlength="200"
            placeholder="Ej.: vacuna, control, vómitos"
          />
        </div>
        <label
          class="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-slate-800"
        >
          <input type="checkbox" formControlName="urgent" class="size-5 rounded accent-rose-600" />
          Es una urgencia (pasa primero)
        </label>
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="queueOpen.set(false)">
          Cancelar
        </button>
        <button
          type="submit"
          form="record-queue-form"
          class="btn btn-primary"
          [disabled]="saving()"
        >
          Poner en cola
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class PetRecordPage {
  private readonly api = inject(ImmunizationsService);
  private readonly visitsApi = inject(VisitsService);
  private readonly groomingApi = inject(GroomingService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly queue = inject(QueueService);
  private readonly toast = inject(ToastService);

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
  protected readonly weights = signal<WeightPoint[]>([]);
  /** Último peso y cuánto cambió desde el primero de la curva (±10 % se resalta) */
  protected readonly weightChange = computed(() => {
    const w = this.weights();
    if (w.length < 2) return null;
    const first = w[0].kg;
    const last = w[w.length - 1].kg;
    const diff = Math.round((last - first) * 100) / 100;
    return { last, diff, abs: Math.abs(diff), alert: Math.abs(diff / first) >= 0.1 };
  });
  private page = 1;
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
  /** Recepción no atiende: su botón principal es "A la cola" */
  protected readonly canAttend = computed(() => this.session.role() !== 'RECEPTION');
  protected readonly saving = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly queueOpen = signal(false);
  protected readonly queueForm = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    urgent: new FormControl(false, { nonNullable: true }),
  });
  private readonly today = limaToday();

  /** "Jue 26 nov · 10:00 · Control" */
  protected readonly nextLabel = computed(() => {
    const a = this.card()?.nextAppointment;
    if (!a) return '';
    const day = nextDay.format(new Date(a.startsAt)).replace(/\./g, '');
    return [
      `${day.charAt(0).toUpperCase()}${day.slice(1)}`,
      limaClock(a.startsAt).time,
      a.reason ?? (a.type === 'GROOMING' ? 'Grooming' : null),
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /**
   * Resumen del carnet: lo vencido primero (lo más atrasado); si nada venció, el próximo refuerzo.
   * Solo cuenta la última aplicación de cada vacuna (las anteriores ya se reforzaron).
   */
  protected readonly dueSummary = computed(() => {
    const latest = new Map<string, Immunization>();
    for (const i of this.immunizations()) {
      if (i.voidedAt) continue;
      const key = `${i.kind}|${i.name.toLocaleLowerCase('es')}`;
      const prev = latest.get(key);
      if (
        !prev ||
        i.appliedAt > prev.appliedAt ||
        (i.appliedAt === prev.appliedAt && i.id > prev.id)
      )
        latest.set(key, i);
    }
    const pending = [...latest.values()]
      .filter((i) => i.nextDueAt)
      .sort((a, b) => a.nextDueAt!.localeCompare(b.nextDueAt!));
    if (!pending.length) return null;
    const overdue = pending.filter((i) => dueState(i.nextDueAt, this.today)?.tone === 'overdue');
    const fmt = (day: string) => day.split('-').reverse().join('/');
    if (overdue.length)
      return {
        overdue: true,
        text: overdue.map((i) => `${i.name} · desde ${fmt(i.nextDueAt!)}`).join('; '),
      };
    const first = pending[0];
    return { overdue: false, text: `${first.name} · ${fmt(first.nextDueAt!)}` };
  });

  protected onDocClick(event: Event): void {
    if (!this.menuOpen()) return;
    if (!(event.target as HTMLElement | null)?.closest('[data-record-menu]'))
      this.menuOpen.set(false);
  }

  protected attend(): void {
    const pet = this.card()?.pet;
    if (!pet || this.saving()) return;
    this.saving.set(true);
    this.visitsApi.open(pet.id).subscribe({
      next: (visit) => {
        this.saving.set(false);
        void this.router.navigate(['/atenciones', visit.id]);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        // Ya tenía una atención abierta: se continúa esa
        const { visitId } = apiErrorDetails<{ visitId: number }>(error);
        if (visitId) void this.router.navigate(['/atenciones', visitId]);
        else this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected openQueue(): void {
    this.queueForm.reset({ reason: '', urgent: false });
    this.queueOpen.set(true);
  }

  protected addToQueue(): void {
    const pet = this.card()?.pet;
    if (!pet || this.queueForm.invalid || this.saving()) return;
    const v = this.queueForm.getRawValue();
    this.saving.set(true);
    this.queue.add({ petId: pet.id, urgent: v.urgent, reason: v.reason.trim() || null }).subscribe({
      next: () => {
        this.saving.set(false);
        this.queueOpen.set(false);
        this.toast.success(`${pet.name} está en la cola de hoy`);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

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
    // Un servidor anterior no tiene la curva: simplemente no se muestra
    this.visitsApi.weights(id).subscribe({
      next: (list) => this.weights.set(list),
      error: () => this.weights.set([]),
    });
    this.visitsApi.list({ petId: id, page: 1, type: 'CONSULTATION' }).subscribe({
      next: (page) => {
        this.visits.set(page.items);
        this.visitsTotal.set(page.total);
      },
      error: () => this.visits.set([]),
    });
  }

  protected more(): void {
    this.loadingMore.set(true);
    this.visitsApi
      .list({ petId: Number(this.id()), page: this.page + 1, type: 'CONSULTATION' })
      .subscribe({
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
