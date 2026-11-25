import { loaded } from '../../shared/utils/resource';
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
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import {
  PatientRow,
  PatientSort,
  PatientSpecies,
  PatientStatus,
} from '../../core/services/patients.models';
import { PatientsService } from '../../core/services/patients.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatDate } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { SPECIES_ICONS, petCode, relativeDay } from '../../shared/utils/records';

const SPECIES: { value: PatientSpecies | null; label: string; long: string }[] = [
  { value: null, label: 'Todos', long: 'Todas las especies' },
  { value: 'DOG', label: 'Perros', long: 'Perros' },
  { value: 'CAT', label: 'Gatos', long: 'Gatos' },
  { value: 'OTHER', label: 'Otros', long: 'Otras especies' },
];
const SORTS: { value: PatientSort; label: string }[] = [
  { value: 'RECENT', label: 'Más recientes' },
  { value: 'NAME', label: 'Nombre (A–Z)' },
  { value: 'NUMBER', label: 'N° de historia' },
];
const SPECIES_PARAM: Record<PatientSpecies, string> = {
  DOG: 'perros',
  CAT: 'gatos',
  OTHER: 'otros',
};
const SORT_PARAM: Record<PatientSort, string | null> = {
  RECENT: null,
  NAME: 'nombre',
  NUMBER: 'numero',
};
/** Cuántos avisos caben en la fila; el resto se resume ("+1") */
const MAX_TAGS = 2;

type Tone = 'info' | 'hospital' | 'danger' | 'warning' | 'muted';
const TONES: Record<Tone, string> = {
  info: 'bg-anil-50 text-anil-800 ring-anil-600/20',
  hospital: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  danger: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  warning: 'bg-amber-50 text-amber-900 ring-amber-600/25',
  muted: 'bg-slate-100 text-slate-700 ring-slate-500/20',
};

interface Tag {
  text: string;
  classes: string;
}

/**
 * Historias clínicas: los pacientes de la clínica (el veterinario piensa en el paciente, no en el
 * dueño). Cada fila abre la ficha de siempre (/mascotas/:id). Clientes sigue siendo para el dueño.
 */
@Component({
  selector: 'app-patients-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './patients.page.html',
})
export class PatientsPage {
  private readonly api = inject(PatientsService);
  private readonly router = inject(Router);
  /** Filtros en la dirección: al volver de una ficha se queda donde estaba */
  private readonly url = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly statuses: PatientStatus[] = ['ACTIVE', 'INACTIVE'];
  protected readonly speciesTabs = SPECIES;
  protected readonly sorts = SORTS;
  protected readonly icons = SPECIES_ICONS;
  protected readonly petCode = petCode;

  protected readonly status = signal<PatientStatus>(
    this.url.get('estado') === 'inactivos' ? 'INACTIVE' : 'ACTIVE',
  );
  protected readonly species = signal<PatientSpecies | null>(
    (Object.keys(SPECIES_PARAM) as PatientSpecies[]).find(
      (k) => SPECIES_PARAM[k] === this.url.get('especie'),
    ) ?? null,
  );
  protected readonly sort = signal<PatientSort>(
    (Object.keys(SORT_PARAM) as PatientSort[]).find(
      (k) => SORT_PARAM[k] === this.url.get('orden'),
    ) ?? 'RECENT',
  );
  protected readonly page = signal(Math.max(1, Number(this.url.get('pagina')) || 1));
  protected readonly search = new FormControl(this.url.get('q') ?? '', { nonNullable: true });
  protected readonly q = signal(this.search.value.trim());

  protected readonly list = rxResource({
    params: () => ({
      q: this.q() || undefined,
      status: this.status(),
      species: this.species() ?? undefined,
      sort: this.sort(),
      page: this.page(),
    }),
    stream: ({ params }) => this.api.list(params),
  });
  /** Lo último que llegó; si el servidor falló, nada (leer value() en error rompe la pantalla) */
  protected readonly data = loaded(this.list);
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly counts = computed(() => this.data()?.counts);
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pages = computed(() => {
    const v = this.data();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });
  /** "Mostrando 21–40 de 512 pacientes" */
  protected readonly range = computed(() => {
    const v = this.data();
    if (!v?.total) return '';
    const from = (v.page - 1) * v.pageSize + 1;
    const to = Math.min(v.total, from + v.items.length - 1);
    return `Mostrando ${from}–${to} de ${v.total} ${v.total === 1 ? 'paciente' : 'pacientes'}`;
  });
  protected readonly filtered = computed(() => !!this.q() || !!this.species());

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
      const species = this.species();
      const queryParams = {
        q: this.q() || null,
        estado: this.status() === 'INACTIVE' ? 'inactivos' : null,
        especie: species ? SPECIES_PARAM[species] : null,
        orden: SORT_PARAM[this.sort()],
        pagina: this.page() > 1 ? this.page() : null,
      };
      untracked(() => this.router.navigate([], { queryParams, replaceUrl: true }));
    });
  }

  protected setStatus(status: PatientStatus): void {
    this.status.set(status);
    this.page.set(1);
  }

  protected setSpecies(value: PatientSpecies | null): void {
    this.species.set(value);
    this.page.set(1);
  }

  protected setSort(value: string): void {
    this.sort.set((SORTS.find((s) => s.value === value)?.value ?? 'RECENT') as PatientSort);
    this.page.set(1);
  }

  protected clear(): void {
    this.search.setValue('', { emitEvent: false });
    this.q.set('');
    this.species.set(null);
    this.page.set(1);
  }

  /** "Perro · Hembra · 8 años · Yorkshire" (la raza al final: si no cabe, se corta ella) */
  protected meta(p: PatientRow): string {
    const age = p.deceasedAt ? null : petAge(p.birthDate);
    return [
      SPECIES_LABELS[p.species],
      p.sex ? SEX_LABELS[p.sex] : null,
      age && (p.birthDateEstimated ? `~${age}` : age),
      p.breed,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** Diagnóstico, o el motivo si aún no hay diagnóstico */
  protected lastTitle(p: PatientRow): string {
    const v = p.lastVisit!;
    return (
      v.diagnosis?.trim() ||
      v.reason?.trim() ||
      (v.type === 'HOSPITALIZATION' ? 'Internamiento' : 'Consulta')
    );
  }

  /** "Hoy", "Ayer" o la fecha */
  protected when(at: string): string {
    const day = relativeDay(at);
    return day === 'Hoy' || day === 'Ayer' ? day : formatDate(at, 'date');
  }

  protected phone(phone: string): string {
    return formatPhone(phone);
  }

  /** Avisos de la fila, del más urgente al menos; siempre con texto, no solo color */
  protected tags(p: PatientRow): { shown: Tag[]; more: Tag[] } {
    const all: Tag[] = [];
    const add = (text: string, tone: Tone) => all.push({ text, classes: TONES[tone] });
    if (p.deceasedAt) add(`Fallecido · ${formatDate(p.deceasedAt, 'calendar')}`, 'muted');
    else if (!p.active) add('Inactivo', 'muted');
    if (p.openVisit)
      add(
        p.openVisit.type === 'HOSPITALIZATION' ? 'Internado' : 'En atención',
        p.openVisit.type === 'HOSPITALIZATION' ? 'hospital' : 'info',
      );
    if (p.aggressive) add('Agresivo', 'danger');
    if (p.allergies) add(`Alergia: ${p.allergies}`, 'warning');
    if (p.overdue)
      add(p.overdue === 1 ? 'Refuerzo vencido' : `${p.overdue} refuerzos vencidos`, 'danger');
    return { shown: all.slice(0, MAX_TAGS), more: all.slice(MAX_TAGS) };
  }

  protected moreTitle(more: Tag[]): string {
    return more.map((t) => t.text).join(' · ');
  }

  /** Lectura completa de la fila para lectores de pantalla */
  protected rowLabel(p: PatientRow): string {
    const t = this.tags(p);
    return [
      `Historia de ${p.name}, ${petCode(p.number)}`,
      this.meta(p),
      `dueño ${p.client.name}`,
      p.lastVisit
        ? `última atención: ${this.lastTitle(p)}, ${this.when(p.lastVisit.openedAt)}`
        : 'sin atenciones',
      ...[...t.shown, ...t.more].map((x) => x.text),
    ].join('. ');
  }
}
