import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import {
  CUSTOMER_DOC_LABELS,
  DOC_SHEET_TITLES,
  PrintDocument,
} from '../../../core/services/billing.models';
import { FechaPipe } from '../../pipes/fecha.pipe';
import { money } from '../../utils/stock';

/** Catálogo 03: la unidad como la entiende el cliente */
const UNITS: Record<string, string> = { NIU: 'Unidad', ZZ: 'Servicio' };

/**
 * Representación impresa A4 de un comprobante electrónico (boleta, factura o nota de crédito),
 * con el formato que se usa en Perú: recuadro con RUC y número, datos del cliente, detalle con
 * valor unitario, totales con IGV, monto en letras, QR y resumen. No guarda nada: se dibuja con
 * los datos del comprobante y el navegador lo imprime o lo guarda en PDF.
 */
@Component({
  selector: 'app-document-sheet',
  imports: [FechaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = doc();
    <article
      class="print-sheet relative mx-auto max-w-[210mm] overflow-hidden bg-white text-[12px] leading-snug text-slate-900 shadow-card ring-1 ring-slate-200"
      [attr.aria-label]="title() + ' ' + d.code"
    >
      <div class="h-1.5 bg-slate-900 print:bg-black" aria-hidden="true"></div>

      @if (watermark(); as w) {
        <p
          class="pointer-events-none absolute inset-0 grid place-items-center select-none"
          aria-hidden="true"
        >
          <span
            class="-rotate-[24deg] rounded-xl border-4 border-rose-600/25 px-6 py-2 font-display text-6xl font-bold tracking-widest text-rose-600/20 uppercase print:border-black/20 print:text-black/15"
            >{{ w }}</span
          >
        </p>
      }

      <div class="p-6 sm:p-10">
        <header class="flex flex-wrap items-start justify-between gap-6">
          <div class="flex min-w-0 flex-1 items-start gap-4">
            @if (d.clinic.logo && !logoFailed()) {
              <img
                [src]="d.clinic.logo"
                alt=""
                class="h-16 w-auto max-w-[40mm] object-contain"
                (error)="logoFailed.set(true)"
              />
            }
            <div class="min-w-0">
              <p class="font-display text-lg font-bold break-words">{{ d.clinic.name }}</p>
              @if (d.clinic.legalName && d.clinic.legalName !== d.clinic.name) {
                <p class="font-semibold text-slate-700 uppercase">{{ d.clinic.legalName }}</p>
              }
              @if (d.clinic.address) {
                <p class="text-slate-600">{{ d.clinic.address }}</p>
              }
              <p class="text-slate-600">
                @if (d.clinic.phone) {
                  <span>Tel. {{ d.clinic.phone }}</span>
                }
                @if (d.clinic.phone && d.clinic.email) {
                  <span> · </span>
                }
                @if (d.clinic.email) {
                  <span>{{ d.clinic.email }}</span>
                }
              </p>
            </div>
          </div>
          <div
            class="w-full overflow-hidden rounded-xl text-center ring-2 ring-slate-900 sm:w-[62mm]"
            data-testid="sheet-box"
          >
            @if (d.clinic.ruc) {
              <p class="px-4 pt-2.5 font-semibold tabular-nums">RUC {{ d.clinic.ruc }}</p>
            }
            <p
              class="mt-1.5 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-white uppercase"
            >
              {{ title() }}
            </p>
            <p class="px-4 py-2.5 font-display text-xl font-bold tracking-wide tabular-nums">
              {{ d.code }}
            </p>
          </div>
        </header>

        @if (notice(); as n) {
          <p
            class="mt-5 rounded-lg px-3 py-2 text-center text-[11px] font-semibold ring-1 print:bg-white print:ring-black"
            [class]="
              n.tone === 'danger'
                ? 'bg-rose-50 text-rose-800 ring-rose-200'
                : 'bg-amber-50 text-amber-900 ring-amber-200'
            "
            role="status"
          >
            {{ n.text }}
          </p>
        }

        <section
          class="mt-6 grid gap-x-8 gap-y-1.5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] print:bg-white"
          aria-label="Datos del comprobante"
        >
          <dl class="space-y-1.5">
            <div>
              <dt class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                {{ d.type === 'BOLETA' ? 'Cliente' : 'Señor(es)' }}
              </dt>
              <dd class="font-semibold break-words">{{ d.customer.name }}</dd>
            </div>
            @if (customerDoc(); as label) {
              <div class="flex gap-1.5">
                <dt class="text-slate-500">{{ label }}:</dt>
                <dd class="font-medium tabular-nums">{{ d.customer.docNumber }}</dd>
              </div>
            }
            @if (d.customer.address) {
              <div class="flex gap-1.5">
                <dt class="shrink-0 text-slate-500">Dirección:</dt>
                <dd class="break-words">{{ d.customer.address }}</dd>
              </div>
            }
          </dl>
          <dl class="space-y-1.5 sm:text-right">
            <div class="flex gap-1.5 sm:justify-end">
              <dt class="text-slate-500">Fecha de emisión:</dt>
              <dd class="font-medium tabular-nums">{{ d.issueDate | fecha: 'calendar' }}</dd>
            </div>
            <div class="flex gap-1.5 sm:justify-end">
              <dt class="text-slate-500">Moneda:</dt>
              <dd class="font-medium">Soles (PEN)</dd>
            </div>
            @if (d.type !== 'CREDIT_NOTE') {
              <div class="flex gap-1.5 sm:justify-end">
                <dt class="text-slate-500">Forma de pago:</dt>
                <dd class="font-medium">Contado</dd>
              </div>
            }
          </dl>
          @if (d.related; as r) {
            <dl
              class="mt-1.5 space-y-1 border-t border-slate-200 pt-2 sm:col-span-2"
              data-testid="sheet-related"
            >
              <div class="flex flex-wrap gap-1.5">
                <dt class="text-slate-500">Documento que modifica:</dt>
                <dd class="font-semibold tabular-nums">
                  {{ relatedTitle() }} {{ r.code }} del {{ r.issueDate | fecha: 'calendar' }}
                </dd>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <dt class="text-slate-500">Motivo:</dt>
                <dd>01 · Anulación de la operación{{ d.reason ? ' — ' + d.reason : '' }}</dd>
              </div>
            </dl>
          }
        </section>

        <table class="mt-6 w-full border-collapse">
          <thead>
            <tr class="border-y-2 border-slate-900 text-left text-[10.5px] tracking-wide uppercase">
              <th scope="col" class="w-14 py-2 pr-2 font-semibold">Cant.</th>
              <th
                scope="col"
                class="hidden w-20 py-2 pr-2 font-semibold sm:table-cell print:table-cell"
              >
                Unidad
              </th>
              <th scope="col" class="py-2 pr-2 font-semibold">Descripción</th>
              <th
                scope="col"
                class="hidden w-24 py-2 pr-2 text-right font-semibold sm:table-cell print:table-cell"
              >
                V. unit.
              </th>
              <th scope="col" class="w-24 py-2 pr-2 text-right font-semibold">P. unit.</th>
              <th scope="col" class="w-24 py-2 text-right font-semibold">Importe</th>
            </tr>
          </thead>
          <tbody>
            @for (l of d.lines; track $index) {
              <tr class="border-b border-slate-200 align-top break-inside-avoid">
                <td class="py-2 pr-2 tabular-nums">{{ qty(l.quantity) }}</td>
                <td class="hidden py-2 pr-2 text-slate-600 sm:table-cell print:table-cell">
                  {{ unit(l.unit) }}
                </td>
                <td class="py-2 pr-2 break-words">
                  {{ l.description }}
                  @if (l.affectation === 'EXEMPT') {
                    <span class="text-[10.5px] text-slate-500"> · Exonerado</span>
                  } @else if (l.affectation === 'UNAFFECTED') {
                    <span class="text-[10.5px] text-slate-500"> · Inafecto</span>
                  }
                </td>
                <td class="hidden py-2 pr-2 text-right tabular-nums sm:table-cell print:table-cell">
                  {{ l.unitValue.toFixed(2) }}
                </td>
                <td class="py-2 pr-2 text-right tabular-nums">{{ l.unitPrice.toFixed(2) }}</td>
                <td class="py-2 text-right font-medium tabular-nums">{{ l.total.toFixed(2) }}</td>
              </tr>
            }
          </tbody>
        </table>

        <div class="mt-5 grid gap-6 break-inside-avoid sm:grid-cols-[minmax(0,1fr)_68mm]">
          <div class="flex items-start gap-4">
            @if (qr(); as src) {
              <img [src]="src" alt="Código QR del comprobante" class="size-[28mm] shrink-0" />
            }
            <div class="min-w-0 space-y-1.5">
              <p class="font-semibold">{{ d.amountInWords }}</p>
              @if (d.hash) {
                <p class="text-[10.5px] break-all text-slate-600">Resumen: {{ d.hash }}</p>
              }
              <p class="text-[10.5px] text-slate-600">
                Representación impresa de la {{ title().toLowerCase() }}. Consulte su validez en
                www.sunat.gob.pe
              </p>
            </div>
          </div>
          <dl class="space-y-1 tabular-nums" data-testid="sheet-totals">
            @if (d.totals.taxed) {
              <div class="flex justify-between gap-3">
                <dt class="text-slate-600">Op. gravada</dt>
                <dd>S/ {{ d.totals.taxed.toFixed(2) }}</dd>
              </div>
            }
            @if (d.totals.exempt) {
              <div class="flex justify-between gap-3">
                <dt class="text-slate-600">Op. exonerada</dt>
                <dd>S/ {{ d.totals.exempt.toFixed(2) }}</dd>
              </div>
            }
            @if (d.totals.unaffected) {
              <div class="flex justify-between gap-3">
                <dt class="text-slate-600">Op. inafecta</dt>
                <dd>S/ {{ d.totals.unaffected.toFixed(2) }}</dd>
              </div>
            }
            <div class="flex justify-between gap-3">
              <dt class="text-slate-600">IGV 18 %</dt>
              <dd>S/ {{ d.totals.igv.toFixed(2) }}</dd>
            </div>
            <div
              class="mt-1.5 flex items-baseline justify-between gap-3 border-t-2 border-slate-900 pt-2"
            >
              <dt class="font-semibold">Importe total</dt>
              <dd class="font-display text-lg font-bold">{{ total() }}</dd>
            </div>
          </dl>
        </div>

        <footer
          class="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-slate-300 pt-3 text-[10px] text-slate-500 print:border-black"
        >
          <span>
            Emitido el {{ d.issuedAt | fecha: 'datetime' }}
            @if (d.receiptCode) {
              · Cobro interno {{ d.receiptCode }}
            }
          </span>
          <span>Emitido con Uywa</span>
        </footer>
      </div>
    </article>
  `,
})
export class DocumentSheetComponent {
  readonly doc = input.required<PrintDocument>();

  protected readonly logoFailed = signal(false);
  protected readonly qr = signal<string | null>(null);

  protected readonly title = computed(() => DOC_SHEET_TITLES[this.doc().type]);
  protected readonly relatedTitle = computed(() => {
    const r = this.doc().related;
    return r ? DOC_SHEET_TITLES[r.type] : '';
  });
  protected readonly customerDoc = computed(
    () => CUSTOMER_DOC_LABELS[this.doc().customer.docType] ?? null,
  );
  protected readonly total = computed(() => money(this.doc().totals.total));

  /** Sello sobre la hoja cuando el comprobante no vale */
  protected readonly watermark = computed(() => {
    const d = this.doc();
    if (d.simulated) return 'Simulación';
    if (d.status === 'REJECTED') return 'Rechazado';
    if (d.annulledBy && d.annulledBy.status !== 'REJECTED') return 'Anulado';
    return null;
  });

  /** Aviso bajo la cabecera: por qué no vale o qué falta */
  protected readonly notice = computed<{ text: string; tone: 'warning' | 'danger' } | null>(() => {
    const d = this.doc();
    if (d.simulated)
      return { text: 'Simulación: sin valor tributario, no se envió a SUNAT', tone: 'warning' };
    if (d.status === 'REJECTED')
      return { text: 'Rechazado por SUNAT: este comprobante no tiene validez', tone: 'danger' };
    if (d.annulledBy)
      return {
        text: `Anulado con la nota de crédito ${d.annulledBy.code}`,
        tone: 'danger',
      };
    if (d.status !== 'ACCEPTED')
      return { text: 'Pendiente de confirmación de SUNAT', tone: 'warning' };
    return null;
  });

  constructor() {
    effect(() => {
      const text = this.doc().qrText;
      this.qr.set(null);
      if (!text) return;
      void import('qrcode')
        .then((mod) => {
          // qrcode es CommonJS: al importarlo dinámicamente sus funciones vienen en "default"
          const lib = (mod as unknown as { default?: typeof mod }).default ?? mod;
          return lib.toDataURL(text, { margin: 0, width: 280, errorCorrectionLevel: 'M' });
        })
        .then((url) => this.qr.set(url))
        .catch(() => this.qr.set(null));
    });
  }

  protected unit(code: string): string {
    return UNITS[code] ?? code;
  }

  protected qty(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '');
  }
}
