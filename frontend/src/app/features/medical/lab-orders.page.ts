import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { LabFilter, LabOrder, LabPlace } from '../../core/services/lab.models';
import { LabService } from '../../core/services/lab.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';
import { LabOrdersComponent } from './lab-orders.component';
import { loaded } from '../../shared/utils/resource';

type Tab = Extract<LabFilter, 'pending' | 'ready' | 'reviewed'>;
const PAGE = 50;

/**
 * Exámenes de toda la clínica: los que esperan resultado (los demorados primero), los que esperan
 * la revisión del veterinario y los revisados (primero los que falta avisar). Agrupados por mascota
 * y atención; recepción sube aquí lo que llega.
 */
@Component({
  selector: 'app-lab-orders-page',
  imports: [IconComponent, LabOrdersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="font-display text-2xl font-semibold text-slate-900">Exámenes</h1>
        <p class="mt-1 text-sm text-pretty text-slate-600">
          Se piden en la atención. Aquí se sube el resultado y el veterinario lo revisa antes de
          avisar al dueño.
        </p>
      </header>

      <div class="flex flex-wrap items-center gap-2.5">
        <div
          class="grid w-full grid-cols-3 gap-0.5 rounded-xl bg-slate-100 p-1 sm:inline-grid sm:w-auto"
          role="group"
          aria-label="Ver exámenes"
        >
          @for (t of tabs; track t.value) {
            @let on = tab() === t.value;
            <button
              type="button"
              [attr.aria-pressed]="on"
              class="flex h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm transition-colors sm:h-10 sm:px-3.5"
              [class]="
                on
                  ? 'bg-white font-semibold text-slate-900 shadow-sm'
                  : 'font-medium text-slate-600 hover:text-slate-900'
              "
              (click)="setTab(t.value)"
            >
              {{ t.label }}
              @if (counts(); as c) {
                <span
                  class="min-w-5 rounded-full px-1.5 text-xs tabular-nums"
                  [class]="on ? 'bg-anil-600 text-white' : 'bg-slate-200 text-slate-700'"
                  >{{ c[t.value] }}</span
                >
              }
            </button>
          }
        </div>
        <span class="hidden flex-1 lg:block"></span>
        <label class="relative min-w-0 flex-1 basis-56 lg:max-w-xs lg:flex-none lg:basis-72">
          <span class="sr-only">Buscar examen</span>
          <app-icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            class="field-input h-11 pl-9"
            placeholder="Mascota, dueño o código EX"
            autocomplete="off"
            maxlength="60"
            [value]="query()"
            (input)="onQuery($any($event.target).value)"
          />
        </label>
        <label class="shrink-0 lg:w-52">
          <span class="sr-only">Lugar</span>
          <select
            class="field-input h-11 w-auto min-w-44 pr-8"
            [value]="place() ?? ''"
            (change)="setPlace($any($event.target).value)"
          >
            <option value="">Lugar: todos</option>
            <option value="IN_HOUSE">En la clínica</option>
            <option value="EXTERNAL">Laboratorio externo</option>
          </select>
        </label>
      </div>

      <p class="sr-only" aria-live="polite">{{ liveText() }}</p>

      @if (list.isLoading() && !page()) {
        <div class="space-y-3" aria-busy="true" aria-label="Cargando exámenes">
          @for (n of [1, 2]; track n) {
            <div class="h-32 animate-pulse rounded-2xl bg-slate-100"></div>
          }
        </div>
      } @else if (list.error()) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ errorText() }}</p>
          <button type="button" class="btn btn-secondary mt-5" (click)="list.reload()">
            Reintentar
          </button>
        </div>
      } @else {
        @if (tab() === 'pending' && counts()?.overdue; as late) {
          <p
            class="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-900 ring-1 ring-rose-200"
          >
            <app-icon name="clock" class="size-4 shrink-0 text-rose-600" />
            <span>
              <b class="font-semibold"
                >{{ late }} {{ late === 1 ? 'examen demorado' : 'exámenes demorados' }}</b
              >
              (3 días o más sin resultado). Salen primero en la lista.
            </span>
          </p>
        }
        @if (orders().length) {
          <app-lab-orders [orders]="orders()" [showPatient]="true" (changed)="refresh()" />
          @if (hasMore()) {
            <div class="flex justify-center">
              <button
                type="button"
                class="btn btn-secondary h-11"
                [disabled]="loadingMore()"
                (click)="loadMore()"
              >
                @if (loadingMore()) {
                  <app-icon name="loader" class="size-4 animate-spin" />
                }
                Ver más
              </button>
            </div>
          }
        } @else {
          <div class="card flex flex-col items-center px-6 py-10 text-center">
            @if (searching()) {
              <p class="font-medium text-slate-900">Ningún examen coincide con la búsqueda.</p>
              <button type="button" class="btn btn-secondary mt-4 h-10" (click)="clearFilters()">
                Limpiar búsqueda
              </button>
            } @else {
              <span
                class="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"
              >
                <app-icon name="check" class="size-6" />
              </span>
              <p class="mt-3 font-semibold text-slate-900">{{ emptyText() }}</p>
              @if (tab() !== 'pending' && counts()?.pending) {
                <p class="mt-1 text-sm text-slate-600">
                  Hay <b class="font-semibold">{{ counts()!.pending }}</b>
                  {{ counts()!.pending === 1 ? 'examen esperando' : 'exámenes esperando' }}
                  resultado.
                </p>
                <button
                  type="button"
                  class="btn btn-secondary mt-4 h-10"
                  (click)="setTab('pending')"
                >
                  Ver los que esperan
                </button>
              }
            }
          </div>
        }
      }
    </section>
  `,
})
export class LabOrdersPage {
  private readonly api = inject(LabService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly tabs: { value: Tab; label: string }[] = [
    { value: 'pending', label: 'Esperando' },
    { value: 'ready', label: 'Por revisar' },
    { value: 'reviewed', label: 'Revisados' },
  ];
  protected readonly tab = signal<Tab>(
    (['pending', 'ready', 'reviewed'] as Tab[]).find((t) => t === this.url.get('ver')) ?? 'pending',
  );
  /** Lo escrito; la búsqueda sale 300 ms después de dejar de escribir */
  protected readonly query = signal('');
  private readonly q = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly stopTimer = inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  protected readonly place = signal<LabPlace | null>(null);
  private readonly syncUrl = effect(() => {
    const tab = this.tab();
    untracked(() =>
      this.router.navigate([], {
        queryParams: { ver: tab === 'pending' ? null : tab },
        replaceUrl: true,
      }),
    );
  });

  protected readonly list = rxResource({
    params: () => ({ status: this.tab(), q: this.q(), destination: this.place() }),
    stream: ({ params }) => this.api.list({ ...params, take: PAGE }),
  });
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  protected readonly page = loaded(this.list);
  /** Lo cargado con "Ver más" (se vacía al cambiar de pestaña, búsqueda o lugar) */
  private readonly more = signal<LabOrder[]>([]);
  private readonly moreHasMore = signal<boolean | null>(null);
  protected readonly loadingMore = signal(false);
  private readonly resetMore = effect(() => {
    this.page(); // value() en error rompe la pantalla; loaded() no
    untracked(() => {
      this.more.set([]);
      this.moreHasMore.set(null);
    });
  });

  protected readonly orders = computed(() => {
    const first = this.page()?.items ?? [];
    const seen = new Set(first.map((o) => o.id));
    return [...first, ...this.more().filter((o) => !seen.has(o.id))];
  });
  protected readonly counts = computed(() => this.page()?.counts ?? null);
  protected readonly hasMore = computed(() => this.moreHasMore() ?? this.page()?.hasMore ?? false);
  protected readonly searching = computed(() => !!this.q() || !!this.place());
  protected readonly errorText = computed(() =>
    apiErrorMessage(this.list.error(), 'No se pudieron cargar los exámenes.'),
  );
  protected readonly emptyText = computed(
    () =>
      ({
        pending: 'No hay exámenes esperando resultado.',
        ready: 'No hay resultados por revisar.',
        reviewed: 'Aún no hay resultados revisados.',
      })[this.tab()],
  );
  protected readonly liveText = computed(() => {
    if (!this.page() || !this.searching()) return '';
    const n = this.orders().length;
    return n === 1 ? '1 examen encontrado' : `${n} exámenes encontrados`;
  });

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
  }

  protected setPlace(value: string): void {
    this.place.set(value === 'IN_HOUSE' || value === 'EXTERNAL' ? value : null);
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.q.set(value.trim()), 300);
  }

  protected clearFilters(): void {
    clearTimeout(this.timer);
    this.query.set('');
    this.q.set('');
    this.place.set(null);
  }

  protected loadMore(): void {
    this.loadingMore.set(true);
    this.api
      .list({
        status: this.tab(),
        q: this.q(),
        destination: this.place(),
        skip: this.orders().length,
        take: PAGE,
      })
      .subscribe({
        next: (page) => {
          this.loadingMore.set(false);
          this.more.update((list) => [...list, ...page.items]);
          this.moreHasMore.set(page.hasMore);
        },
        error: (error: unknown) => {
          this.loadingMore.set(false);
          this.toast.error(apiErrorMessage(error, 'No se pudieron cargar más exámenes.'));
        },
      });
  }

  /** Algo cambió en un examen: se vuelven a pedir la lista y los números */
  protected refresh(): void {
    this.list.reload();
  }
}
