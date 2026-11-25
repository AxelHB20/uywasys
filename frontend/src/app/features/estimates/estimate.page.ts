import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES, SPECIES_LABELS } from '../../core/services/clients.models';
import {
  ESTIMATE_STATUS_LABELS,
  ESTIMATE_TONE,
  EstimatePrint,
  estimateMessage,
  validityView,
} from '../../core/services/estimates.models';
import { EstimatesService } from '../../core/services/estimates.service';
import { VisitSummary } from '../../core/services/visits.models';
import { QueueService } from '../../core/services/queue.service';
import { VisitsService } from '../../core/services/visits.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petCode } from '../../shared/utils/records';
import { formatQty, money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { downloadPdf } from '../../shared/utils/pdf';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';

type Modal = 'accept' | 'reject' | 'convert' | null;

/**
 * Presupuesto: documento imprimible (A4) y sus pasos — aceptar o no, y cargarlo a una
 * atención abierta de la mascota (o abrir una en ese momento).
 */
@Component({
  selector: 'app-estimate-page',
  imports: [
    BackLinkComponent,
    ReactiveFormsModule,
    RouterLink,
    FechaPipe,
    BadgeComponent,
    IconComponent,
    ModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './estimate.page.html',
})
export class EstimatePage {
  private readonly api = inject(EstimatesService);
  private readonly visits = inject(VisitsService);
  private readonly queue = inject(QueueService);
  private readonly session = inject(SessionService);
  /** Caja y groomer no abren la historia clínica */
  protected readonly canSeeRecord = computed(() =>
    ['ADMIN', 'VET', 'RECEPTION'].includes(this.session.role() ?? ''),
  );
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  protected readonly downloading = signal(false);

  readonly id = input.required<string>();
  /** ?atencion=… : atención a la que se quiere cargar */
  readonly atencion = input<string>();

  protected readonly labels = ESTIMATE_STATUS_LABELS;
  protected readonly tone = ESTIMATE_TONE;
  protected readonly species = SPECIES_LABELS;
  protected readonly docLabel: Record<string, string> = {
    DNI: 'DNI',
    CE: 'C.E.',
    RUC: 'RUC',
    PASSPORT: 'Pasaporte',
  };
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly formatQty = formatQty;
  protected readonly money = money;

  protected readonly estimate = signal<EstimatePrint | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl = computed(() =>
    this.logoFailed() ? null : (this.estimate()?.clinic.logoUrl ?? null),
  );
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
  /** Subtotal antes de descuentos, descuentos y parte exonerada/inafecta (si la hay) */
  protected readonly amounts = computed(() => {
    const e = this.estimate();
    if (!e) return { gross: 0, discount: 0, exempt: 0 };
    const r = (n: number) => Math.round(n * 100) / 100;
    const gross = r(e.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
    const discount = r(e.items.reduce((s, i) => s + i.discount, 0));
    return { gross, discount, exempt: Math.max(0, r(e.total - e.taxable - e.igv)) };
  });
  protected readonly validity = computed(() => {
    const e = this.estimate();
    return e ? validityView(e, limaToday()) : null;
  });
  /** Cerrado sin realizarse: se marca en el documento para que no se use por error */
  protected readonly watermark = computed(() => {
    const status = this.estimate()?.status;
    return status === 'EXPIRED' ? 'Vencido' : status === 'REJECTED' ? 'No aceptado' : null;
  });
  protected readonly hasControlled = computed(
    () => this.estimate()?.items.some((i) => i.controlled) ?? false,
  );

  protected readonly modal = signal<Modal>(null);
  protected readonly busy = signal(false);
  protected readonly note = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(200)],
  });
  protected readonly rx = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(60)],
  });
  protected readonly openVisits = signal<VisitSummary[]>([]);
  protected readonly visitsLoading = signal(false);
  protected readonly visitId = signal<number | null>(null);

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.loading.set(true);
      this.api.get(id).subscribe({
        next: (e) => {
          this.estimate.set(e);
          this.loading.set(false);
          // Viene desde una atención con un presupuesto aceptado: abre el paso de cargar
          if (this.atencion() && e.status === 'ACCEPTED' && this.canEdit()) this.openConvert();
        },
        error: (error: unknown) => {
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el presupuesto.'));
          this.loading.set(false);
        },
      });
    });
  }

  /** Chat del dueño con el resumen; sin celular registrado no hay a quién enviarlo */
  protected whatsapp(): string | null {
    const e = this.estimate()!;
    if (!e.client.phone) return null;
    const text = estimateMessage(e, e.clinic.name, money);
    return `https://wa.me/51${e.client.phone}?text=${encodeURIComponent(text)}`;
  }

  /** Archivo PDF de la hoja (PR-00004.pdf), para adjuntarlo en WhatsApp o un correo */
  protected async download(): Promise<void> {
    const element = this.sheet()?.nativeElement;
    const e = this.estimate();
    if (!element || !e || this.downloading()) return;
    this.downloading.set(true);
    try {
      await downloadPdf(element, e.code);
    } catch {
      this.toast.error('No se pudo generar el PDF. Usa Imprimir y elige "Guardar como PDF".');
    } finally {
      this.downloading.set(false);
    }
  }

  protected open(modal: Modal): void {
    this.note.reset('');
    this.modal.set(modal);
  }

  protected close(): void {
    if (!this.busy()) this.modal.set(null);
  }

  protected openConvert(): void {
    const e = this.estimate();
    if (!e) return;
    this.rx.reset('');
    this.modal.set('convert');
    this.visitsLoading.set(true);
    this.visits.list({ petId: e.pet.id, status: 'OPEN' }).subscribe({
      next: (page) => {
        this.openVisits.set(page.items);
        const wanted = Number(this.atencion());
        this.visitId.set(page.items.find((v) => v.id === wanted)?.id ?? page.items[0]?.id ?? null);
        this.visitsLoading.set(false);
      },
      error: () => {
        this.openVisits.set([]);
        this.visitsLoading.set(false);
      },
    });
  }

  protected decide(): void {
    const e = this.estimate();
    if (!e || this.busy()) return;
    this.busy.set(true);
    const note = this.note.value.trim() || null;
    const request =
      this.modal() === 'accept' ? this.api.accept(e.id, note) : this.api.reject(e.id, note);
    request.subscribe({
      next: (updated) =>
        this.done(
          updated,
          updated.status === 'ACCEPTED' ? 'Presupuesto aceptado.' : 'Presupuesto cerrado.',
        ),
      error: (error: unknown) => this.fail(error),
    });
  }

  protected convert(): void {
    const e = this.estimate();
    if (!e || this.busy()) return;
    if (this.hasControlled() && this.rx.invalid) {
      this.rx.markAsTouched();
      return;
    }
    // Se carga solo a una atención que ya abrió el veterinario (desde la cola): así queda quién
    // atendió y la mascota pasa por el circuito normal de recepción → cola → atención → caja.
    const visitId = this.visitId();
    if (!visitId) return;
    this.busy.set(true);
    const rx = this.hasControlled() ? this.rx.value.trim() : null;
    this.api.convert(e.id, visitId, rx).subscribe({
      next: (updated) => this.done(updated, `Cargado a la atención de ${updated.pet.name}.`),
      error: (error: unknown) => this.fail(error),
    });
  }

  /** Sin atención abierta: llega por la cola, como cualquier paciente, con el presupuesto de motivo */
  protected sendToQueue(): void {
    const e = this.estimate();
    if (!e || this.busy()) return;
    this.busy.set(true);
    this.queue
      .add({ petId: e.pet.id, urgent: false, reason: `${e.code} · ${e.title}`.slice(0, 200) })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.modal.set(null);
          this.toast.success(
            `${e.pet.name} quedó en la cola de hoy. Al atenderlo, el veterinario carga el presupuesto.`,
          );
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected print(): void {
    const style = this.document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }';
    this.document.head.appendChild(style);
    window.print();
    style.remove();
  }

  private done(updated: EstimatePrint, message: string): void {
    this.busy.set(false);
    this.modal.set(null);
    this.estimate.set(updated);
    this.toast.success(message);
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.toast.error(apiErrorMessage(error));
  }

  /** Para el texto de ayuda: "29/10/2026" */
  protected calendar(day: string): string {
    return formatDate(day, 'calendar');
  }
}
