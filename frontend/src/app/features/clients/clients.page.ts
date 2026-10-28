import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  ClientPage,
  ClientStatus,
  DOCUMENT_SHORT,
  FRONT_DESK_ROLES,
  SPECIES_LABELS,
  Species,
} from '../../core/services/clients.models';
import { ClientsService } from '../../core/services/clients.service';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatPhone } from '../../shared/utils/peru';
import { clientCode, initials, relativeDay } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';

type LoadState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: ClientPage };

const STATUS_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
  { value: 'all', label: 'Todos' },
];

@Component({
  selector: 'app-clients-page',
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './clients.page.html',
})
export class ClientsPage {
  private readonly clients = inject(ClientsService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);

  /** Parámetros de la URL (?q=&page=&estado=): la búsqueda se puede compartir y "Atrás" la conserva. */
  readonly q = input<string>();
  readonly page = input<string>();
  readonly estado = input<string>();

  protected readonly docShort = DOCUMENT_SHORT;
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly formatPhone = formatPhone;
  protected readonly clientCode = clientCode;
  protected readonly initials = initials;
  protected readonly relativeDay = relativeDay;
  protected readonly isAdmin = computed(() => this.session.isAdmin());
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly status = new FormControl<ClientStatus>('active', { nonNullable: true });
  private readonly retry = signal(0);

  private readonly query = computed(() => ({
    q: (this.q() ?? '').trim(),
    page: Math.max(1, Number(this.page()) || 1),
    status: (['active', 'inactive', 'all'].includes(this.estado() ?? '')
      ? this.estado()
      : 'active') as ClientStatus,
    retry: this.retry(),
  }));

  protected readonly state = toSignal(
    toObservable(this.query).pipe(
      switchMap((query) =>
        this.clients.list(query).pipe(
          map((data): LoadState => ({ kind: 'ready', data })),
          catchError((error: unknown) =>
            of<LoadState>({
              kind: 'error',
              message: apiErrorMessage(error, 'No se pudo cargar la lista de clientes.'),
            }),
          ),
          startWith<LoadState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: { kind: 'loading' } as LoadState },
  );

  protected readonly searching = computed(() => this.query().q.length > 0);
  protected readonly range = computed(() => {
    const s = this.state();
    if (s.kind !== 'ready' || s.data.total === 0) return null;
    const { page, pageSize, total } = s.data;
    const from = (page - 1) * pageSize + 1;
    return { from, to: Math.min(total, from + s.data.items.length - 1), total };
  });
  protected readonly hasNext = computed(() => {
    const s = this.state();
    return s.kind === 'ready' && s.data.page * s.data.pageSize < s.data.total;
  });

  constructor() {
    // La URL manda: si cambia (buscador de la cabecera, Atrás), el campo se actualiza.
    effect(() => {
      const { q, status } = this.query();
      if (this.search.value !== q) this.search.setValue(q, { emitEvent: false });
      if (this.status.value !== status) this.status.setValue(status, { emitEvent: false });
    });
    this.search.valueChanges
      .pipe(
        map((value) => value.trim()),
        debounceTime(300),
        distinctUntilChanged(),
      )
      .subscribe((q) => this.navigate({ q: q || null, page: null }));
    this.status.valueChanges.subscribe((status) =>
      this.navigate({ estado: status === 'active' ? null : status, page: null }),
    );
  }

  protected speciesLabel(species: Species): string {
    return this.speciesLabels[species];
  }

  protected goTo(page: number): void {
    this.navigate({ page: page > 1 ? page : null });
    window.scrollTo?.({ top: 0 });
  }

  protected reload(): void {
    this.retry.update((n) => n + 1);
  }

  protected clearSearch(): void {
    this.search.setValue('');
  }

  private navigate(params: Record<string, string | number | null>): void {
    this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
