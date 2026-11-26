import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
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
  DOCUMENT_SHORT,
  FRONT_DESK_ROLES,
  PetBadge,
  SEX_LABELS,
  SPECIES_LABELS,
} from '../../core/services/clients.models';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { SPECIES_ICONS, clientCode, petCode, relativeDay } from '../../shared/utils/records';
import { ClientsService } from '../../core/services/clients.service';
import { QueueItem, QueueService, QueueStatus } from '../../core/services/queue.service';
import { VisitsService } from '../../core/services/visits.service';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorDetails, apiErrorMessage } from '../../shared/utils/validators';
import { MarkTextComponent } from '../../shared/ui/mark-text/mark-text.component';
import {
  TransportFieldsComponent,
  transportGroup,
  transportInvalid,
  transportValue,
} from '../../shared/ui/transport-fields/transport-fields.component';
import { TRANSPORT_LABELS } from '../../core/services/grooming.models';
import { money } from '../../shared/utils/stock';
import { QueueCardComponent } from './queue-card.component';
import { clockTime, durationLabel, minutesBetween } from './queue-time';

type Column = 'ARRIVED' | 'WAITING' | 'IN_PROGRESS';
type Tab = Column | 'CLOSED';
type Search =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: ClientSummary[]; total: number };

/** Clientes que se muestran a la vez: con más, se pide escribir más */
const SHOWN_CLIENTS = 6;
/** Motivos más comunes en recepción (se pueden editar después) */
const QUICK_REASONS = ['Consulta', 'Vacuna', 'Control', 'Desparasitación', 'Curación'];
const OPEN_STATUS_LABEL: Partial<Record<QueueStatus, string>> = {
  ARRIVED: 'Llegó',
  WAITING: 'En espera',
  IN_PROGRESS: 'En atención',
};

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
    MarkTextComponent,
    TransportFieldsComponent,
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
  /** Caja no abre la historia clínica; el groomer solo las atenciones de grooming */
  protected canOpenVisit(type: string): boolean {
    const role = this.session.role();
    return role === 'GROOMER' ? type === 'GROOMING' : role !== 'CASHIER';
  }

  /** Recepción ordena la cola; la consulta la abre el veterinario (queda a su nombre) */
  protected readonly canAttend = computed(() => this.session.role() !== 'RECEPTION');
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
      // Primero los que falta llevar a su casa
      .sort(
        (a, b) =>
          Number(b.homePending) - Number(a.homePending) ||
          (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''),
      ),
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
    move: transportGroup(),
  });
  protected readonly addSubmitted = signal(false);
  /** Dirección registrada y último precio de movilidad del dueño elegido */
  protected readonly clientAddress = signal('');
  protected readonly lastTransportPrice = signal<number | null>(null);
  /** Sacar de la cola con movilidad: ya fueron a recogerlo, se cobra igual */
  protected readonly chargeTransport = new FormControl(false, { nonNullable: true });
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly money = money;
  /** Consultas atendidas que falta llevar a su casa */
  protected readonly homePending = computed(() => this.items().filter((i) => i.homePending));
  protected readonly results = toSignal(
    this.search.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<Search>({ kind: 'idle' })
          : this.clients.list({ q }).pipe(
              map((page): Search => ({
                kind: 'ready',
                items: page.items.slice(0, SHOWN_CLIENTS),
                total: page.total,
              })),
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

  /** ?agregar=1 (desde el inicio): abre "Agregar a la cola" */
  readonly agregar = input<string>();

  constructor() {
    afterNextRender(() => {
      if (this.agregar() && this.canEdit()) this.openAdd();
    });
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
        queryParams: {
          petId: item.pet.id,
          cola: item.id,
          // La movilidad que se acordó en la cita pasa al ingreso
          ...(item.transport !== 'NONE'
            ? {
                movilidad: item.transport,
                direccion: item.transportAddress ?? undefined,
                precio: item.transportPrice ?? undefined,
              }
            : {}),
        },
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

  // ── Movilidad después ("ya no puede volver, llévenlo") ──
  protected readonly moving = signal<QueueItem | null>(null);
  protected readonly moveForm = transportGroup();
  protected readonly moveSubmitted = signal(false);

  protected openMove(item: QueueItem): void {
    this.moveForm.reset({
      transport: item.transport,
      transportAddress: item.transportAddress ?? '',
      transportPrice: item.transportPrice,
    });
    this.moveSubmitted.set(false);
    this.clientAddress.set('');
    this.lastTransportPrice.set(null);
    this.moving.set(item);
    this.clients.get(item.client.id).subscribe({
      next: (c) => {
        const address = [c.address, c.district].filter(Boolean).join(', ');
        this.clientAddress.set(address);
        const control = this.moveForm.controls.transportAddress;
        if (this.moveForm.controls.transport.value !== 'NONE' && !control.value.trim())
          control.setValue(address);
      },
      error: () => undefined,
    });
    this.visits.lastTransportPrice(item.client.id).subscribe({
      next: ({ price }) => {
        this.lastTransportPrice.set(price);
        const control = this.moveForm.controls.transportPrice;
        if (this.moveForm.controls.transport.value !== 'NONE' && control.value === null)
          control.setValue(price);
      },
      error: () => undefined,
    });
  }

  protected saveMove(): void {
    const item = this.moving();
    this.moveSubmitted.set(true);
    if (!item || transportInvalid(this.moveForm)) return;
    const move = transportValue(this.moveForm);
    this.patch(item, move, () => {
      this.moving.set(null);
      this.toast.success(
        move.transport === 'NONE'
          ? `${item.pet.name}: sin movilidad`
          : `${item.pet.name}: ${this.moveText({ ...item, ...move })}`,
      );
    });
  }

  protected askCancel(item: QueueItem): void {
    this.chargeTransport.setValue(false);
    this.cancelling.set(item);
  }

  protected confirmCancel(): void {
    const item = this.cancelling();
    if (!item) return;
    const charge = !!item.transportPrice && this.chargeTransport.value;
    this.patch(item, { status: 'CANCELLED', ...(charge ? { chargeTransport: true } : {}) }, () => {
      this.cancelling.set(null);
      this.toast.info(
        charge
          ? `${item.pet.name} salió de la cola; la movilidad queda por cobrar en Caja`
          : `${item.pet.name} salió de la cola`,
      );
    });
  }

  /** Consulta con entrega: ya se dejó en su casa */
  protected deliveredHome(item: QueueItem): void {
    if (this.busyId()) return;
    this.busyId.set(item.id);
    this.queue.deliveredHome(item.id).subscribe({
      next: (updated) => {
        this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
        this.busyId.set(null);
        this.toast.success(`${item.pet.name} quedó entregado en su casa`);
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.toast.error(apiErrorMessage(error));
        this.load(true);
      },
    });
  }

  /** "2 por llevar a casa": lleva a Terminados (en celular es una pestaña) */
  protected showHomePending(): void {
    this.tab.set('CLOSED');
    setTimeout(() =>
      document
        .getElementById('closed-title')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  protected moveText(item: QueueItem): string {
    // Cancelada: la movilidad se quitó (o quedó en Caja si se cobró igual)
    const price =
      item.transportPrice && item.status !== 'CANCELLED' ? ` · ${money(item.transportPrice)}` : '';
    return `${TRANSPORT_LABELS[item.transport]}${price}`;
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
    this.addForm.reset({
      reason: '',
      urgent: false,
      move: { transport: 'NONE', transportAddress: '', transportPrice: null },
    });
    this.addSubmitted.set(false);
    this.clientAddress.set('');
    this.lastTransportPrice.set(null);
    this.addOpen.set(true);
  }

  protected pick(client: ClientSummary, pet: PetBadge): void {
    if (this.inQueue(pet.id)) return;
    this.selected.set({ client, pet });
    // Para la movilidad: su dirección y lo que pagó la última vez
    this.clientAddress.set('');
    this.lastTransportPrice.set(null);
    this.clients.get(client.id).subscribe({
      next: (c) => this.clientAddress.set([c.address, c.district].filter(Boolean).join(', ')),
      error: () => undefined,
    });
    this.visits.lastTransportPrice(client.id).subscribe({
      next: ({ price }) => this.lastTransportPrice.set(price),
      error: () => undefined,
    });
  }

  protected inQueue(petId: number): boolean {
    return this.openPetIds().has(petId);
  }

  // ── Datos para reconocer al cliente y a la mascota ──
  protected readonly quickReasons = QUICK_REASONS;
  protected readonly docShort = DOCUMENT_SHORT;
  protected readonly phone = formatPhone;
  protected readonly hc = petCode;
  protected readonly clientCode = clientCode;

  /** "Perro · Hembra · 2 años · Shih tzu" (lo que haya) */
  protected petLine(pet: PetBadge): string {
    return [
      SPECIES_LABELS[pet.species],
      pet.sex ? SEX_LABELS[pet.sex] : null,
      petAge(pet.birthDate ?? null),
      pet.breed,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected lastVisitLabel(client: ClientSummary): string | null {
    return client.lastVisit
      ? `Última visita: ${relativeDay(client.lastVisit).toLowerCase()}`
      : null;
  }

  /** "Ya en la cola · En espera" */
  protected queueStatus(petId: number): string | null {
    const item = this.items().find(
      (i) => i.pet.id === petId && !['DONE', 'CANCELLED'].includes(i.status),
    );
    return item ? (OPEN_STATUS_LABEL[item.status] ?? 'en curso') : null;
  }

  /** Lo que se puede elegir en los resultados (activas y que no están ya en la cola) */
  private readonly choices = computed(() => {
    const found = this.results();
    if (found.kind !== 'ready') return [];
    return found.items.flatMap((client) =>
      this.activePets(client)
        .filter((pet) => !this.inQueue(pet.id))
        .map((pet) => ({ client, pet })),
    );
  });

  /** Enter en el buscador: si hay una sola mascota posible, se elige */
  protected pickOnlyChoice(event: Event): void {
    event.preventDefault();
    const choices = this.choices();
    if (choices.length === 1) this.pick(choices[0].client, choices[0].pet);
  }

  protected setReason(reason: string): void {
    this.addForm.controls.reason.setValue(reason);
    this.addForm.controls.reason.markAsDirty();
  }

  /** "Registrar cliente nuevo" con lo que se escribió: números al DNI o al celular, letras al nombre */
  protected readonly newClientQuery = computed(() => {
    const q = (this.searchValue() ?? '').trim();
    return q ? { buscar: q } : {};
  });
  private readonly searchValue = toSignal(this.search.valueChanges, { initialValue: '' });

  protected activePets(client: ClientSummary): PetBadge[] {
    return client.pets.filter((p) => p.active);
  }

  protected addToQueue(): void {
    const sel = this.selected();
    this.addSubmitted.set(true);
    if (
      !sel ||
      this.saving() ||
      this.addForm.invalid ||
      transportInvalid(this.addForm.controls.move)
    )
      return;
    const v = this.addForm.getRawValue();
    const move = transportValue(this.addForm.controls.move);
    this.saving.set(true);
    this.queue
      .add({
        petId: sel.pet.id,
        urgent: v.urgent,
        reason: v.reason.trim() || null,
        ...(move.transport !== 'NONE' ? move : {}),
      })
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
