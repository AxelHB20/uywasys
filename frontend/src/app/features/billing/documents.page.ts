import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  CUSTOMER_DOC_LABELS,
  DOC_STATUS_LABELS,
  DOC_STATUS_TONE,
  DOC_TYPE_LABELS,
  DocumentStatus,
  DocumentSummary,
  DocumentType,
  statusLabel,
} from '../../core/services/billing.models';
import { BillingService } from '../../core/services/billing.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { limaDate } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

type StatusFilter = DocumentStatus | 'PROBLEMS';

/** Boletas, facturas y notas de crédito: su estado ante SUNAT, reintentos y el Excel del contador. */
@Component({
  selector: 'app-documents-page',
  imports: [ReactiveFormsModule, RouterLink, FechaPipe, BadgeComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents.page.html',
})
export class DocumentsPage {
  private readonly billing = inject(BillingService);
  private readonly toast = inject(ToastService);
  protected readonly isAdmin = inject(SessionService).isAdmin;

  /** ?estado=PROBLEMS (desde la campana) */
  readonly estado = input<string>();

  protected readonly money = money;
  protected readonly typeLabels = DOC_TYPE_LABELS;
  protected readonly statusLabels = DOC_STATUS_LABELS;
  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = DOC_STATUS_TONE;
  protected readonly customerDoc = CUSTOMER_DOC_LABELS;
  protected readonly types = Object.entries(DOC_TYPE_LABELS) as [DocumentType, string][];
  protected readonly statuses: [StatusFilter, string][] = [
    ['PROBLEMS', 'Con problemas'],
    ...(Object.entries(DOC_STATUS_LABELS) as [DocumentStatus, string][]),
  ];

  private readonly today = limaDate(new Date());
  protected readonly filters = new FormGroup({
    type: new FormControl<DocumentType | null>(null),
    status: new FormControl<StatusFilter | null>(null),
    from: new FormControl<string | null>(null),
    to: new FormControl<string | null>(null),
  });
  protected readonly page = signal(1);
  private readonly values = toSignal(
    this.filters.valueChanges.pipe(
      map(() => {
        this.page.set(1);
        return this.filters.getRawValue();
      }),
    ),
    { initialValue: this.filters.getRawValue() },
  );

  protected readonly status = rxResource({ stream: () => this.billing.status() });
  protected readonly list = rxResource({
    params: () => ({ ...this.values(), page: this.page() }),
    stream: ({ params }) => this.billing.documents(params),
  });
  protected readonly items = computed(() => this.list.value()?.items ?? []);
  protected readonly pages = computed(() => {
    const v = this.list.value();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });

  protected readonly retrying = signal<number | null>(null);
  protected readonly reportFrom = new FormControl(this.today.slice(0, 8) + '01', {
    nonNullable: true,
  });
  protected readonly reportTo = new FormControl(this.today, { nonNullable: true });
  protected readonly downloading = signal(false);

  constructor() {
    // La campana abre la lista filtrada por "Con problemas"
    effect(() => {
      if (this.estado() === 'PROBLEMS')
        untracked(() => this.filters.controls.status.setValue('PROBLEMS'));
    });
  }

  protected canRetry(d: DocumentSummary): boolean {
    return (
      this.isAdmin() && (d.status === 'ERROR' || d.status === 'SENT' || d.status === 'PENDING')
    );
  }

  /** Qué está pasando con el envío, en una línea */
  protected detail(d: DocumentSummary): string | null {
    if (d.status === 'REJECTED') return d.sunatDescription ?? 'SUNAT lo rechazó';
    if (d.status === 'ERROR')
      return `${d.lastError ?? 'No se pudo enviar'}${d.nextAttemptAt ? '' : ' · reintenta cuando lo corrijas'}`;
    if (d.status === 'SENT')
      return 'El PSE lo recibió; SUNAT confirma en unas horas (boletas por resumen diario)';
    return null;
  }

  protected retry(d: DocumentSummary): void {
    this.retrying.set(d.id);
    this.billing.retry(d.id).subscribe({
      next: () => {
        this.retrying.set(null);
        this.toast.success(`${d.code} se volverá a enviar en unos segundos.`);
        setTimeout(() => this.list.reload(), 3000);
      },
      error: (error: unknown) => {
        this.retrying.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected download(): void {
    const from = this.reportFrom.value;
    const to = this.reportTo.value;
    if (!from || !to || from > to) {
      this.toast.error('Revisa el periodo: la fecha inicial va antes que la final.');
      return;
    }
    this.downloading.set(true);
    this.billing.report(from, to).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ventas-${from}-a-${to}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error: unknown) => {
        this.downloading.set(false);
        this.toast.error(apiErrorMessage(error, 'No se pudo generar el Excel.'));
      },
    });
  }

  protected clear(): void {
    this.filters.reset({ type: null, status: null, from: null, to: null });
  }
}
