import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_LABELS,
  ProductImportPreview,
  ProductImportResult,
  ProductImportRow,
} from '../../../core/services/inventory.models';
import { InventoryService } from '../../../core/services/inventory.service';
import { BadgeComponent, BadgeTone } from '../../../shared/ui/badge/badge.component';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { ToastService } from '../../../shared/ui/toast/toast.service';
import { formatQty, money, unitLabel } from '../../../shared/utils/stock';
import { apiErrorMessage } from '../../../shared/utils/validators';

type Step = 1 | 2 | 3 | 4;
const MAX_BYTES = 2 * 1024 * 1024;
const VISIBLE_ROWS = 300;

const STATUS: Record<ProductImportRow['status'], { label: string; tone: BadgeTone }> = {
  ok: { label: 'Lista', tone: 'success' },
  exists: { label: 'Ya existe', tone: 'neutral' },
  error: { label: 'Con error', tone: 'danger' },
};

/** Carga inicial del inventario desde Excel, en 4 pasos (mismo flujo que la de clientes). */
@Component({
  selector: 'app-import-products-page',
  imports: [RouterLink, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-products.page.html',
})
export class ImportProductsPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);

  protected readonly steps = ['Plantilla', 'Subir archivo', 'Revisar', 'Listo'];
  protected readonly status = STATUS;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly money = money;

  protected readonly step = signal<Step>(1);
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly downloading = signal(false);
  protected readonly checking = signal(false);
  protected readonly importing = signal(false);
  protected readonly preview = signal<ProductImportPreview | null>(null);
  protected readonly result = signal<ProductImportResult | null>(null);
  protected readonly filter = signal<'problems' | 'all'>('problems');

  protected readonly visibleRows = computed(() => {
    const rows = this.preview()?.rows ?? [];
    const list = this.filter() === 'problems' ? rows.filter((r) => r.status !== 'ok') : rows;
    return list.slice(0, VISIBLE_ROWS);
  });

  protected readonly hiddenRows = computed(() => {
    const rows = this.preview()?.rows ?? [];
    const total =
      this.filter() === 'problems' ? rows.filter((r) => r.status !== 'ok').length : rows.length;
    return Math.max(0, total - VISIBLE_ROWS);
  });

  protected units(r: ProductImportRow, presentations: number): string {
    const value = presentations * r.presentation.factor;
    return `${formatQty(value)} ${unitLabel(r.product.baseUnit, value)}`;
  }

  protected downloadTemplate(): void {
    this.downloading.set(true);
    this.inventory.importTemplate().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'plantilla-productos-uywa.xlsx';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.downloading.set(false);
        this.step.set(2);
      },
      error: (error: unknown) => {
        this.downloading.set(false);
        this.toast.error(apiErrorMessage(error, 'No se pudo descargar la plantilla.'));
      },
    });
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setFile(input.files?.[0] ?? null);
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.setFile(event.dataTransfer?.files?.[0] ?? null);
  }

  protected check(): void {
    const file = this.file();
    if (!file || this.checking()) return;
    this.checking.set(true);
    this.inventory.previewImport(file).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.filter.set(preview.summary.errors + preview.summary.exists > 0 ? 'problems' : 'all');
        this.checking.set(false);
        this.step.set(3);
      },
      error: (error: unknown) => {
        this.checking.set(false);
        this.fileError.set(apiErrorMessage(error, 'No se pudo revisar el archivo.'));
      },
    });
  }

  protected runImport(): void {
    const file = this.file();
    if (!file || this.importing()) return;
    this.importing.set(true);
    this.inventory.import(file).subscribe({
      next: (result) => {
        this.result.set(result);
        this.importing.set(false);
        this.step.set(4);
      },
      error: (error: unknown) => {
        this.importing.set(false);
        this.toast.error(apiErrorMessage(error, 'No se pudo importar.'));
      },
    });
  }

  protected restart(): void {
    this.file.set(null);
    this.preview.set(null);
    this.result.set(null);
    this.fileError.set(null);
    this.step.set(2);
  }

  protected sizeLabel(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.ceil(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private setFile(file: File | null): void {
    this.fileError.set(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.fileError.set(
        'Elige un archivo de Excel (.xlsx). Si está en .xls o .csv, ábrelo y guárdalo como .xlsx.',
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      this.fileError.set('El archivo pesa más de 2 MB. Divídelo en varios archivos.');
      return;
    }
    this.file.set(file);
  }
}
