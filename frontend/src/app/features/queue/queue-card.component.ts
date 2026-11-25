import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
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

/** Tarjeta de un paciente en la cola, con las acciones que corresponden a su estado. */
@Component({
  selector: 'app-queue-card',
  imports: [RouterLink, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      <p class="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
        <app-icon name="clock" class="size-3.5 shrink-0" />
        <span class="tabular-nums">{{ waitText() }}</span>
      </p>
      @if (it.attendedBy && it.status === 'IN_PROGRESS') {
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
                  class="btn btn-primary h-10 flex-1 px-3 whitespace-nowrap"
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
                class="btn btn-secondary h-10 flex-1 px-3 whitespace-nowrap"
                [disabled]="busy()"
                (click)="move.emit('WAITING')"
                title="Pasar a la sala de espera"
              >
                Esperar
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
              @if (it.visit?.status === 'OPEN') {
                <a [routerLink]="['/atenciones', it.visit!.id]" class="btn btn-primary h-10 flex-1">
                  <app-icon name="stethoscope" class="size-4" /> Continuar<span
                    class="max-xl:sr-only"
                    >&nbsp;atención</span
                  >
                </a>
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
          <button
            type="button"
            class="btn btn-ghost size-10 shrink-0 px-0"
            [class]="it.urgent ? 'text-rose-700' : ''"
            [disabled]="busy()"
            (click)="toggleUrgent.emit()"
            [attr.aria-label]="
              it.urgent
                ? 'Quitar urgencia a ' + it.pet.name
                : 'Marcar a ' + it.pet.name + ' como urgente'
            "
            [attr.aria-pressed]="it.urgent"
            [title]="it.urgent ? 'Quitar urgencia' : 'Marcar urgente'"
          >
            <app-icon name="alert" class="size-4" />
          </button>
          <!-- Movilidad (consulta): el grooming la cambia en su tablero -->
          @if (it.type === 'CONSULTATION') {
            <button
              type="button"
              class="btn btn-ghost size-10 shrink-0 px-0"
              [class]="it.transport !== 'NONE' ? 'text-anil-700' : ''"
              [disabled]="busy()"
              (click)="editMove.emit()"
              [attr.aria-label]="'Movilidad de ' + it.pet.name"
              title="Movilidad (recojo o entrega)"
            >
              <app-icon name="map-pin" class="size-4" />
            </button>
          }
          @if (it.status !== 'IN_PROGRESS') {
            <button
              type="button"
              class="btn btn-ghost size-10 shrink-0 px-0 hover:bg-rose-50 hover:text-rose-700"
              [disabled]="busy()"
              (click)="cancel.emit()"
              [attr.aria-label]="'Sacar a ' + it.pet.name + ' de la cola'"
              title="Sacar de la cola"
            >
              <app-icon name="x" class="size-4" />
            </button>
          }
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
      return `En atención hace ${durationLabel(minutesBetween(it.startedAt, this.now()))}`;
    return `Espera ${durationLabel(minutesBetween(it.arrivedAt, this.now()))}`;
  });
}
