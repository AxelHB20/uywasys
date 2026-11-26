import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SPECIES_LABELS } from '../../core/services/clients.models';
import { TRANSPORT_LABELS } from '../../core/services/grooming.models';
import { QueueItem, QueueStatus } from '../../core/services/queue.service';
import { money } from '../../shared/utils/stock';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatPhone } from '../../shared/utils/peru';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { clockTime, minutesBetween, durationLabel } from './queue-time';

/** Más de 2 horas en atención: probablemente se olvidó cerrar o cobrar */
const LONG_OPEN_MINUTES = 120;

/** Tarjeta de un paciente en la cola, con las acciones que corresponden a su estado. */
@Component({
  selector: 'app-queue-card',
  imports: [RouterLink, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocClick($event)',
    '(document:keydown.escape)': 'menuOpen.set(false)',
  },
  template: `
    @let it = item();
    <article
      class="card p-4 transition-shadow"
      [class]="it.urgent ? 'ring-2 ring-rose-300' : ''"
      [attr.aria-label]="it.pet.name + (it.urgent ? ', urgente' : '')"
    >
      <div class="flex items-start gap-3">
        <span
          class="grid size-11 shrink-0 place-items-center rounded-xl"
          [class]="it.urgent ? 'bg-rose-50 text-rose-700' : 'bg-anil-50 text-anil-700'"
          aria-hidden="true"
        >
          <app-icon [name]="speciesIcon()" class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <a
              [routerLink]="['/clientes', it.client.id]"
              class="truncate font-display font-semibold text-slate-900 hover:text-anil-700"
              >{{ it.pet.name }}</a
            >
            <span class="shrink-0 text-sm font-medium text-slate-500 tabular-nums">{{
              arrived()
            }}</span>
          </div>
          <!-- Dueño y celular en líneas separadas: en columnas angostas el celular no se corta -->
          <p class="truncate text-sm text-slate-600">{{ it.client.name }}</p>
          <p class="text-sm text-slate-500 tabular-nums">{{ phone() }}</p>
        </div>
      </div>

      @if (it.urgent || it.pet.aggressive || it.pet.allergies) {
        <div class="mt-3 flex flex-wrap gap-1.5">
          @if (it.urgent) {
            <app-badge tone="danger"><app-icon name="alert" class="size-3" />Urgente</app-badge>
          }
          @if (it.pet.aggressive) {
            <app-badge tone="danger">Agresivo</app-badge>
          }
          @if (it.pet.allergies) {
            <app-badge tone="warning">Alergia: {{ it.pet.allergies }}</app-badge>
          }
        </div>
      }

      @if (it.reason) {
        <p class="mt-3 text-sm text-slate-800">{{ it.reason }}</p>
      }
      @if (it.transport !== 'NONE') {
        <p class="mt-2 flex items-start gap-1.5 text-xs text-slate-600">
          <app-icon name="map-pin" class="mt-px size-3.5 shrink-0" />
          <span class="min-w-0"
            >{{ transportLabel() }}
            @if (it.transportAddress) {
              <span class="text-slate-500">· {{ it.transportAddress }}</span>
            }
          </span>
        </p>
      }
      <p class="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
        <app-icon name="clock" class="size-3.5 shrink-0" />
        @if (longOpen()) {
          <!-- Abierta hace mucho: que alguien la cierre o la pase a caja (igual que Atenciones) -->
          <span
            class="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200 tabular-nums"
            >{{ waitText() }}</span
          >
        } @else {
          <span class="tabular-nums">{{ waitText() }}</span>
        }
      </p>
      @if (
        it.attendedBy &&
        it.status === 'IN_PROGRESS' &&
        !(it.visit?.status === 'OPEN' && !opensVisit())
      ) {
        <p class="mt-1 truncate pl-5 text-xs text-slate-500">
          Atiende {{ it.attendedBy.fullName }}
        </p>
      }

      @if (canEdit()) {
        <div class="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
          @switch (it.status) {
            @case ('ARRIVED') {
              @if (it.type === 'GROOMING' || canAttend()) {
                <button
                  type="button"
                  class="btn btn-primary h-10 min-w-0 flex-1 px-3 whitespace-nowrap"
                  [disabled]="busy()"
                  (click)="attend.emit()"
                >
                  @if (it.type === 'GROOMING') {
                    <app-icon name="scissors" class="size-4" /> Ingreso
                  } @else {
                    <app-icon name="stethoscope" class="size-4" /> Atender
                  }
                </button>
              }
              <button
                type="button"
                class="btn btn-secondary h-10 min-w-0 flex-1 px-3 whitespace-nowrap"
                [disabled]="busy()"
                (click)="move.emit('WAITING')"
                title="Pasar a la sala de espera: listo para que lo llamen"
              >
                Pasar a espera
              </button>
            }
            @case ('WAITING') {
              @if (it.type === 'GROOMING' || canAttend()) {
                <button
                  type="button"
                  class="btn btn-primary h-10 flex-1"
                  [disabled]="busy()"
                  (click)="attend.emit()"
                >
                  @if (it.type === 'GROOMING') {
                    <app-icon name="scissors" class="size-4" /> Ingreso
                  } @else {
                    <app-icon name="stethoscope" class="size-4" /> Atender
                  }
                </button>
              } @else {
                <p class="flex h-10 flex-1 items-center text-sm text-slate-500">
                  Lo llama el veterinario
                </p>
              }
            }
            @case ('IN_PROGRESS') {
              @if (it.visit?.status === 'OPEN' && opensVisit()) {
                <a
                  [routerLink]="['/atenciones', it.visit!.id]"
                  class="btn btn-primary h-10 min-w-0 flex-1 px-3 whitespace-nowrap"
                >
                  <app-icon name="stethoscope" class="size-4" />
                  <span>Continuar<span class="max-xl:sr-only"> atención</span></span>
                </a>
              } @else if (it.visit?.status === 'OPEN') {
                <!-- Recepción no abre consultas: solo ve quién la atiende -->
                <p class="flex h-10 min-w-0 flex-1 items-center gap-2 text-sm text-slate-700">
                  <app-icon name="stethoscope" class="size-4 shrink-0 text-slate-500" />
                  <span class="truncate"
                    >Con {{ it.attendedBy?.fullName ?? 'el veterinario' }}</span
                  >
                </p>
              } @else {
                <button
                  type="button"
                  class="btn btn-primary h-10 flex-1"
                  [disabled]="busy()"
                  (click)="move.emit('DONE')"
                >
                  <app-icon name="check" class="size-4" /> Terminar
                </button>
                <button
                  type="button"
                  class="btn btn-secondary h-10"
                  [disabled]="busy()"
                  (click)="move.emit('WAITING')"
                >
                  Devolver
                </button>
              }
            }
          }
          <!-- Lo de menos uso va en ⋯: así la fila cabe en la columna (antes la × se salía) -->
          <div class="relative shrink-0" data-queue-menu>
            <button
              type="button"
              class="btn btn-secondary size-10 px-0 max-lg:size-11"
              [disabled]="busy()"
              [attr.aria-expanded]="menuOpen()"
              [attr.aria-controls]="'queue-menu-' + it.id"
              [attr.aria-label]="'Más acciones para ' + it.pet.name"
              (click)="menuOpen.set(!menuOpen())"
            >
              <app-icon name="more-horizontal" class="size-4" />
            </button>
            @if (menuOpen()) {
              <div
                [id]="'queue-menu-' + it.id"
                class="panel-in absolute top-full right-0 z-30 mt-2 w-60 origin-top-right rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-slate-50"
                  [class]="it.urgent ? 'text-rose-700' : 'text-slate-800'"
                  (click)="pick(toggleUrgent)"
                >
                  <app-icon name="alert" class="size-4" />
                  {{ it.urgent ? 'Quitar urgencia' : 'Marcar urgente' }}
                </button>
                <!-- Movilidad (consulta): el grooming la cambia en su tablero -->
                @if (it.type === 'CONSULTATION') {
                  <button
                    type="button"
                    role="menuitem"
                    class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-slate-800 hover:bg-slate-50"
                    (click)="pick(editMove)"
                  >
                    <app-icon name="map-pin" class="size-4 text-slate-500" />
                    Movilidad (recojo o entrega)
                  </button>
                }
                @if (it.status !== 'IN_PROGRESS') {
                  <button
                    type="button"
                    role="menuitem"
                    class="mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-lg border-t border-slate-100 px-3 text-left text-sm text-rose-700 hover:bg-rose-50"
                    (click)="pick(cancel)"
                  >
                    <app-icon name="x" class="size-4" /> Sacar de la cola…
                  </button>
                }
              </div>
            }
          </div>
        </div>
      }
      <span class="sr-only">{{ petCode(it.pet.number) }}</span>
    </article>
  `,
})
export class QueueCardComponent {
  readonly item = input.required<QueueItem>();
  readonly now = input.required<Date>();
  readonly canEdit = input(false);
  /** Recepción no abre consultas (quedarían a su nombre): solo el ingreso de grooming */
  readonly canAttend = input(true);
  readonly busy = input(false);
  readonly move = output<QueueStatus>();
  /** Abrir la atención (la entrada pasa a "En atención") */
  readonly attend = output<void>();
  readonly toggleUrgent = output<void>();
  readonly cancel = output<void>();
  /** Agregar o cambiar la movilidad (p. ej. "ya no puede volver, llévenlo") */
  readonly editMove = output<void>();

  protected readonly petCode = petCode;
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly menuOpen = signal(false);
  /** Grooming lo abre cualquiera que trabaje la cola; las consultas solo quien atiende */
  protected readonly opensVisit = computed(
    () => this.item().type === 'GROOMING' || this.canAttend(),
  );
  /** En atención hace más de 2 horas: se avisa en ámbar */
  protected readonly longOpen = computed(() => {
    const it = this.item();
    return (
      it.status === 'IN_PROGRESS' &&
      !!it.startedAt &&
      minutesBetween(it.startedAt, this.now()) > LONG_OPEN_MINUTES
    );
  });

  protected pick(action: { emit: () => void }): void {
    this.menuOpen.set(false);
    action.emit();
  }

  protected onDocClick(event: Event): void {
    if (!this.menuOpen()) return;
    const target = event.target as HTMLElement | null;
    const menu = this.host.nativeElement.querySelector('[data-queue-menu]');
    if (!menu?.contains(target)) this.menuOpen.set(false);
  }
  protected readonly speciesIcon = computed(() => SPECIES_ICONS[this.item().pet.species]);
  protected readonly speciesLabel = computed(() => SPECIES_LABELS[this.item().pet.species]);
  protected readonly phone = computed(() => formatPhone(this.item().client.phone));
  /** "Recojo y entrega · S/ 20.00" */
  protected readonly transportLabel = computed(() => {
    const it = this.item();
    return `${TRANSPORT_LABELS[it.transport]}${it.transportPrice ? ` · ${money(it.transportPrice)}` : ''}`;
  });
  protected readonly arrived = computed(() => clockTime(this.item().arrivedAt));
  protected readonly waitText = computed(() => {
    const it = this.item();
    if (it.status === 'IN_PROGRESS' && it.startedAt)
      return this.longOpen()
        ? `Abierta hace ${durationLabel(minutesBetween(it.startedAt, this.now()))}`
        : `En atención hace ${durationLabel(minutesBetween(it.startedAt, this.now()))}`;
    return `Espera ${durationLabel(minutesBetween(it.arrivedAt, this.now()))}`;
  });
}
