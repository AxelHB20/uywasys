import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import {
  DueImmunization,
  IMMUNIZATION_KIND_LABELS,
  reminderLink,
} from '../../core/services/medical.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';

type Tab = 'upcoming' | 'overdue';
const RANGES = [7, 15, 30, 60];

/**
 * Recordatorios de vacunas y desparasitaciones: quién tiene un refuerzo pronto y quién ya se
 * pasó. El aviso sale por WhatsApp con un enlace (gratis, desde el celular de la clínica).
 */
@Component({
  selector: 'app-vaccine-reminders-page',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <header class="flex flex-col gap-1">
        <h1 class="font-display text-2xl font-semibold text-slate-900">Vacunas</h1>
        <p class="text-sm text-slate-600">
          Refuerzos de vacunas y desparasitaciones para avisar a los dueños.
        </p>
      </header>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Refuerzos">
          @for (t of tabs; track t.value) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === t.value"
              class="h-9 rounded-lg px-4 text-sm font-medium transition-colors"
              [class]="
                tab() === t.value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              "
              (click)="tab.set(t.value)"
            >
              {{ t.label }}
            </button>
          }
        </div>
        @if (tab() === 'upcoming') {
          <label class="flex items-center gap-2 text-sm text-slate-600">
            Próximos
            <select
              class="field-input mt-0 h-9 w-auto py-0"
              [value]="days()"
              (change)="days.set(+$any($event.target).value)"
            >
              @for (d of ranges; track d) {
                <option [value]="d" [selected]="d === days()">{{ d }} días</option>
              }
            </select>
          </label>
        }
      </div>

      <div class="card overflow-hidden">
        @if (list.isLoading()) {
          <div class="space-y-3 p-6" aria-busy="true" aria-label="Cargando recordatorios">
            @for (n of [1, 2, 3]; track n) {
              <div class="h-12 animate-pulse rounded-xl bg-slate-100"></div>
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
            @for (i of items(); track i.id) {
              <li class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                <a
                  [routerLink]="['/mascotas', i.pet.id]"
                  class="flex min-w-0 flex-1 items-center gap-3 rounded-xl hover:text-anil-700"
                >
                  <span
                    class="grid size-10 shrink-0 place-items-center rounded-xl bg-anil-50 text-anil-600"
                    aria-hidden="true"
                  >
                    <app-icon [name]="speciesIcons[i.pet.species]" class="size-5" />
                  </span>
                  <span class="min-w-0">
                    <span class="block font-semibold text-slate-900">
                      {{ i.pet.name }}
                      <span class="font-normal text-slate-500">· {{ petCode(i.pet.number) }}</span>
                    </span>
                    <span class="block text-sm text-slate-600">
                      {{ i.name }} · {{ kindLabels[i.kind] }}
                    </span>
                    <span class="block text-sm text-slate-500">
                      {{ i.client.name }} ·
                      <span class="tabular-nums">{{ formatPhone(i.client.phone) }}</span>
                    </span>
                  </span>
                </a>
                <div class="flex items-center justify-between gap-4 sm:justify-end">
                  <div class="text-right">
                    <p class="text-sm font-medium text-slate-900 tabular-nums">
                      {{ calendar(i.nextDueAt) }}
                    </p>
                    <p
                      class="text-xs font-medium"
                      [class]="i.daysLeft < 0 ? 'text-rose-700' : 'text-amber-700'"
                    >
                      {{ when(i) }}
                    </p>
                  </div>
                  <a
                    class="btn h-10 bg-emerald-600 text-white hover:bg-emerald-700"
                    [href]="link(i)"
                    target="_blank"
                    rel="noopener"
                    [attr.aria-label]="'Avisar por WhatsApp a ' + i.client.name"
                  >
                    <app-icon name="message-circle" class="size-4" /> Avisar
                  </a>
                  <a
                    class="btn btn-secondary h-10 px-3"
                    routerLink="/citas"
                    [queryParams]="agendaParams(i)"
                    [attr.aria-label]="'Agendar cita para ' + i.pet.name"
                  >
                    <app-icon name="calendar" class="size-4" /> Agendar
                  </a>
                </div>
              </li>
            }
          </ul>
        } @else {
          <div class="flex flex-col items-center px-6 py-14 text-center">
            <span
              class="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"
            >
              <app-icon name="check" class="size-6" />
            </span>
            <p class="mt-3 font-medium text-slate-900">
              {{
                tab() === 'overdue'
                  ? 'Nadie tiene refuerzos vencidos.'
                  : 'No hay refuerzos en los próximos ' + days() + ' días.'
              }}
            </p>
            <p class="mt-1 max-w-sm text-sm text-slate-500">
              Aparecen aquí al registrar una vacuna o desparasitación con fecha de próxima dosis.
            </p>
          </div>
        }
      </div>
      <p class="text-xs text-slate-500">
        El mensaje se abre en WhatsApp para revisarlo antes de enviarlo. Solo se avisa a dueños con
        datos vigentes; los clientes anonimizados no aparecen.
      </p>
    </section>
  `,
})
export class VaccineRemindersPage {
  private readonly api = inject(ImmunizationsService);
  private readonly session = inject(SessionService);

  protected readonly tabs: { value: Tab; label: string }[] = [
    { value: 'upcoming', label: 'Próximos' },
    { value: 'overdue', label: 'Vencidos' },
  ];
  protected readonly ranges = RANGES;
  protected readonly kindLabels = IMMUNIZATION_KIND_LABELS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly calendar = (day: string) => formatDate(day, 'calendar');

  protected readonly tab = signal<Tab>('upcoming');
  protected readonly days = signal(30);
  protected readonly list = rxResource({
    params: () => ({ status: this.tab(), days: this.days() }),
    stream: ({ params }) => this.api.due(params.status, params.days),
  });
  protected readonly items = computed<DueImmunization[]>(() => this.list.value() ?? []);
  protected readonly errorText = computed(() =>
    apiErrorMessage(this.list.error(), 'No se pudieron cargar los recordatorios.'),
  );

  protected when(i: DueImmunization): string {
    if (i.daysLeft < 0) return `Vencida hace ${-i.daysLeft} ${i.daysLeft === -1 ? 'día' : 'días'}`;
    if (i.daysLeft === 0) return 'Toca hoy';
    return `En ${i.daysLeft} ${i.daysLeft === 1 ? 'día' : 'días'}`;
  }

  /** Abre la agenda con la cita ya armada: el día del refuerzo (o hoy, si ya pasó) */
  protected agendaParams(i: DueImmunization): Record<string, string | number> {
    const today = limaToday();
    return {
      fecha: i.nextDueAt < today ? today : i.nextDueAt,
      nueva: 1,
      petId: i.pet.id,
      mascota: i.pet.name,
      cliente: i.client.name,
      motivo: `Refuerzo: ${i.name}`,
    };
  }

  protected link(i: DueImmunization): string {
    return reminderLink(i, this.session.clinicName());
  }
}
