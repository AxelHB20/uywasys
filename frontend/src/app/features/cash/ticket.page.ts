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
import {
  CUSTOMER_DOC_LABELS,
  DOC_STATUS_LABELS,
  DOC_STATUS_TONE,
  DOC_TITLES,
} from '../../core/services/billing.models';
import { ReceiptTicket } from '../../core/services/cash.models';
import { CashService } from '../../core/services/cash.service';
import { DOCUMENT_SHORT } from '../../core/services/clients.models';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, money } from '../../shared/utils/stock';
import { scheduleSummary } from '../../shared/utils/opening-hours';
import { apiErrorMessage } from '../../shared/utils/validators';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';

/** Margen de la ticketera alrededor del ticket */
const PAPER_MARGIN_MM = 3;

/** Ticket del cobro (80 mm). Hasta la Fase 4 es una nota de venta interna, no un comprobante. */
@Component({
  selector: 'app-ticket-page',
  imports: [
    FechaPipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    ModalComponent,
    BadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ticket.page.html',
})
export class TicketPage {
  private readonly cash = inject(CashService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  protected readonly isAdmin = inject(SessionService).isAdmin;

  /** :id de la ruta */
  readonly id = input.required<string>();

  protected readonly money = money;
  protected readonly formatQty = formatQty;
  protected readonly docShort = DOCUMENT_SHORT as Record<string, string>;
  protected readonly docTitle = DOC_TITLES;
  protected readonly docStatus = DOC_STATUS_LABELS;
  protected readonly docTone = DOC_STATUS_TONE;
  protected readonly customerDoc = CUSTOMER_DOC_LABELS;
  /** QR de SUNAT (cadena que devuelve el PSE), como imagen */
  protected readonly qr = signal<string | null>(null);
  protected readonly ticket = signal<ReceiptTicket | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** Si la imagen no carga (borrada, sin red), el ticket queda solo con el nombre */
  protected readonly logoFailed = signal(false);
  /** Horario de la clínica en una línea, al pie del ticket */
  protected readonly schedule = computed(() =>
    scheduleSummary(this.ticket()?.clinic.openingHours ?? []),
  );
  protected readonly logoUrl = computed(() =>
    this.logoFailed() ? null : (this.ticket()?.clinic.logoUrl ?? null),
  );
  private readonly logo = viewChild<ElementRef<HTMLImageElement>>('logo');
  private readonly paper = viewChild<ElementRef<HTMLElement>>('paper');
  protected readonly voiding = signal(false);
  protected readonly saving = signal(false);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    effect(() => this.load(Number(this.id())));
    effect(() => {
      const text = this.ticket()?.document?.qrText;
      this.qr.set(null);
      if (!text) return;
      void import('qrcode')
        .then((mod) => {
          // qrcode es CommonJS: al importarlo dinámicamente sus funciones vienen en "default"
          const lib = (mod as unknown as { default?: typeof mod }).default ?? mod;
          return lib.toDataURL(text, { margin: 0, width: 240, errorCorrectionLevel: 'M' });
        })
        .then((url) => this.qr.set(url))
        .catch(() => this.qr.set(null));
    });
  }

  protected load(id: number): void {
    this.loadError.set(null);
    this.cash.ticket(id).subscribe({
      next: (t) => this.ticket.set(t),
      error: (error: unknown) =>
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el ticket.')),
    });
  }

  /** Espera a que el logo termine de cargar para que no salga un hueco en el papel */
  protected print(): void {
    const img = this.logo()?.nativeElement;
    if (img && !img.complete) {
      const go = () => this.printTicket();
      img.addEventListener('load', go, { once: true });
      img.addEventListener('error', go, { once: true });
      return;
    }
    this.printTicket();
  }

  /**
   * La ticketera usa papel continuo: la hoja mide 80 mm de ancho y lo que mida el ticket
   * de largo, así el corte cae justo al final. La regla vive solo mientras se imprime.
   */
  private printTicket(): void {
    const paper = this.paper()?.nativeElement;
    const style = this.document.createElement('style');
    if (paper) {
      // Se mide con el ancho de impresión (74 mm) para que el largo coincida con el papel.
      const previous = paper.style.cssText;
      paper.style.cssText = 'width: 74mm; max-width: none; padding: 0;';
      const lengthMm = Math.ceil((paper.scrollHeight * 25.4) / 96) + PAPER_MARGIN_MM * 2;
      paper.style.cssText = previous;
      style.textContent = `@page { size: 80mm ${lengthMm}mm; margin: ${PAPER_MARGIN_MM}mm; }`;
      this.document.head.appendChild(style);
    }
    window.print();
    style.remove();
  }

  protected askVoid(): void {
    this.reason.reset('');
    this.voiding.set(true);
  }

  protected confirmVoid(): void {
    const t = this.ticket();
    if (!t || this.saving()) return;
    if (this.reason.invalid) {
      this.reason.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.cash.voidReceipt(t.id, this.reason.value.trim()).subscribe({
      next: (updated) => {
        this.ticket.set(updated);
        this.saving.set(false);
        this.voiding.set(false);
        this.toast.success(`Cobro ${updated.code} anulado. Los cargos volvieron a pendientes.`);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected closeModal(): void {
    if (!this.saving()) this.voiding.set(false);
  }
}
