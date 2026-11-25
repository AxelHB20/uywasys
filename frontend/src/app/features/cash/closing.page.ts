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
import { SessionService } from '../../core/auth/session.service';
import { SessionSummary } from '../../core/services/cash.models';
import { CashService } from '../../core/services/cash.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { downloadPdf } from '../../shared/utils/pdf';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

/** Margen de la ticketera alrededor del papel */
const PAPER_MARGIN_MM = 3;

/**
 * Reporte de cierre (arqueo) en papel de 80 mm: lo que debía haber, lo que se contó, la
 * diferencia y su motivo, los egresos y lo cobrado por apps. Lleva líneas de firma: es el
 * respaldo entre la cajera y el dueño. Con la caja abierta sale como "corte parcial".
 */
@Component({
  selector: 'app-closing-page',
  imports: [BackLinkComponent, IconComponent, FechaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <div class="no-print flex flex-wrap items-center justify-between gap-3">
        <app-back-link fallback="/caja" fallbackLabel="Caja" />
        @if (summary()) {
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="downloading()"
              (click)="download()"
            >
              @if (downloading()) {
                <app-icon name="loader" class="size-4 animate-spin" />
              } @else {
                <app-icon name="download" class="size-4" />
              }
              Descargar PDF
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
        </div>
      } @else if (summary(); as s) {
        <article
          #paper
          class="print-area relative mx-auto w-full max-w-[80mm] bg-white px-[4mm] pt-6 pb-6 text-[12px] leading-[1.45] text-black shadow-card ring-1 ring-slate-200"
          [attr.aria-label]="'Reporte de cierre de ' + s.register.name"
        >
          <header class="text-center">
            <p class="font-display text-[15px] font-bold">{{ clinicName() }}</p>
            <p class="mt-1 text-[11px] font-semibold tracking-[0.12em] uppercase">
              {{ s.status === 'CLOSED' ? 'Reporte de cierre de caja' : 'Corte parcial de caja' }}
            </p>
            <p class="text-[11px]">{{ s.register.name }}</p>
          </header>

          <dl class="mt-3 space-y-0.5 border-t border-dashed border-black/50 pt-2 text-[11px]">
            <div class="flex justify-between gap-2">
              <dt>Abrió</dt>
              <dd class="text-right">
                {{ s.openedAt | fecha: 'datetime' }} · {{ s.openedBy.fullName }}
              </dd>
            </div>
            @if (s.closedAt) {
              <div class="flex justify-between gap-2">
                <dt>Cerró</dt>
                <dd class="text-right">
                  {{ s.closedAt | fecha: 'datetime' }} · {{ s.closedBy?.fullName }}
                </dd>
              </div>
            } @else {
              <div class="flex justify-between gap-2">
                <dt>Impreso</dt>
                <dd class="text-right">{{ now | fecha: 'datetime' }}</dd>
              </div>
            }
          </dl>

          <h2
            class="mt-3 border-t border-dashed border-black/50 pt-2 text-[11px] font-bold tracking-wide uppercase"
          >
            Efectivo (cajón)
          </h2>
          <dl class="mt-1 space-y-0.5 tabular-nums">
            <div class="flex justify-between">
              <dt>Monto inicial</dt>
              <dd>{{ money(s.openingAmount) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt>+ Cobrado en efectivo</dt>
              <dd>{{ money(cashLine().collected) }}</dd>
            </div>
            @if (s.expenses) {
              <div class="flex justify-between">
                <dt>− Egresos</dt>
                <dd>{{ money(s.expenses) }}</dd>
              </div>
            }
            @if (cashLine().refunded) {
              <div class="flex justify-between">
                <dt>− Devoluciones</dt>
                <dd>{{ money(cashLine().refunded) }}</dd>
              </div>
            }
            <div class="flex justify-between border-t border-black/30 pt-0.5 font-bold">
              <dt>= Debía haber</dt>
              <dd>{{ money(s.expectedCash) }}</dd>
            </div>
            @if (s.countedCash !== null) {
              <div class="flex justify-between">
                <dt>Contado</dt>
                <dd>{{ money(s.countedCash) }}</dd>
              </div>
              <div class="flex justify-between font-bold">
                <dt>Diferencia</dt>
                <dd>
                  @if (!s.difference) {
                    Cuadró
                  } @else {
                    {{ s.difference > 0 ? 'Sobra ' : 'Falta ' }}{{ money(abs(s.difference)) }}
                  }
                </dd>
              </div>
            }
          </dl>
          @if (s.closingNote) {
            <p class="mt-1 text-[11px]">
              <span class="font-semibold">Motivo:</span> {{ s.closingNote }}
            </p>
          }

          @if (digital().length) {
            <h2
              class="mt-3 border-t border-dashed border-black/50 pt-2 text-[11px] font-bold tracking-wide uppercase"
            >
              Por apps y POS (revisar)
            </h2>
            <ul class="mt-1 space-y-0.5 tabular-nums">
              @for (m of digital(); track m.method) {
                <li class="flex justify-between gap-2">
                  <span
                    >{{ m.label }} · {{ m.payments }} {{ m.payments === 1 ? 'pago' : 'pagos'
                    }}{{ m.withoutCode ? ' (' + m.withoutCode + ' sin código)' : '' }}</span
                  >
                  <span>{{ money(m.net) }}</span>
                </li>
              }
            </ul>
          }

          <dl class="mt-3 space-y-0.5 border-t border-dashed border-black/50 pt-2 tabular-nums">
            <div class="flex justify-between">
              <dt>Cobros</dt>
              <dd>{{ s.totals.receipts }}</dd>
            </div>
            @if (s.totals.refunded) {
              <div class="flex justify-between">
                <dt>Devoluciones (todos los medios)</dt>
                <dd>− {{ money(s.totals.refunded) }}</dd>
              </div>
            }
            <div class="flex justify-between text-[13px] font-bold">
              <dt>Total cobrado neto</dt>
              <dd>{{ money(s.totals.net) }}</dd>
            </div>
          </dl>

          @if (expenses().length) {
            <h2
              class="mt-3 border-t border-dashed border-black/50 pt-2 text-[11px] font-bold tracking-wide uppercase"
            >
              Detalle de egresos
            </h2>
            <ul class="mt-1 space-y-0.5 text-[11px] tabular-nums">
              @for (e of expenses(); track e.id) {
                <li class="flex justify-between gap-2">
                  <span class="min-w-0">{{ e.createdAt | fecha: 'time' }} · {{ e.reason }}</span>
                  <span class="shrink-0">{{ money(e.amount) }}</span>
                </li>
              }
            </ul>
          }

          <div class="mt-8 grid grid-cols-2 gap-4 text-center text-[10.5px]">
            <p class="border-t border-black pt-1">
              Entregó<br />{{ s.closedBy?.fullName ?? s.openedBy.fullName }}
            </p>
            <p class="border-t border-black pt-1">Recibió<br />&nbsp;</p>
          </div>
          <p class="mt-4 text-center text-[9px] tracking-wide text-black/60 print:text-black">
            Emitido con Uywa
          </p>
        </article>
      } @else {
        <div
          class="mx-auto h-96 w-full max-w-[22rem] animate-pulse rounded bg-slate-100"
          aria-busy="true"
        ></div>
      }
    </section>
  `,
})
export class ClosingPage {
  readonly id = input.required<string>();

  private readonly cash = inject(CashService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly paper = viewChild<ElementRef<HTMLElement>>('paper');

  protected readonly money = money;
  protected readonly abs = Math.abs;
  protected readonly now = new Date().toISOString();
  protected readonly summary = signal<SessionSummary | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly downloading = signal(false);
  protected readonly clinicName = computed(() => this.session.user()?.clinic.name ?? '');

  private readonly cashMethod = computed(() =>
    this.summary()?.byMethod.find((m) => m.method === 'CASH'),
  );
  protected readonly cashLine = computed(() => ({
    collected: this.cashMethod()?.collected ?? 0,
    refunded: this.cashMethod()?.refunded ?? 0,
  }));
  protected readonly digital = computed(
    () =>
      this.summary()?.byMethod.filter((m) => m.method !== 'CASH' && (m.collected || m.refunded)) ??
      [],
  );
  protected readonly expenses = computed(
    () => this.summary()?.movements.filter((m) => m.kind === 'EXPENSE' && !m.voided) ?? [],
  );

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.cash.session(id).subscribe({
        next: (s) => this.summary.set(s),
        error: (error: unknown) =>
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el cierre.')),
      });
    });
  }

  /** Papel continuo de 80 mm: la hoja mide lo que mide el reporte */
  protected print(): void {
    const paper = this.paper()?.nativeElement;
    const style = this.document.createElement('style');
    if (paper) {
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

  protected async download(): Promise<void> {
    const paper = this.paper()?.nativeElement;
    const s = this.summary();
    if (!paper || !s || this.downloading()) return;
    this.downloading.set(true);
    try {
      const day = (s.closedAt ?? this.now).slice(0, 10);
      await downloadPdf(paper, `cierre-caja-${day}.pdf`);
    } catch {
      this.toast.error('No se pudo generar el PDF. Usa Imprimir y elige "Guardar como PDF".');
    } finally {
      this.downloading.set(false);
    }
  }
}
