import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, merge } from 'rxjs';
import {
  BASE_UNIT_LABELS,
  CATEGORIES,
  CATEGORY_LABELS,
  PendingStockProduct,
  ProductCategory,
  StockLoadItem,
  INVENTORY_HELP,
  lotMissingText,
  lotRequired,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { normalizeText } from '../../shared/catalog/catalog-options';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { MonthInputComponent } from '../../shared/ui/month-input/month-input.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, unitLabel } from '../../shared/utils/stock';
import { apiErrorDetails, apiErrorMessage, maxDecimals } from '../../shared/utils/validators';
import { dropSuggestions, readSuggestions } from './stock-suggestions';
import {
  IgvChoiceComponent,
  costWithoutIgv,
} from '../../shared/ui/igv-choice/igv-choice.component';

type Row = FormGroup<{
  quantity: FormControl<number | null>;
  presentationId: FormControl<number>;
  expiresAt: FormControl<string>;
  lotNumber: FormControl<string>;
  cost: FormControl<number | null>;
  controlled: FormControl<boolean>;
}>;

/**
 * Cargar stock: la clínica creó sus productos sin stock; aquí pone lo que tiene hoy, todos en una
 * tabla. Las filas vacías no se tocan. El servidor revisa todo antes de guardar.
 */
@Component({
  selector: 'app-stock-load-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BackLinkComponent,
    IconComponent,
    MonthInputComponent,
    IgvChoiceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stock-load.page.html',
})
export class StockLoadPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);

  protected readonly help = INVENTORY_HELP;
  protected readonly categories = CATEGORIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly tried = signal(false);
  protected readonly products = signal<PendingStockProduct[]>([]);
  protected readonly total = signal(0);
  /** Errores que devolvió el servidor, por producto */
  protected readonly serverErrors = signal<Record<number, string>>({});
  private readonly rows = new Map<number, Row>();
  /** Productos con la cantidad ya puesta desde "Corregir productos" (lo que estaba en «Trae») */
  protected readonly suggested = signal<Set<number>>(new Set());
  /** Los costos vienen con IGV (precio final) o sin IGV (valor de la factura) */
  protected readonly costWithIgv = signal(true);
  /** Cambia cada vez que se escribe en cualquier fila (para recalcular contadores) */
  protected readonly edits = signal(0);

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly category = new FormControl<ProductCategory | ''>('', { nonNullable: true });
  private readonly searchValue = toSignal(this.search.valueChanges, { initialValue: '' });
  private readonly categoryValue = toSignal(this.category.valueChanges, { initialValue: '' });

  protected readonly visible = computed(() => {
    const q = normalizeText(this.searchValue());
    const cat = this.categoryValue();
    return this.products().filter(
      (p) => (!cat || p.category === cat) && (!q || normalizeText(p.name).includes(q)),
    );
  });

  /** Filas que se van a guardar (con cantidad o con "controlado" cambiado) */
  protected readonly filled = computed(() => {
    this.edits();
    return this.products().filter((p) => this.isFilled(p));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const res = await firstValueFrom(this.inventory.pendingStock());
      for (const p of res.items) if (!this.rows.has(p.id)) this.rows.set(p.id, this.newRow(p));
      // Lo corregido en «Trae» llega con su cantidad: van primero, solo falta el vencimiento
      const ids = new Set(res.items.map((p) => p.id));
      const hints = readSuggestions().filter((s) => ids.has(s.productId));
      const applied = new Set<number>();
      for (const s of hints) {
        const p = res.items.find((x) => x.id === s.productId)!;
        const row = this.rows.get(p.id)!;
        if (row.controls.quantity.value || !p.presentations.some((x) => x.id === s.presentationId))
          continue;
        row.patchValue({ quantity: s.quantity, presentationId: s.presentationId });
        applied.add(p.id);
      }
      this.suggested.set(applied);
      this.products.set([
        ...res.items.filter((p) => applied.has(p.id)),
        ...res.items.filter((p) => !applied.has(p.id)),
      ]);
      this.total.set(res.total);
    } catch (error) {
      this.loadError.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private newRow(p: PendingStockProduct): Row {
    const row: Row = new FormGroup({
      quantity: new FormControl<number | null>(null, [Validators.min(0.001), maxDecimals(3)]),
      presentationId: new FormControl(p.presentations[0]?.id ?? 0, { nonNullable: true }),
      expiresAt: new FormControl('', { nonNullable: true }),
      lotNumber: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(40)],
      }),
      cost: new FormControl<number | null>(null, [Validators.min(0), maxDecimals(4)]),
      controlled: new FormControl(p.controlled, { nonNullable: true }),
    });
    merge(row.valueChanges).subscribe(() => {
      this.edits.update((n) => n + 1);
      if (this.serverErrors()[p.id])
        this.serverErrors.update((all) => {
          const { [p.id]: _, ...rest } = all;
          return rest;
        });
    });
    return row;
  }

  protected row(p: PendingStockProduct): Row {
    return this.rows.get(p.id)!;
  }

  private isFilled(p: PendingStockProduct): boolean {
    const v = this.row(p).getRawValue();
    return !!v.quantity || v.controlled !== p.controlled;
  }

  /** Qué le falta a una fila llena (se muestra después de intentar guardar) */
  protected problem(p: PendingStockProduct): string | null {
    this.edits();
    const server = this.serverErrors()[p.id];
    if (server) return server;
    const row = this.row(p);
    const v = row.getRawValue();
    if (row.controls.quantity.hasError('decimals')) return 'La cantidad admite hasta 3 decimales';
    if (row.controls.cost.hasError('decimals')) return 'El costo admite hasta 4 decimales';
    if (row.controls.expiresAt.hasError('expiryPast')) return 'Ese lote ya está vencido';
    if (row.controls.expiresAt.hasError('expiryFormat'))
      return 'Escribe el vencimiento como 08/2027';
    if (!this.tried() || !v.quantity) return null;
    if (p.tracksExpiry && !v.expiresAt) return 'Escribe el vencimiento';
    if (lotRequired(p.category, v.controlled) && !v.lotNumber.trim())
      return lotMissingText(p.category, v.controlled);
    return null;
  }

  protected needsLot(p: PendingStockProduct): boolean {
    this.edits();
    return lotRequired(p.category, this.row(p).controls.controlled.value);
  }

  protected preview(p: PendingStockProduct): string | null {
    this.edits();
    const v = this.row(p).getRawValue();
    const pres = p.presentations.find((x) => x.id === Number(v.presentationId));
    if (!v.quantity || !pres || pres.factor === 1) return null;
    const units = Math.round(v.quantity * pres.factor * 1000) / 1000;
    return `= ${formatQty(units)} ${unitLabel(p.baseUnit, units)}`;
  }

  protected unitName(p: PendingStockProduct): string {
    return BASE_UNIT_LABELS[p.baseUnit][1];
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.tried.set(true);
    this.edits.update((n) => n + 1);
    const filled = this.filled();
    if (!filled.length) {
      this.toast.info('Escribe la cantidad de al menos un producto');
      return;
    }
    const bad = filled.filter((p) => this.problem(p));
    if (bad.length) {
      this.focusRow(bad[0].id);
      this.toast.error(
        bad.length === 1 ? 'Revisa la fila marcada' : `Revisa las ${bad.length} filas marcadas`,
      );
      return;
    }
    const withStock = filled.filter((p) => !!this.row(p).controls.quantity.value);
    const onlyControlled = filled.filter((p) => !this.row(p).controls.quantity.value);
    const items: StockLoadItem[] = withStock.map((p) => {
      const v = this.row(p).getRawValue();
      return {
        productId: p.id,
        presentationId: Number(v.presentationId),
        quantity: Number(v.quantity),
        lotNumber: v.lotNumber.trim() || null,
        expiresAt: p.tracksExpiry ? v.expiresAt || null : null,
        costPerPresentation: costWithoutIgv(
          v.cost === null ? null : Number(v.cost),
          this.costWithIgv(),
          p.igv,
        ),
        ...(v.controlled !== p.controlled ? { controlled: v.controlled } : {}),
      };
    });
    this.saving.set(true);
    try {
      let loaded = 0;
      if (items.length) loaded = (await firstValueFrom(this.inventory.loadStock(items))).loaded;
      // Solo se corrigió "controlado" (sin cantidad): se actualiza el producto
      for (const p of onlyControlled)
        await firstValueFrom(
          this.inventory.update(p.id, {
            controlled: this.row(p).controls.controlled.value,
          }),
        );
      // Los que ya tienen stock salen de la tabla; el resto queda como estaba
      const loadedIds = new Set(withStock.map((p) => p.id));
      dropSuggestions([...loadedIds]);
      const fixed = new Map(
        onlyControlled.map((p) => [p.id, this.row(p).controls.controlled.value]),
      );
      this.products.update((list) =>
        list
          .filter((p) => !loadedIds.has(p.id))
          .map((p) => (fixed.has(p.id) ? { ...p, controlled: fixed.get(p.id)! } : p)),
      );
      this.total.update((t) => Math.max(0, t - loaded));
      this.tried.set(false);
      this.toast.success(
        loaded
          ? `Stock cargado en ${loaded} ${loaded === 1 ? 'producto' : 'productos'}.`
          : 'Cambios guardados.',
      );
    } catch (error) {
      const rows = apiErrorDetails<{ rows: { productId: number; message: string }[] }>(error).rows;
      if (rows?.length) {
        this.serverErrors.set(Object.fromEntries(rows.map((r) => [r.productId, r.message])));
        this.focusRow(rows[0].productId);
      }
      this.toast.error(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  private focusRow(id: number): void {
    setTimeout(() => {
      const el = document.getElementById(`sl-qty-${id}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  }
}
