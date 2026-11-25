import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, map } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES } from '../../core/services/clients.models';
import {
  ESTIMATE_STATUS_LABELS,
  ESTIMATE_TONE,
  Estimate,
  ValidityTone,
  validityView,
} from '../../core/services/estimates.models';
import { EstimatesService } from '../../core/services/estimates.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { limaToday } from '../../shared/utils/dates';
import { SPECIES_ICONS } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { loaded } from '../../shared/utils/resource';

export { ESTIMATE_TONE } from '../../core/services/estimates.models';

type Filter = 'OPEN' | 'ACCEPTED' | 'CONVERTED' | '';

const VALIDITY_CLASS: Record<ValidityTone, string> = {
  urgent: 'bg-rose-50 px-2 font-medium text-rose-800 ring-rose-600/20',
  soon: 'bg-maiz-100 px-2 font-medium text-amber-900 ring-amber-600/25',
  ok: 'text-slate-500 ring-transparent',
  closed: 'text-slate-500 ring-transparent',
};

/** Normaliza para buscar sin tildes ni mayúsculas */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Presupuestos: indicadores, bandeja por estado y búsqueda. */
@Component({
  selector: 'app-estimates-page',
  imports: [RouterLink, ReactiveFormsModule, FechaPipe, BadgeComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './estimates.page.html',
})
export class EstimatesPage {
  private readonly api = inject(EstimatesService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'OPEN', label: 'Abiertos' },
    { value: 'ACCEPTED', label: 'Por cargar' },
    { value: 'CONVERTED', label: 'Cargados' },
    { value: '', label: 'Todos' },
  ];
  protected readonly labels = ESTIMATE_STATUS_LABELS;
  protected readonly tone = ESTIMATE_TONE;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly validityClass = VALIDITY_CLASS;
  protected readonly money = money;
  protected readonly today = limaToday();
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );

  /** El filtro y la búsqueda van en la dirección: al volver de un presupuesto, siguen igual */
  protected readonly filter = signal<Filter>(
    (['OPEN', 'ACCEPTED', 'CONVERTED', ''] as Filter[]).find(
      (f) => f === (this.url.get('ver') === 'todos' ? '' : this.url.get('ver')),
    ) ?? 'OPEN',
  );
  protected readonly search = new FormControl(this.url.get('q') ?? '', { nonNullable: true });
  private readonly term = toSignal(
    this.search.valueChanges.pipe(
      debounceTime(150),
      map((q) => q.trim()),
    ),
    { initialValue: this.search.value.trim() },
  );
  private readonly syncUrl = effect(() => {
    const f = this.filter();
    const q = this.term();
    untracked(() =>
      this.router.navigate([], {
        queryParams: { ver: f === 'OPEN' ? null : f || 'todos', q: q || null },
        replaceUrl: true,
      }),
    );
  });

  protected readonly summary = rxResource({ stream: () => this.api.summary() });
  protected readonly list = rxResource({
    params: () => ({ status: this.filter() }),
    stream: ({ params }) => this.api.list({ status: params.status }),
  });
  protected readonly totals = loaded(this.summary);
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  protected readonly data = loaded(this.list);
  private readonly all = computed<Estimate[]>(() => this.data() ?? []);
  protected readonly items = computed<Estimate[]>(() => {
    const q = plain(this.term());
    if (!q) return this.all();
    return this.all().filter((e) =>
      plain(`${e.code} ${e.title} ${e.pet.name} ${e.client.name}`).includes(q),
    );
  });
  protected readonly sum = computed(
    () => Math.round(this.items().reduce((s, e) => s + e.total * 100, 0)) / 100,
  );
  protected readonly emptyText = computed(() =>
    this.term()
      ? `Ningún presupuesto coincide con “${this.term()}”.`
      : {
          OPEN: 'No hay presupuestos esperando respuesta.',
          ACCEPTED: 'No hay presupuestos aceptados por cargar.',
          CONVERTED: 'Todavía no se cargó ningún presupuesto.',
          '': 'Todavía no hay presupuestos.',
        }[this.filter()],
  );

  protected validity(e: Estimate) {
    return validityView(e, this.today);
  }

  protected show(filter: Filter): void {
    this.filter.set(filter);
  }

  protected clearSearch(): void {
    this.search.setValue('');
  }

  protected errorText(): string {
    return apiErrorMessage(this.list.error(), 'No se pudieron cargar los presupuestos.');
  }
}
