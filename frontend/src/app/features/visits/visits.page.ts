import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of } from 'rxjs';
import { AppointmentsService } from '../../core/services/appointments.service';
import { VisitSummary } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { SPECIES_ICONS, limaDate, relativeDay } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { loaded } from '../../shared/utils/resource';

type View = 'open' | 'stale' | 'all';
const VIEW_PARAM: Record<View, string | null> = { open: null, stale: 'antiguas', all: 'todas' };
const DAY_MS = 86_400_000;

/** Estado de una fila: con texto, no solo color. */
interface RowState {
  label: string;
  classes: string;
}

/**
 * Consultas e internamientos (el grooming se trabaja en su tablero), con buscador y filtros. Lo
 * primero que se ve es la mascota y su diagnóstico; las que quedaron abiertas de otro día se
 * nombran ("Abierta hace 3 días") porque son plata sin cobrar.
 */
@Component({
  selector: 'app-visits-page',
  imports: [FechaPipe, RouterLink, IconComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visits.page.html',
})
export class VisitsPage {
  private readonly visits = inject(VisitsService);
  private readonly router = inject(Router);
  private readonly appointments = inject(AppointmentsService);
  /** Todo va en la dirección: al volver de una atención se queda donde estaba */
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly view = signal<View>(
    this.url.get('ver') === 'todas' ? 'all' : this.url.get('ver') === 'antiguas' ? 'stale' : 'open',
  );
  protected readonly page = signal(Math.max(1, Number(this.url.get('pagina')) || 1));
  protected readonly vetId = signal<number | null>(Number(this.url.get('vet')) || null);
  protected readonly day = signal<string | null>(
    /^\d{4}-\d{2}-\d{2}$/.test(this.url.get('dia') ?? '') ? this.url.get('dia') : null,
  );
  protected readonly search = new FormControl(this.url.get('q') ?? '', { nonNullable: true });
  protected readonly q = signal(this.search.value.trim());

  protected readonly icons = SPECIES_ICONS;
  protected readonly money = money;
  protected readonly today = limaDate(new Date());

  protected readonly list = rxResource({
    params: () => ({
      view: this.view(),
      page: this.page(),
      q: this.q(),
      vetId: this.vetId(),
      day: this.day(),
    }),
    stream: ({ params: p }) =>
      this.visits.list({
        type: 'CONSULTATION',
        status: p.view === 'open' ? 'OPEN' : undefined,
        stale: p.view === 'stale' ? true : undefined,
        page: p.page,
        q: p.q || undefined,
        vetId: p.vetId ?? undefined,
        day: p.day ?? undefined,
      }),
  });
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  protected readonly data = loaded(this.list);
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly stale = computed(() => this.data()?.stale ?? 0);
  protected readonly openCount = computed(() => this.data()?.open ?? null);
  protected readonly views = [
    { id: 'open' as const, label: 'Abiertas' },
    { id: 'stale' as const, label: 'De otros días' },
    { id: 'all' as const, label: 'Todas' },
  ];
  protected readonly pages = computed(() => {
    const v = this.data();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });
  protected readonly filtered = computed(() => !!(this.q() || this.vetId() || this.day()));

  /** Filas agrupadas por día: Hoy, Ayer, 7 nov… */
  protected readonly groups = computed(() => {
    const groups: { day: string; label: string; items: VisitSummary[] }[] = [];
    for (const v of this.items()) {
      const day = limaDate(new Date(v.openedAt));
      const last = groups.at(-1);
      if (last?.day === day) last.items.push(v);
      else groups.push({ day, label: relativeDay(day), items: [v] });
    }
    return groups;
  });

  /** Quién atendió: veterinarios (y el administrador, que también atiende) */
  private readonly staff = rxResource({
    stream: () => this.appointments.staff().pipe(catchError(() => of([]))),
  });
  private readonly staffList = loaded(this.staff);
  protected readonly attendants = computed(() => {
    return (this.staffList() ?? []).filter((s) => s.role === 'VET' || s.role === 'ADMIN');
  });

  constructor() {
    this.search.valueChanges
      .pipe(
        map((value) => value.trim()),
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((q) => {
        this.q.set(q);
        this.page.set(1);
      });

    effect(() => {
      const queryParams = {
        ver: VIEW_PARAM[this.view()],
        q: this.q() || null,
        vet: this.vetId(),
        dia: this.day(),
        pagina: this.page() > 1 ? this.page() : null,
      };
      untracked(() => this.router.navigate([], { queryParams, replaceUrl: true }));
    });
  }

  protected setView(view: View): void {
    this.view.set(view);
    this.page.set(1);
  }

  protected setVet(value: string): void {
    this.vetId.set(Number(value) || null);
    this.page.set(1);
  }

  protected setDay(value: string): void {
    this.day.set(value || null);
    this.page.set(1);
  }

  protected clearFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.q.set('');
    this.vetId.set(null);
    this.day.set(null);
    this.page.set(1);
  }

  /** Días que lleva abierta (0 si es de hoy). Un internado sigue abierto hasta el alta. */
  protected openDays(v: VisitSummary): number {
    if (v.status !== 'OPEN' || v.type === 'HOSPITALIZATION') return 0;
    const opened = Date.parse(`${limaDate(new Date(v.openedAt))}T00:00:00Z`);
    return Math.round((Date.parse(`${this.today}T00:00:00Z`) - opened) / DAY_MS);
  }

  protected state(v: VisitSummary): RowState {
    if (v.status === 'CANCELLED')
      return { label: 'Cancelada', classes: 'bg-slate-100 text-slate-600 ring-slate-500/15' };
    if (v.status === 'CLOSED')
      return { label: 'Cerrada', classes: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' };
    if (v.type === 'HOSPITALIZATION')
      return { label: 'Internado', classes: 'bg-violet-50 text-violet-800 ring-violet-600/20' };
    const days = this.openDays(v);
    if (days > 0)
      return {
        label: days === 1 ? 'Abierta desde ayer' : `Abierta hace ${days} días`,
        classes: 'bg-rose-50 text-rose-800 ring-rose-600/20',
      };
    return {
      label: 'En atención',
      classes: 'bg-anil-50 text-anil-800 ring-anil-600/20',
    };
  }

  /**
   * Lo que importa del cobro: cuánto falta o que ya se pagó. Mientras sigue abierta todavía no se
   * cobra (el médico puede agregar más): se dice lo que lleva.
   */
  protected payment(v: VisitSummary): { label: string; classes: string } | null {
    if (v.status === 'CANCELLED' || v.total <= 0) return null;
    if (v.pending === undefined) return { label: money(v.total), classes: 'text-slate-600' };
    if (v.status === 'OPEN' && v.pending > 0)
      return { label: `Lleva ${money(v.total)}`, classes: 'text-slate-600' };
    if (v.pending > 0)
      return { label: `Por cobrar ${money(v.pending)}`, classes: 'text-amber-800 font-medium' };
    return { label: `Pagada · ${money(v.total)}`, classes: 'text-emerald-700' };
  }

  /** Diagnóstico, o el motivo mientras no hay diagnóstico */
  protected headline(v: VisitSummary): { text: string; muted: boolean } {
    if (v.diagnosis) return { text: v.diagnosis, muted: false };
    if (v.reason) return { text: v.reason, muted: false };
    return { text: 'Sin diagnóstico aún', muted: true };
  }
}
