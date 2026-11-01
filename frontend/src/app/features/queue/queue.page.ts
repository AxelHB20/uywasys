import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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
  ClientSummary,
  FRONT_DESK_ROLES,
  PetBadge,
  SPECIES_LABELS,
} from '../../core/services/clients.models';
import { ClientsService } from '../../core/services/clients.service';
import { QueueItem, QueueService, QueueStatus } from '../../core/services/queue.service';
import { VisitsService } from '../../core/services/visits.service';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { SPECIES_ICONS } from '../../shared/utils/records';
import { apiErrorDetails, apiErrorMessage } from '../../shared/utils/validators';
import { QueueCardComponent } from './queue-card.component';
import { clockTime, durationLabel, minutesBetween } from './queue-time';

type Column = 'ARRIVED' | 'WAITING' | 'IN_PROGRESS';
type Tab = Column | 'CLOSED';
type Search =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: ClientSummary[] };

const REFRESH_MS = 30_000;

export const COLUMNS: {
  status: Column;
  label: string;
  short: string;
  hint: string;
  accent: string;
}[] = [
  {
    status: 'ARRIVED',
    label: 'Llegó',
    short: 'Llegó',
    hint: 'Registrados en recepción',
    accent: 'bg-slate-400',
  },
  {
    status: 'WAITING',
    label: 'En espera',
    short: 'Espera',
    hint: 'Listos para pasar',
    accent: 'bg-maiz-400',
  },
  {
    status: 'IN_PROGRESS',
    label: 'En atención',
    short: 'Atención',
    hint: 'Con el veterinario',
    accent: 'bg-anil-500',
  },
];

@Component({
  selector: 'app-queue-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    QueueCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './queue.page.html',
})
export class QueuePage {
  private readonly queue = inject(QueueService);
  private readonly clients = inject(ClientsService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);
  private readonly visits = inject(VisitsService);
  private readonly router = inject(Router);

  protected readonly columns = COLUMNS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly clockTime = clockTime;
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );

  protected readonly items = signal<QueueItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly now = signal(new Date());
  protected readonly busyId = signal<number | null>(null);
  protected readonly tab = signal<Tab>('ARRIVED');

  protected readonly byStatus = computed(() => {
    const groups: Record<Column, QueueItem[]> = { ARRIVED: [], WAITING: [], IN_PROGRESS: [] };
    for (const item of this.items()) {
      if (item.status in groups) groups[item.status as Column].push(item);
    }
    // Urgencias primero, luego por hora de llegada
    for (const list of Object.values(groups)) {
      list.sort(
        (a, b) => Number(b.urgent) - Number(a.urgent) || a.arrivedAt.localeCompare(b.arrivedAt),
      );
    }
    return groups;
  });
  protected readonly closed = computed(() =>
    this.items()
      .filter((i) => i.status === 'DONE' || i.status === 'CANCELLED')
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '')),
  );
  protected readonly openCount = computed(() => this.items().length - this.closed().length);
  protected readonly urgentCount = computed(
    () => this.items().filter((i) => i.urgent && !['DONE', 'CANCELLED'].includes(i.status)).length,
  );
  protected readonly doneCount = computed(
    () => this.closed().filter((i) => i.status === 'DONE').length,
  );
  protected readonly todayLabel = computed(() => {
    const text = new Intl.DateTimeFormat('es-PE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'America/Lima',
    }).format(this.now());
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  // Sacar de la cola
  protected readonly cancelling = signal<QueueItem | null>(null);

  // Agregar a la cola
  protected readonly addOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly selected = signal<{ client: ClientSummary; pet: PetBadge } | null>(null);
  protected readonly addForm = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    urgent: new FormControl(false, { nonNullable: true }),
  });
  protected readonly results = toSignal(
    this.search.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<Search>({ kind: 'idle' })
          : this.clients.list({ q }).pipe(
              map((page): Search => ({ kind: 'ready', items: page.items.slice(0, 6) })),
              catchError(() => of<Search>({ kind: 'error' })),
              startWith<Search>({ kind: 'loading' }),
            ),
      ),
    ),
    { initialValue: { kind: 'idle' } as Search },
  );
  /** Mascotas que ya están en la cola abierta: no se pueden volver a agregar. */
  private readonly openPetIds = computed(
    () =>
      new Set(
        this.items()
          .filter((i) => !['DONE', 'CANCELLED'].includes(i.status))
          .map((i) => i.pet.id),
      ),
  );

  constructor() {
    this.load();
    const timer = setInterval(() => {
      this.now.set(new Date());
      this.load(true);
    }, REFRESH_MS);
    // Al volver a la pestaña se actualiza de inmediato
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        this.now.set(new Date());
        this.load(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  /** silent = refresco automático: no muestra el esqueleto ni borra lo que ya se ve. */
  protected load(silent = false): void {
    if (!silent) {
      this.loading.set(true);
      this.loadError.set(null);
    }
    this.queue.today().subscribe({
      next: ({ items }) => {
        this.items.set(items);
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        if (!silent || this.items().length === 0)
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la cola.'));
      },
    });
  }

  protected count(status: Tab): number {
    return status === 'CLOSED' ? this.closed().length : this.byStatus()[status].length;
  }

  protected move(item: QueueItem, status: QueueStatus): void {
    this.patch(item, { status }, () => {
      if (status === 'DONE') this.toast.success(`${item.pet.name} terminó su atención`);
    });
  }

  /** Abre la atención y lleva a su pantalla. Si ya había una abierta, lleva a esa. */
  protected attend(item: QueueItem): void {
    if (this.busyId()) return;
    // Grooming: pasa por el ingreso (tamaño, servicios y checklist)
    if (item.type === 'GROOMING') {
      void this.router.navigate(['/grooming/ingreso'], {
        queryParams: { petId: item.pet.id, cola: item.id },
      });
      return;
    }
    this.busyId.set(item.id);
    this.visits.open(item.pet.id, item.id).subscribe({
      next: (visit) => {
        this.busyId.set(null);
        void this.router.navigate(['/atenciones', visit.id]);
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        const { visitId } = apiErrorDetails<{ visitId: number }>(error);
        if (visitId) {
          void this.router.navigate(['/atenciones', visitId]);
          return;
        }
        this.toast.error(apiErrorMessage(error));
        this.load(true);
      },
    });
  }

  protected toggleUrgent(item: QueueItem): void {
    this.patch(item, { urgent: !item.urgent });
  }

  protected confirmCancel(): void {
    const item = this.cancelling();
    if (!item) return;
    this.patch(item, { status: 'CANCELLED' }, () => {
      this.cancelling.set(null);
      this.toast.info(`${item.pet.name} salió de la cola`);
    });
  }

  protected closedSummary(item: QueueItem): string {
    if (item.status === 'CANCELLED') return 'Cancelado';
    const parts = ['Atendido'];
    if (item.attendedBy) parts.push(`por ${item.attendedBy.fullName}`);
    if (item.startedAt && item.finishedAt)
      parts.push(`en ${durationLabel(minutesBetween(item.startedAt, item.finishedAt))}`);
    return parts.join(' ');
  }

  // ── Agregar a la cola ──
  protected openAdd(): void {
    this.search.setValue('');
    this.selected.set(null);
    this.addForm.reset({ reason: '', urgent: false });
    this.addOpen.set(true);
  }

  protected pick(client: ClientSummary, pet: PetBadge): void {
    if (this.inQueue(pet.id)) return;
    this.selected.set({ client, pet });
  }

  protected inQueue(petId: number): boolean {
    return this.openPetIds().has(petId);
  }

  protected activePets(client: ClientSummary): PetBadge[] {
    return client.pets.filter((p) => p.active);
  }

  protected addToQueue(): void {
    const sel = this.selected();
    if (!sel || this.saving() || this.addForm.invalid) return;
    const v = this.addForm.getRawValue();
    this.saving.set(true);
    this.queue
      .add({ petId: sel.pet.id, urgent: v.urgent, reason: v.reason.trim() || null })
      .subscribe({
        next: (item) => {
          this.items.update((list) => [...list, item]);
          this.saving.set(false);
          this.addOpen.set(false);
          this.tab.set('ARRIVED');
          this.toast.success(`${sel.pet.name} está en la cola`);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  private patch(
    item: QueueItem,
    changes: Parameters<QueueService['update']>[1],
    done?: () => void,
  ): void {
    if (this.busyId()) return;
    this.busyId.set(item.id);
    this.queue.update(item.id, changes).subscribe({
      next: (updated) => {
        this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
        this.busyId.set(null);
        done?.();
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.toast.error(apiErrorMessage(error));
        // Alguien más pudo haberla cambiado: se recarga para mostrar el estado real
        this.load(true);
      },
    });
  }
}
