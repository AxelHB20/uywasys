import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { PrintDocument } from '../../core/services/billing.models';
import { BillingService } from '../../core/services/billing.service';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { DocumentSheetComponent } from '../../shared/ui/document-sheet/document-sheet.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { downloadPdf } from '../../shared/utils/pdf';
import { apiErrorMessage } from '../../shared/utils/validators';

/**
 * Número para wa.me: celular peruano de 9 dígitos → 51XXXXXXXXX; uno extranjero, escrito con +
 * y su código de país. Un fijo o un número incompleto no sirve para WhatsApp → null.
 */
export function whatsappNumber(phone: string | null): string | null {
  const raw = (phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (/^9\d{8}$/.test(digits)) return `51${digits}`;
  if (/^519\d{8}$/.test(digits)) return digits;
  if (raw.startsWith('+') && !digits.startsWith('51') && /^\d{10,15}$/.test(digits)) return digits;
  return null;
}

/**
 * Hoja A4 de un comprobante: imprimirla o descargarla como archivo PDF (se arma en el navegador;
 * no se guarda nada en el servidor). Para enviarlo, "Abrir chat de WhatsApp" abre el chat del número
 * —aunque no esté en los contactos— y ahí se adjunta el PDF descargado.
 */
@Component({
  selector: 'app-document-print-page',
  imports: [BackLinkComponent, DocumentSheetComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <div class="no-print flex flex-wrap items-center justify-between gap-3">
        <app-back-link fallback="/comprobantes" fallbackLabel="Comprobantes" />
        @if (doc(); as d) {
          <div class="flex flex-wrap items-start gap-2">
            <div class="w-44">
              <label for="wa-phone" class="sr-only">Celular del cliente para WhatsApp</label>
              <input
                id="wa-phone"
                type="tel"
                inputmode="tel"
                autocomplete="off"
                maxlength="15"
                class="field-input"
                placeholder="Celular (9 dígitos)"
                [value]="phone()"
                (input)="phone.set($any($event.target).value); phoneError.set(null)"
                (keydown.enter)="openChat()"
                [attr.aria-invalid]="phoneError() ? true : null"
                aria-describedby="wa-phone-hint"
              />
              <p
                id="wa-phone-hint"
                class="mt-1 text-xs"
                [class.text-rose-700]="phoneError()"
                [class.text-slate-500]="!phoneError()"
              >
                {{ phoneError() ?? 'Aunque no esté guardado' }}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-secondary"
              (click)="openChat()"
            >
              <app-icon name="phone" class="size-4" /> Abrir chat de WhatsApp
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="downloading()"
              (click)="download(d)"
            >
              <app-icon name="download" class="size-4" />
              {{ downloading() ? 'Generando…' : 'Descargar PDF' }}
            </button>
            <button type="button" class="btn btn-primary" (click)="print()">
              <app-icon name="printer" class="size-4" /> Imprimir
            </button>
          </div>
        }
      </div>

      @if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
          <button type="button" class="btn btn-secondary mt-4" (click)="load(id())">
            Reintentar
          </button>
        </div>
      } @else if (doc(); as d) {
        <p class="no-print text-sm text-slate-600">
          Para enviarlo: <strong>Descargar PDF</strong>, abre el chat de WhatsApp y adjunta el
          archivo.
        </p>
        <div class="min-w-0 overflow-x-auto">
          <app-document-sheet [doc]="d" />
        </div>
      } @else {
        <div class="mx-auto h-[297mm] max-w-[210mm] animate-pulse rounded bg-slate-100"></div>
      }
    </section>
  `,
})
export class DocumentPrintPage {
  private readonly billing = inject(BillingService);
  private readonly document = inject(DOCUMENT);
  private readonly toast = inject(ToastService);
  private readonly sheet = viewChild(DocumentSheetComponent, { read: ElementRef });

  readonly id = input.required<string>();

  protected readonly doc = signal<PrintDocument | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** Celular al que se envía: el de la ficha del cliente, editable (puede ser otro número) */
  protected readonly phone = signal('');
  protected readonly phoneError = signal<string | null>(null);
  protected readonly downloading = signal(false);

  constructor() {
    effect(() => this.load(this.id()));
  }

  protected load(id: string): void {
    this.loadError.set(null);
    this.doc.set(null);
    this.billing.print(Number(id)).subscribe({
      next: (d) => {
        this.doc.set(d);
        this.phone.set(d.contactPhone ?? '');
      },
      error: (error: unknown) =>
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el comprobante.')),
    });
  }

  protected print(): void {
    const style = this.document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 10mm; }';
    this.document.head.appendChild(style);
    window.print();
    style.remove();
  }

  /** Archivo PDF de la hoja, con el número del comprobante como nombre (F001-00000015.pdf) */
  protected async download(d: PrintDocument): Promise<void> {
    // La hoja en sí (el componente es un contenedor sin tamaño propio)
    const host = this.sheet()?.nativeElement as HTMLElement | undefined;
    const element = host?.querySelector<HTMLElement>('article') ?? host;
    if (!element || this.downloading()) return;
    this.downloading.set(true);
    try {
      await downloadPdf(element, d.code);
    } catch {
      this.toast.error('No se pudo generar el PDF. Usa Imprimir y elige "Guardar como PDF".');
    } finally {
      this.downloading.set(false);
    }
  }

  /** Abre el chat de WhatsApp del número (sin mensaje): ahí se adjunta el PDF descargado. */
  protected openChat(): void {
    // Con el número, WhatsApp abre el chat aunque no esté en los contactos
    const phone = whatsappNumber(this.phone());
    if (!phone) {
      this.phoneError.set(
        this.phone().trim()
          ? 'Celular de 9 dígitos que empiece con 9 (extranjero: con + y código)'
          : 'Escribe el celular',
      );
      this.document.getElementById('wa-phone')?.focus();
      return;
    }
    window.open(`https://wa.me/${phone}`, '_blank', 'noopener');
  }
}
