import { NgTemplateOutlet } from '@angular/common';
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
import {
  AREA_LABELS,
  ActivityArea,
  ActivityItem,
  REVIEW_LABELS,
  ReviewKind,
  activityIcon,
  activityIp,
  activityLines,
  activityLink,
  activityTitle,
} from '../../core/services/activity.models';
import { ActivityService } from '../../core/services/activity.service';
import { UsersService } from '../../core/services/users.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { limaDate, relativeDay } from '../../shared/utils/records';
import { loaded } from '../../shared/utils/resource';

/** Qué se ve: todo, solo lo que conviene revisar o un área */
type Scope = 'all' | 'review' | ActivityArea;
type Preset = 'all' | 'today' | 'last7' | 'last30' | 'custom';

const PRESETS: { key: Preset; label: string; slug: string | null }[] = [
  { key: 'all', label: 'Todo', slug: null },
  { key: 'today', label: 'Hoy', slug: 'hoy' },
  { key: 'last7', label: '7 días', slug: '7-dias' },
  { key: 'last30', label: '30 días', slug: '30-dias' },
  { key: 'custom', label: 'Fechas', slug: null },
];

/** Una fila: una acción, o varias iguales seguidas de la misma persona ("Inició sesión · 13 veces") */
type Entry =
  | { key: string; run: false; item: ActivityItem }
  | { key: string; run: true; items: ActivityItem[] };

interface DayGroup {
  day: string;
  label: string;
  entries: Entry[];
}

/** Desde cuántas iguales seguidas se juntan en una fila */
const RUN_MIN = 3;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Bitácora: quién hizo qué y cuándo. Arriba, lo que conviene revisar de la semana. */
@Component({
  selector: 'app-activity-page',
  imports: [RouterLink, NgTemplateOutlet, FechaPipe, IconComponent, BadgeComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity.page.html',
})
export class ActivityPage {
  private readonly activity = inject(ActivityService);
  private readonly usersApi = inject(UsersService);
  private readonly router = inject(Router);
  protected readonly areas = Object.entries(AREA_LABELS) as [ActivityArea, string][];
  protected readonly presets = PRESETS;
  protected readonly reviewLabels = REVIEW_LABELS;
  protected readonly title = activityTitle;
  protected readonly lines = activityLines;
  protected readonly link = activityLink;
  protected readonly icon = activityIcon;
  protected readonly ip = activityIp;
  protected readonly today = limaToday();

  /** Los filtros van en la dirección: al abrir un registro y volver, la lista sigue igual */
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly scope = signal<Scope>(
    this.url.get('importantes') === '1'
      ? 'review'
      : AREA_LABELS[this.url.get('area') as ActivityArea]
        ? (this.url.get('area') as ActivityArea)
        : 'all',
  );
  protected readonly kind = signal<ReviewKind | null>(
    REVIEW_LABELS[this.url.get('grupo') as ReviewKind]
      ? (this.url.get('grupo') as ReviewKind)
      : null,
  );
  protected readonly userId = signal<number | null>(Number(this.url.get('usuario')) || null);
  protected readonly preset = signal<Preset>(
    this.url.get('desde') || this.url.get('hasta')
      ? 'custom'
      : (PRESETS.find((p) => p.slug && p.slug === this.url.get('periodo'))?.key ?? 'all'),
  );
  protected readonly from = signal<string>(this.url.get('desde') ?? '');
  protected readonly to = signal<string>(this.url.get('hasta') ?? '');
  protected readonly page = signal(Math.max(1, Number(this.url.get('pagina')) || 1));
  protected readonly filtersOpen = signal(false);
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  /** Fechas al revés: se muestran ordenadas y se avisa con un botón para dejarlas bien */
  protected readonly reversed = computed(
    () => this.preset() === 'custom' && !!this.from() && !!this.to() && this.from() > this.to(),
  );
  private readonly range = computed<{ from: string | null; to: string | null }>(() => {
    switch (this.preset()) {
      case 'today':
        return { from: this.today, to: this.today };
      case 'last7':
        return { from: addDays(this.today, -6), to: this.today };
      case 'last30':
        return { from: addDays(this.today, -29), to: this.today };
      case 'custom': {
        const [a, b] = this.reversed() ? [this.to(), this.from()] : [this.from(), this.to()];
        return { from: a || null, to: b || null };
      }
      default:
        return { from: null, to: null };
    }
  });

  constructor() {
    effect(() => {
      const scope = this.scope();
      const preset = this.preset();
      const query = {
        area: scope !== 'all' && scope !== 'review' ? scope : null,
        importantes: scope === 'review' ? 1 : null,
        grupo: this.kind(),
        usuario: this.userId(),
        periodo: PRESETS.find((p) => p.key === preset)?.slug ?? null,
        desde: preset === 'custom' ? this.from() || null : null,
        hasta: preset === 'custom' ? this.to() || null : null,
        pagina: this.page() > 1 ? this.page() : null,
      };
      untracked(() => this.router.navigate([], { queryParams: query, replaceUrl: true }));
    });
  }

  protected readonly users = rxResource({ stream: () => this.usersApi.list() });
  protected readonly userList = loaded(this.users);
  /** El equipo de la clínica (la cuenta de soporte no aparece en Actividad) */
  protected readonly team = computed(() => (this.userList() ?? []).filter((u) => !u.support));
  protected readonly review = rxResource({ stream: () => this.activity.review() });
  protected readonly reviewData = loaded(this.review);

  protected readonly list = rxResource({
    params: () => {
      const scope = this.scope();
      return {
        area: scope !== 'all' && scope !== 'review' ? scope : null,
        important: scope === 'review',
        kind: this.kind(),
        userId: this.userId(),
        ...this.range(),
        page: this.page(),
      };
    },
    stream: ({ params }) => this.activity.list(params),
  });
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  private readonly data = loaded(this.list);
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly capped = computed(() => this.data()?.totalCapped ?? false);
  protected readonly pages = computed(() => {
    const v = this.data();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });
  protected readonly filtered = computed(
    () => this.scope() !== 'all' || !!this.kind() || !!this.userId() || this.preset() !== 'all',
  );
  /** Cuántos filtros hay en "Persona y fechas" (celular) */
  protected readonly extraFilters = computed(
    () => (this.userId() ? 1 : 0) + (this.preset() !== 'all' ? 1 : 0),
  );
  protected readonly periodText = computed(() => {
    const r = this.range();
    if (!r.from && !r.to) return '';
    const f = (d: string) => formatDate(`${d}T12:00:00`, 'date');
    if (r.from === r.to && r.from) return f(r.from);
    return `${r.from ? f(r.from) : '…'} – ${r.to ? f(r.to) : 'hoy'}`;
  });

  /** Agrupado por día de Lima; las acciones iguales seguidas de la misma persona, en una fila */
  protected readonly groups = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const item of this.items()) {
      const day = limaDate(new Date(item.at));
      let group = groups.at(-1);
      if (!group || group.day !== day) {
        const relative = relativeDay(day);
        group = {
          day,
          label: /^\d/.test(relative) ? formatDate(item.at, 'date') : relative,
          entries: [],
        };
        groups.push(group);
      }
      const last = group.entries.at(-1);
      const prev = last ? (last.run ? last.items.at(-1)! : last.item) : null;
      if (prev && this.same(prev, item)) {
        if (last!.run) last!.items.push(item);
        else
          group.entries[group.entries.length - 1] = {
            key: prev.id,
            run: true,
            items: [prev, item],
          };
      } else group.entries.push({ key: item.id, run: false, item });
    }
    // Menos de RUN_MIN seguidas se muestran una por una
    for (const g of groups)
      g.entries = g.entries.flatMap((e) =>
        e.run && e.items.length < RUN_MIN
          ? e.items.map((item) => ({ key: item.id, run: false as const, item }))
          : [e],
      );
    return groups;
  });

  private same(a: ActivityItem, b: ActivityItem): boolean {
    return a.action === b.action && a.user?.id === b.user?.id && this.who(a) === this.who(b);
  }

  protected who(item: ActivityItem): string {
    if (item.user) return item.user.fullName;
    // Un intento con un correo que no existe no tiene usuario
    return item.action.startsWith('auth.') ? 'Correo desconocido' : 'Sistema';
  }

  protected isOpen(key: string): boolean {
    return this.expanded().has(key);
  }
  protected toggle(key: string): void {
    const next = new Set(this.expanded());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expanded.set(next);
  }

  protected setScope(scope: Scope): void {
    this.scope.set(scope);
    this.kind.set(null);
    this.page.set(1);
  }
  /** Una tarjeta de "Para revisar": ese grupo en los últimos 7 días */
  protected openKind(kind: ReviewKind): void {
    this.kind.set(kind);
    this.scope.set('all');
    this.preset.set('last7');
    this.page.set(1);
  }
  protected openReview(): void {
    this.kind.set(null);
    this.scope.set('review');
    this.preset.set('last7');
    this.page.set(1);
  }
  protected setUser(value: string): void {
    this.userId.set(Number(value) || null);
    this.page.set(1);
  }
  protected setPreset(preset: Preset): void {
    this.preset.set(preset);
    if (preset === 'custom' && !this.from() && !this.to()) {
      this.from.set(addDays(this.today, -6));
      this.to.set(this.today);
    }
    this.page.set(1);
  }
  protected setDate(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.from : this.to).set(value);
    this.page.set(1);
  }
  protected swap(): void {
    const f = this.from();
    this.from.set(this.to());
    this.to.set(f);
  }
  protected clear(): void {
    this.scope.set('all');
    this.kind.set(null);
    this.userId.set(null);
    this.preset.set('all');
    this.from.set('');
    this.to.set('');
    this.page.set(1);
  }
  protected kindText(kind: ReviewKind, count: number): string {
    const l = REVIEW_LABELS[kind];
    return `${count} ${count === 1 ? l.one : l.many}`;
  }
}
