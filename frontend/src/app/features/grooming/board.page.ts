import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { CASH_ROLES } from '../../core/services/cash.models';
import { ClientsService } from '../../core/services/clients.service';
import {
  BOARD_STATUSES,
  BoardStatus,
  GROOMING_STATUS_LABELS,
  Groomer,
  GroomingCard,
  GroomingDetail,
  PET_SIZE_LABELS,
  TRANSPORT_LABELS,
  canMove,
  checklistFlags,
  nextStatus,
  readyMessageLink,
} from '../../core/services/grooming.models';
import { GroomingService } from '../../core/services/grooming.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { addDays } from '../../core/services/medical.models';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { SPECIES_ICONS } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { clockTime, durationLabel, minutesBetween } from '../queue/queue-time';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { VisitsService } from '../../core/services/visits.service';
import {
  TransportFieldsComponent,
  transportGroup,
  transportInvalid,
  transportValue,
} from '../../shared/ui/transport-fields/transport-fields.component';

const REFRESH_MS = 30_000;
const GROOMING_ROLES = ['ADMIN', 'VET', 'RECEPTION', 'GROOMER'];

const COLUMN_STYLE: Record<
  BoardStatus,
  { dot: string; ring: string; empty: string; icon: IconName; tile: string; accent: string }
> = {
  WAITING: {
    dot: 'bg-slate-400',
    ring: 'ring-slate-200',
    empty: 'Nadie esperando',
    icon: 'clock',
    tile: 'bg-slate-100 text-slate-600',
    accent: 'border-l-slate-300',
  },
  BATHING: {
    dot: 'bg-sky-500',
    ring: 'ring-sky-200',
    empty: 'Nadie en el baño',
    icon: 'droplets',
    tile: 'bg-sky-50 text-sky-700',
    accent: 'border-l-sky-400',
  },
  CUTTING: {
    dot: 'bg-violet-500',
    ring: 'ring-violet-200',
    empty: 'Nadie en corte',
    icon: 'scissors',
    tile: 'bg-violet-50 text-violet-700',
    accent: 'border-l-violet-400',
  },
  READY: {
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-200',
    empty: 'Nadie listo todavía',
    icon: 'check',
    tile: 'bg-emerald-50 text-emerald-700',
    accent: 'border-l-emerald-500',
  },
};

export type PickupTone = 'late' | 'soon' | 'ok' | 'waiting';
const PICKUP_CLASS: Record<PickupTone, string> = {
  late: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  soon: 'bg-maiz-100 text-amber-900 ring-amber-600/25',
  ok: 'bg-slate-50 text-slate-600 ring-slate-500/15',
  waiting: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
};

interface Pickup {
  key: string;
  name: string;
  document: string | null;
  relation: string;
}

/**
 * Tablero del día: En espera → Baño → Corte → Listo. En escritorio se arrastra la tarjeta;
 * en el celular, "Avanzar". Si el servidor rechaza el cambio, la tarjeta vuelve a su columna.
 */
@Component({
  selector: 'app-grooming-board-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    FechaPipe,
    IconComponent,
    ModalComponent,
    TransportFieldsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.page.html',
})
export class GroomingBoardPage {
  private readonly api = inject(GroomingService);
  private readonly clients = inject(ClientsService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly cardsApi = inject(ImmunizationsService);
  private readonly visitsApi = inject(VisitsService);

  /** ?dia=AAAA-MM-DD (historial de otro día) */
  readonly dia = input<string>();

  protected readonly statuses = BOARD_STATUSES;
  protected readonly statusLabels = GROOMING_STATUS_LABELS;
  protected readonly columnStyle = COLUMN_STYLE;
  protected readonly pickupClass = PICKUP_CLASS;
  protected readonly sizeLabels = PET_SIZE_LABELS;
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly money = money;
  protected readonly clock = clockTime;
  protected readonly flags = checklistFlags;
  protected readonly nextStatus = nextStatus;
  protected readonly today = limaToday();

  protected readonly canEdit = computed(() => GROOMING_ROLES.includes(this.session.role() ?? ''));
  protected readonly canCancel = computed(() =>
    ['ADMIN', 'RECEPTION'].includes(this.session.role() ?? ''),
  );
  protected readonly canCollect = computed(() =>
    CASH_ROLES.includes(this.session.role() ?? 'GROOMER'),
  );

  protected readonly day = signal(this.today);
  protected readonly isToday = computed(() => this.day() === this.today);
  protected readonly dayLabel = computed(() =>
    this.isToday() ? 'Hoy' : formatDate(this.day(), 'calendar'),
  );
  protected readonly cards = signal<GroomingCard[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly now = signal(new Date());
  protected readonly busyId = signal<number | null>(null);
  protected readonly tab = signal<BoardStatus>('WAITING');
  protected readonly groomers = signal<Groomer[]>([]);

  protected readonly columns = computed(() => {
    const cards = this.cards();
    return BOARD_STATUSES.map((status) => ({
      status,
      items: cards
        .filter((c) => c.status === status)
        .sort((a, b) => a.checkInAt.localeCompare(b.checkInAt)),
    }));
  });
  protected readonly finished = computed(() =>
    this.cards()
      .filter((c) => c.status === 'DELIVERED' || c.status === 'CANCELLED')
      .sort((a, b) =>
        (b.deliveredAt ?? b.cancelledAt ?? '').localeCompare(a.deliveredAt ?? a.cancelledAt ?? ''),
      ),
  );
  protected readonly counts = computed(() => {
    const cards = this.cards();
    const now = this.now();
    const active = cards.filter((c) => BOARD_STATUSES.includes(c.status as BoardStatus));
    const ready = active.filter((c) => c.status === 'READY');
    const delivered = cards.filter((c) => c.status === 'DELIVERED');
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      active: active.length,
      inProgress: active.filter((c) => c.status === 'BATHING' || c.status === 'CUTTING').length,
      ready: ready.length,
      notified: ready.filter((c) => c.notifiedAt).length,
      late: active.filter(
        (c) => c.status !== 'READY' && !!c.promisedAt && new Date(c.promisedAt) < now,
      ).length,
      delivered: delivered.length,
      revenue: round(
        cards.filter((c) => c.status !== 'CANCELLED').reduce((sum, c) => sum + c.total, 0),
      ),
      pending: round(delivered.reduce((sum, c) => sum + c.pending, 0)),
    };
  });

  // ── Detalle ──
  protected readonly selectedId = signal<number | null>(null);
  protected readonly selected = computed(
    () => this.cards().find((c) => c.id === this.selectedId()) ?? null,
  );
  protected readonly detail = signal<GroomingDetail | null>(null);
  protected readonly groomerControl = new FormControl<number | null>(null);

  // ── Movilidad después del ingreso: "ya no puede volver, llévenlo" ──
  protected readonly editingMove = signal(false);
  protected readonly moveSaving = signal(false);
  protected readonly moveSubmitted = signal(false);
  protected readonly moveForm = transportGroup();
  protected readonly moveAddress = signal('');
  protected readonly moveLastPrice = signal<number | null>(null);

  protected startMove(d: GroomingDetail): void {
    this.moveForm.reset({
      transport: d.transport,
      transportAddress: d.transportAddress ?? '',
      transportPrice: d.transportPrice,
    });
    this.moveSubmitted.set(false);
    this.moveAddress.set('');
    this.moveLastPrice.set(null);
    this.editingMove.set(true);
    this.cardsApi.card(d.pet.id).subscribe({
      next: (card) => {
        const c = card.pet.client;
        this.moveAddress.set([c.address, c.district].filter(Boolean).join(', '));
      },
      error: () => undefined,
    });
    this.visitsApi.lastTransportPrice(d.client.id).subscribe({
      next: ({ price }) => this.moveLastPrice.set(price),
      error: () => undefined,
    });
  }

  protected saveMove(d: GroomingDetail): void {
    this.moveSubmitted.set(true);
    if (this.moveSaving() || transportInvalid(this.moveForm)) return;
    this.moveSaving.set(true);
    this.api.changeTransport(d.id, transportValue(this.moveForm)).subscribe({
      next: (updated) => {
        this.moveSaving.set(false);
        this.editingMove.set(false);
        this.detail.set(updated);
        this.patch(updated);
        this.toast.success(
          updated.transport === 'NONE'
            ? 'Sin movilidad.'
            : `${TRANSPORT_LABELS[updated.transport]}${
                updated.transportPrice ? ` · ${money(updated.transportPrice)}` : ''
              }: queda en la cuenta.`,
        );
      },
      error: (error: unknown) => {
        this.moveSaving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  // ── Entrega ──
  protected readonly delivering = signal<GroomingCard | null>(null);
  protected readonly pickups = signal<Pickup[]>([]);
  protected readonly pickupKey = signal<string>('owner');
  protected readonly deliverForm = new FormGroup({
    pickedUpBy: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(150)],
    }),
    pickedUpDocument: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(20),
    }),
    pickedUpRelation: new FormControl('Propietario(a)', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(40)],
    }),
  });

  // ── Cancelar ──
  protected readonly cancelling = signal<GroomingCard | null>(null);
  /** Ya fueron a recogerlo: la movilidad se cobra igual */
  protected readonly chargeTransport = new FormControl(false, { nonNullable: true });
  protected readonly cancelReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    effect(() => {
      const dia = this.dia();
      this.day.set(dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= this.today ? dia : this.today);
      this.load();
    });
    this.api.groomers().subscribe({ next: (g) => this.groomers.set(g), error: () => undefined });
    const timer = setInterval(() => {
      this.now.set(new Date());
      if (this.isToday() && !this.busyId()) this.load(true);
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    this.groomerControl.valueChanges.subscribe((groomerId) => this.assign(groomerId));
  }

  protected load(silent = false): void {
    if (!silent) this.loading.set(true);
    this.api.board(this.isToday() ? undefined : this.day()).subscribe({
      next: (cards) => {
        this.cards.set(cards);
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        if (!silent) this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el tablero.'));
      },
    });
  }

  protected goDay(offset: number): void {
    const day = addDays(this.day(), offset);
    if (day > this.today) return;
    void this.router.navigate([], { queryParams: { dia: day === this.today ? null : day } });
  }

  protected elapsed(c: GroomingCard): string {
    const since =
      c.status === 'READY'
        ? c.readyAt
        : c.status === 'CUTTING'
          ? c.cuttingAt
          : c.status === 'BATHING'
            ? c.bathingAt
            : c.checkInAt;
    return durationLabel(minutesBetween(since ?? c.checkInAt, this.now()));
  }

  /** Pasó la hora de recojo acordada y todavía no está listo */
  protected late(c: GroomingCard): boolean {
    return (
      !!c.promisedAt &&
      c.status !== 'READY' &&
      BOARD_STATUSES.includes(c.status as BoardStatus) &&
      new Date(c.promisedAt) < this.now()
    );
  }

  /** Hora de recojo con su urgencia: "Atrasado 12 min", "en 20 min", "Recojo 17:30" */
  protected pickup(c: GroomingCard): { text: string; tone: PickupTone } | null {
    if (!c.promisedAt) return null;
    const minutes = Math.round((new Date(c.promisedAt).getTime() - this.now().getTime()) / 60_000);
    const at = clockTime(c.promisedAt);
    if (c.status === 'READY')
      return minutes < 0
        ? { text: `Espera recojo · ${at}`, tone: 'waiting' }
        : { text: `Recojo ${at}`, tone: 'ok' };
    if (minutes < 0) return { text: `Atrasado ${durationLabel(-minutes)}`, tone: 'late' };
    if (minutes <= 30) return { text: `En ${durationLabel(minutes)} · ${at}`, tone: 'soon' };
    return { text: `Recojo ${at}`, tone: 'ok' };
  }

  /** Servicios en chips cortos: sin el tamaño entre paréntesis (ya está en la tarjeta) */
  protected serviceChips(c: GroomingCard): { shown: string[]; more: number } {
    const names = c.services.map(
      (s) =>
        (s.quantity > 1 ? `${s.quantity} × ` : '') + s.description.replace(/\s*\([^)]*\)\s*$/, ''),
    );
    return { shown: names.slice(0, 3), more: Math.max(0, names.length - 3) };
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  }

  protected canMoveTo(c: GroomingCard, status: BoardStatus): boolean {
    return canMove(c.status, status);
  }

  protected servicesLine(c: GroomingCard): string {
    return c.services.map((s) => s.description).join(' + ') || 'Sin servicios';
  }

  protected whatsapp(c: GroomingCard): string | null {
    return readyMessageLink(c, this.session.clinicName());
  }

  protected enterPredicate = (drag: CdkDrag<GroomingCard>, drop: CdkDropList<BoardStatus>) =>
    canMove(drag.data.status, drop.data);

  protected drop(event: CdkDragDrop<BoardStatus, BoardStatus, GroomingCard>): void {
    if (event.previousContainer === event.container) return;
    this.move(event.item.data, event.container.data);
  }

  protected move(card: GroomingCard, status: BoardStatus): void {
    if (this.busyId() || !canMove(card.status, status)) return;
    const before = card.status;
    // Optimista: la tarjeta cambia de columna ya; si falla, vuelve
    this.patch({ ...card, status });
    this.busyId.set(card.id);
    this.api.move(card.id, status).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.patch(updated);
        if (status === 'READY' && this.whatsapp(updated))
          this.toast.success(`${updated.pet.name} está listo: avísale al dueño por WhatsApp.`);
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.patch({ ...card, status: before });
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected open(card: GroomingCard): void {
    this.selectedId.set(card.id);
    this.detail.set(null);
    this.editingMove.set(false);
    this.groomerControl.setValue(card.groomer?.id ?? null, { emitEvent: false });
    this.api.get(card.id).subscribe({
      next: (d) => this.detail.set(d),
      error: () => undefined,
    });
  }

  protected notified(c: GroomingCard): void {
    this.api
      .notify(c.id)
      .subscribe({ next: (updated) => this.patch(updated), error: () => undefined });
  }

  protected openDeliver(c: GroomingCard): void {
    this.selectedId.set(null);
    this.delivering.set(c);
    const owner: Pickup = {
      key: 'owner',
      name: c.client.name,
      document: null,
      relation: 'Propietario(a)',
    };
    this.pickups.set([owner]);
    this.choosePickup(owner);
    this.clients.get(c.client.id).subscribe({
      next: (client) => {
        const full = { ...owner, name: client.name, document: client.docNumber };
        this.pickups.set([
          full,
          ...client.authorized.map((p) => ({
            key: `a${p.id}`,
            name: p.name,
            document: p.dni,
            relation: p.relation || 'Persona autorizada',
          })),
        ]);
        if (this.pickupKey() === 'owner') this.choosePickup(full);
      },
      error: () => undefined,
    });
  }

  protected choosePickup(p: Pickup | null): void {
    this.pickupKey.set(p?.key ?? 'other');
    this.deliverForm.reset({
      pickedUpBy: p?.name ?? '',
      pickedUpDocument: p?.document ?? '',
      pickedUpRelation: p?.relation ?? '',
    });
  }

  protected confirmDeliver(): void {
    const c = this.delivering();
    if (!c || this.busyId()) return;
    if (this.deliverForm.invalid) {
      this.deliverForm.markAllAsTouched();
      return;
    }
    const v = this.deliverForm.getRawValue();
    this.busyId.set(c.id);
    this.api
      .deliver(c.id, {
        pickedUpBy: v.pickedUpBy.trim(),
        pickedUpDocument: v.pickedUpDocument.trim() || null,
        pickedUpRelation: v.pickedUpRelation.trim(),
      })
      .subscribe({
        next: (d) => {
          this.busyId.set(null);
          this.delivering.set(null);
          this.load(true);
          this.toast.success(
            d.pending > 0
              ? `${d.pet.name} entregado. Queda por cobrar ${money(d.pending)}.`
              : `${d.pet.name} entregado.`,
          );
          if (d.pending > 0 && this.canCollect())
            void this.router.navigate(['/caja'], { queryParams: { cobrar: d.client.id } });
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  protected openCancel(c: GroomingCard): void {
    this.selectedId.set(null);
    this.cancelReason.reset('');
    this.chargeTransport.setValue(false);
    this.cancelling.set(c);
  }

  protected confirmCancel(): void {
    const c = this.cancelling();
    if (!c || this.busyId()) return;
    if (this.cancelReason.invalid) {
      this.cancelReason.markAsTouched();
      return;
    }
    this.busyId.set(c.id);
    const charge = !!c.transportPrice && this.chargeTransport.value;
    this.api.cancel(c.id, this.cancelReason.value.trim(), charge).subscribe({
      next: () => {
        this.busyId.set(null);
        this.cancelling.set(null);
        this.load(true);
        this.toast.success(
          charge
            ? 'Servicio cancelado. La movilidad queda por cobrar en Caja.'
            : 'Servicio cancelado y sus cargos quitados.',
        );
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  private assign(groomerId: number | null): void {
    const c = this.selected();
    if (!c || (c.groomer?.id ?? null) === groomerId) return;
    this.api.assign(c.id, groomerId).subscribe({
      next: (updated) => this.patch(updated),
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  private patch(card: GroomingCard): void {
    this.cards.update((list) => list.map((c) => (c.id === card.id ? card : c)));
  }
}
