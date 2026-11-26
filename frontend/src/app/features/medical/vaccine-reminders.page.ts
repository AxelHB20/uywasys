import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import {
  DueImmunization,
  IMMUNIZATION_KIND_LABELS,
  ReminderMark,
  reminderLink,
} from '../../core/services/medical.models';
import { RemindersService } from '../../core/services/reminders.service';
import { Species } from '../../core/services/clients.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';
import { loaded } from '../../shared/utils/resource';

type Tab = 'upcoming' | 'overdue';
const RANGES = [7, 15, 30, 60];

/** Una fila de la lista: un refuerzo o una cita de mañana */
interface Row {
  key: string;
  kind: 'VACCINE' | 'APPOINTMENT';
  id: number;
  pet: { id: number; number: number; name: string; species: Species };
  client: { name: string; phone: string };
  title: string;
  date: string;
  when: string;
  tone: 'overdue' | 'soon' | 'info';
  link: string;
  reminded: ReminderMark[];
  autoNotice: boolean;
  agenda: Record<string, string | number> | null;
}

const clock = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Avisos a los dueños: refuerzos de vacunas y desparasitaciones, y citas de mañana. Sin costo por
 * mensaje: recepción abre el WhatsApp ya escrito (y queda marcado), y a los dueños que activaron
 * los avisos en su portal les llega solo al celular.
 */
@Component({
  selector: 'app-vaccine-reminders-page',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-5">
      <header class="flex flex-col gap-1">
        <h1 class="font-display text-2xl font-semibold text-slate-900">Refuerzos</h1>
        <p class="text-sm text-pretty text-slate-600">
          Refuerzos de vacunas y desparasitaciones para avisar a los dueños. Sin costo por mensaje.
        </p>
      </header>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          class="grid grid-cols-2 rounded-xl bg-slate-100 p-1 sm:inline-flex"
          role="tablist"
          aria-label="Refuerzos"
        >
          @for (t of tabs; track t.value) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === t.value"
              class="h-9 rounded-lg px-3 text-sm font-medium transition-colors sm:px-4"
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

      @if (!loading() && !failed() && rows().length) {
        <!-- Progreso del día -->
        <div
          class="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
        >
          <div class="flex items-center gap-4">
            <div
              class="relative grid size-12 shrink-0 place-items-center"
              role="img"
              [attr.aria-label]="progress().done + ' de ' + progress().total + ' avisados'"
            >
              <svg viewBox="0 0 36 36" class="size-12 -rotate-90" aria-hidden="true">
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke-width="4"
                  class="stroke-slate-100"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke-width="4"
                  stroke-linecap="round"
                  class="stroke-emerald-500 transition-[stroke-dasharray] duration-300"
                  [attr.stroke-dasharray]="progress().percent * 0.974 + ' 100'"
                />
              </svg>
              <span class="absolute text-xs font-semibold text-slate-900 tabular-nums"
                >{{ progress().done }}/{{ progress().total }}</span
              >
            </div>
            <div>
              <p class="font-medium text-slate-900">
                @if (progress().pending) {
                  Faltan {{ progress().pending }} por avisar
                } @else {
                  Todos avisados
                }
              </p>
              <p class="text-sm text-slate-500">
                @if (progress().auto) {
                  A {{ progress().auto }} les llega solo al celular.
                } @else {
                  Comparte el portal con los dueños para que les llegue solo.
                }
              </p>
            </div>
          </div>
          @if (canEdit() && nextPending(); as next) {
            <button
              type="button"
              class="btn h-11 bg-emerald-600 text-white hover:bg-emerald-700"
              (click)="notify(next)"
            >
              <app-icon name="message-circle" class="size-4" />
              Avisar a {{ next.client.name.split(' ')[0] }} ({{ next.pet.name }})
            </button>
          }
        </div>
      }

      <div class="card overflow-hidden">
        @if (loading()) {
          <div class="space-y-3 p-6" aria-busy="true" aria-label="Cargando avisos">
            @for (n of [1, 2, 3]; track n) {
              <div class="h-14 animate-pulse rounded-xl bg-slate-100"></div>
            }
          </div>
        } @else if (failed()) {
          <div class="flex flex-col items-center px-6 py-12 text-center">
            <app-icon name="alert" class="size-8 text-rose-600" />
            <p class="mt-3 font-medium text-slate-900">{{ errorText() }}</p>
            <button type="button" class="btn btn-secondary mt-5" (click)="reload()">
              Reintentar
            </button>
          </div>
        } @else if (rows().length) {
          <ul class="divide-y divide-slate-100" role="list">
            @for (r of rows(); track r.key) {
              @let mark = lastMark(r);
              <li
                class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6"
                [class.bg-slate-50]="!!mark"
              >
                <a
                  [routerLink]="['/mascotas', r.pet.id]"
                  class="flex min-w-0 flex-1 items-center gap-3 rounded-xl hover:text-anil-700"
                >
                  <span
                    class="grid size-10 shrink-0 place-items-center rounded-xl"
                    [class]="mark ? 'bg-emerald-50 text-emerald-600' : 'bg-anil-50 text-anil-600'"
                    aria-hidden="true"
                  >
                    <app-icon [name]="speciesIcons[r.pet.species]" class="size-5" />
                  </span>
                  <span class="min-w-0">
                    <span class="block font-semibold text-slate-900">
                      {{ r.pet.name }}
                      <span class="font-normal text-slate-500">· {{ petCode(r.pet.number) }}</span>
                    </span>
                    <span class="block truncate text-sm text-slate-600">{{ r.title }}</span>
                    <span class="block text-sm text-slate-500">
                      {{ r.client.name }} ·
                      <span class="tabular-nums">{{ formatPhone(r.client.phone) }}</span>
                    </span>
                  </span>
                </a>
                <div class="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                  <div class="min-w-28 sm:text-right">
                    <p class="text-sm font-medium text-slate-900 tabular-nums">{{ r.date }}</p>
                    <p class="text-xs font-medium" [class]="toneClass[r.tone]">{{ r.when }}</p>
                  </div>
                  @if (mark) {
                    <span
                      class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200"
                      [title]="markTitle(mark)"
                    >
                      <app-icon [name]="markIcon(mark)" class="size-3.5" /> {{ markLabel(mark) }}
                    </span>
                  } @else if (r.autoNotice) {
                    <span
                      class="inline-flex items-center gap-1 rounded-full bg-anil-50 px-2.5 py-1 text-xs font-medium text-anil-800 ring-1 ring-anil-200"
                      title="El dueño activó los avisos en su portal"
                    >
                      <app-icon name="smartphone" class="size-3.5" /> Le llega solo
                    </span>
                  }
                  <div class="flex gap-2">
                    @if (canEdit()) {
                      <button
                        type="button"
                        class="btn h-10"
                        [class]="
                          mark
                            ? 'btn-ghost text-slate-600'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        "
                        (click)="notify(r)"
                        [attr.aria-label]="'Avisar por WhatsApp a ' + r.client.name"
                      >
                        <app-icon name="message-circle" class="size-4" />
                        {{ mark ? 'Avisar de nuevo' : 'Avisar' }}
                      </button>
                    }
                    @if (r.agenda; as params) {
                      <a
                        class="btn btn-secondary h-10 px-3"
                        routerLink="/citas"
                        [queryParams]="params"
                        [attr.aria-label]="'Agendar cita para ' + r.pet.name"
                      >
                        <app-icon name="calendar" class="size-4" /> Agendar
                      </a>
                    }
                  </div>
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
            <p class="mt-3 font-medium text-slate-900">{{ emptyText() }}</p>
            <p class="mt-1 max-w-sm text-sm text-slate-500">
              Aparecen aquí al registrar una vacuna o desparasitación con fecha de próxima dosis.
            </p>
          </div>
        }
      </div>
      <p class="text-xs text-pretty text-slate-500">
        "Avisar" abre WhatsApp con el mensaje escrito para revisarlo y enviarlo; queda marcado para
        no repetir. Los dueños que activan los avisos en su portal reciben una notificación al
        celular 3 días antes del refuerzo y la tarde antes de su cita, sin costo.
      </p>
    </section>
  `,
})
export class VaccineRemindersPage {
  private readonly api = inject(ImmunizationsService);
  private readonly remindersApi = inject(RemindersService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  protected readonly tabs: { value: Tab; label: string }[] = [
    { value: 'upcoming', label: 'Próximos' },
    { value: 'overdue', label: 'Vencidos' },
  ];
  protected readonly ranges = RANGES;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly toneClass = {
    overdue: 'text-rose-700',
    soon: 'text-amber-700',
    info: 'text-slate-500',
  };
  protected readonly canEdit = computed(() =>
    ['ADMIN', 'RECEPTION', 'VET'].includes(this.session.user()?.role ?? ''),
  );

  private readonly router = inject(Router);
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;
  /** Pestaña y plazo en la dirección: al volver de una ficha, la lista sigue igual */
  protected readonly tab = signal<Tab>(this.url.get('ver') === 'vencidas' ? 'overdue' : 'upcoming');
  protected readonly days = signal(Number(this.url.get('dias')) || 30);
  private readonly syncUrl = effect(() => {
    const tab = this.tab();
    const days = this.days();
    untracked(() =>
      this.router.navigate([], {
        queryParams: {
          ver: tab === 'overdue' ? 'vencidas' : null,
          dias: days === 30 ? null : days,
        },
        replaceUrl: true,
      }),
    );
  });

  protected readonly list = rxResource({
    params: () => ({ status: this.tab(), days: this.days() }),
    stream: ({ params }) => this.api.due(params.status, params.days),
  });
  /** Marcas hechas en esta pantalla (sin volver a pedir la lista) */
  private readonly localMarks = signal<Record<string, ReminderMark[]>>({});

  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  private readonly data = loaded(this.list);
  protected readonly loading = computed(() => this.list.isLoading());
  protected readonly failed = computed(() => !!this.list.error());
  protected readonly errorText = computed(() =>
    apiErrorMessage(this.list.error(), 'No se pudieron cargar los refuerzos.'),
  );

  protected readonly rows = computed<Row[]>(() => {
    const local = this.localMarks();
    const rows = (this.data() ?? []).map((i) => this.immunizationRow(i));
    return rows.map((r) => (local[r.key] ? { ...r, reminded: local[r.key] } : r));
  });

  protected readonly progress = computed(() => {
    const rows = this.rows();
    const done = rows.filter((r) => r.reminded.length).length;
    const auto = rows.filter((r) => r.autoNotice).length;
    return {
      total: rows.length,
      done,
      pending: rows.length - done,
      auto,
      percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
    };
  });
  /** El siguiente sin avisar al que no le llega solo */
  protected readonly nextPending = computed(
    () => this.rows().find((r) => !r.reminded.length && !r.autoNotice) ?? null,
  );

  protected readonly emptyText = computed(() => {
    return this.tab() === 'overdue'
      ? 'Nadie tiene refuerzos vencidos.'
      : `No hay refuerzos en los próximos ${this.days()} días.`;
  });

  protected reload(): void {
    this.list.reload();
  }

  /** Abre el WhatsApp ya escrito y marca el aviso */
  protected notify(r: Row): void {
    window.open(r.link, '_blank', 'noopener');
    const previous = this.localMarks()[r.key] ?? r.reminded;
    const optimistic: ReminderMark = {
      channel: 'WHATSAPP',
      sentAt: new Date().toISOString(),
      by: this.session.user()?.fullName ?? null,
    };
    this.localMarks.update((m) => ({
      ...m,
      [r.key]: [...previous.filter((x) => x.channel !== 'WHATSAPP'), optimistic],
    }));
    this.remindersApi.markSent(r.kind, r.id).subscribe({
      next: (marks) => this.localMarks.update((m) => ({ ...m, [r.key]: marks })),
      error: (error: unknown) => {
        this.localMarks.update((m) => ({ ...m, [r.key]: previous }));
        this.toast.error(apiErrorMessage(error, 'No se pudo marcar el aviso.'));
      },
    });
  }

  protected lastMark(r: Row): ReminderMark | null {
    return r.reminded.at(-1) ?? null;
  }

  protected markIcon(m: ReminderMark): IconName {
    return m.channel === 'PUSH' ? 'smartphone' : 'check';
  }

  protected markLabel(m: ReminderMark): string {
    const when = this.markWhen(m.sentAt);
    return m.channel === 'PUSH' ? `Al celular ${when}` : `Avisado ${when}`;
  }

  protected markTitle(m: ReminderMark): string {
    return m.channel === 'PUSH'
      ? 'Notificación automática enviada al celular del dueño'
      : `Avisado por WhatsApp${m.by ? ` por ${m.by}` : ''}`;
  }

  private markWhen(iso: string): string {
    const day = limaToday(new Date(iso));
    return day === limaToday() ? `hoy ${clock.format(new Date(iso))}` : formatDate(day, 'calendar');
  }

  private immunizationRow(i: DueImmunization): Row {
    const today = limaToday();
    return {
      key: `VACCINE-${i.id}`,
      kind: 'VACCINE',
      id: i.id,
      pet: i.pet,
      client: i.client,
      title: `${i.name} · ${IMMUNIZATION_KIND_LABELS[i.kind]}`,
      date: formatDate(i.nextDueAt, 'calendar'),
      when:
        i.daysLeft < 0
          ? `Vencida hace ${-i.daysLeft} ${i.daysLeft === -1 ? 'día' : 'días'}`
          : i.daysLeft === 0
            ? 'Toca hoy'
            : `En ${i.daysLeft} ${i.daysLeft === 1 ? 'día' : 'días'}`,
      tone: i.daysLeft < 0 ? 'overdue' : 'soon',
      link: reminderLink(i, this.session.clinicName()),
      reminded: i.reminded ?? [],
      autoNotice: !!i.autoNotice,
      // Abre la agenda con la cita ya armada: el día del refuerzo (o hoy, si ya pasó)
      agenda: {
        fecha: i.nextDueAt < today ? today : i.nextDueAt,
        nueva: 1,
        petId: i.pet.id,
        mascota: i.pet.name,
        cliente: i.client.name,
        motivo: `Refuerzo: ${i.name}`,
      },
    };
  }
}
