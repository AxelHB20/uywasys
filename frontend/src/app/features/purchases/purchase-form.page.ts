import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, finalize, firstValueFrom, of } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  BASE_UNIT_LABELS,
  BaseUnit,
  IgvAffectation,
  Presentation,
  ProductSummary,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  LastCost,
  PurchaseDocType,
  PurchaseInput,
  Supplier,
} from '../../core/services/purchases.models';
import { PurchasesService } from '../../core/services/purchases.service';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { shrinkImage } from '../../shared/utils/image';
import { loaded } from '../../shared/utils/resource';
import { formatQty, money, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { ProductSearchComponent } from './product-search.component';
import { SupplierFormComponent } from './supplier-form.component';

const IGV = 0.18;
/** Redondeo a céntimos igual que el servidor (base + IGV = total, exacto) */
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
/** Más de esto entre el total del papel y el calculado ya no es redondeo */
const PAPER_TOLERANCE = 0.1;
const AUTOSAVE_MS = 800;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Lo que la línea necesita saber del producto (también se guarda en el borrador) */
export interface LineProduct {
  id: number;
  name: string;
  baseUnit: BaseUnit;
  tracksExpiry: boolean;
  controlled: boolean;
  igv: IgvAffectation;
  presentations: Presentation[];
}

interface Draft {
  savedAt: string;
  header: ReturnType<PurchaseFormPage['header']['getRawValue']>;
  lines: ReturnType<PurchaseFormPage['newLine']>['value'][];
}

export interface LineAmounts {
  taxable: number;
  igv: number;
  total: number;
}

/** Los mismos montos que calcula el servidor para una línea de la ficha */
export function lineAmounts(
  quantity: number,
  unitPrice: number,
  pricesIncludeIgv: boolean,
  igv: IgvAffectation,
): LineAmounts {
  const amount = round2(quantity * unitPrice);
  const taxed = igv === 'TAXED';
  if (pricesIncludeIgv) {
    const taxable = taxed ? round2(amount / (1 + IGV)) : amount;
    return { taxable, igv: round2(amount - taxable), total: amount };
  }
  const tax = taxed ? round2(amount * IGV) : 0;
  return { taxable: amount, igv: tax, total: round2(amount + tax) };
}

function toLineProduct(p: ProductSummary): LineProduct {
  return {
    id: p.id,
    name: p.name,
    baseUnit: p.baseUnit,
    tracksExpiry: p.tracksExpiry,
    controlled: p.controlled,
    igv: p.igv ?? 'TAXED',
    presentations: p.presentations.filter((x) => x.active),
  };
}

/**
 * Recibir compra: la ficha del proveedor se pasa tal como viene (cantidad, unidad, descripción,
 * lote, vencimiento, precio). Al guardar entra todo el stock junto, cada línea con su lote.
 * Se guarda sola como borrador para no perder una ficha larga.
 */
@Component({
  selector: 'app-purchase-form-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BackLinkComponent,
    IconComponent,
    ProductSearchComponent,
    SupplierFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './purchase-form.page.html',
})
export class PurchaseFormPage {
  private readonly api = inject(PurchasesService);
  private readonly inventory = inject(InventoryService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);
  private readonly search = viewChild.required(ProductSearchComponent);

  protected readonly docTypes = DOC_TYPES;
  protected readonly docLabels = DOC_TYPE_LABELS;
  protected readonly money = money;
  protected readonly qty = formatQty;
  protected readonly today = limaToday();
  private readonly draftKey = `uywa:compra-borrador:${this.session.user()?.id ?? 0}`;

  protected readonly header = new FormGroup({
    supplierId: new FormControl<number | null>(null, Validators.required),
    docType: new FormControl<PurchaseDocType>('FACTURA', { nonNullable: true }),
    docNumber: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(30)],
    }),
    issuedAt: new FormControl(this.today, { nonNullable: true, validators: Validators.required }),
    pricesIncludeIgv: new FormControl(false, { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true, validators: Validators.maxLength(300) }),
    /** El total que dice el papel: solo para comparar, no se guarda */
    paperTotal: new FormControl<number | null>(null),
  });
  protected readonly lines = new FormArray<ReturnType<PurchaseFormPage['newLine']>>([]);
  private readonly headerValue = toSignal(this.header.valueChanges, {
    initialValue: this.header.getRawValue(),
  });
  private readonly linesValue = toSignal(this.lines.valueChanges, { initialValue: [] });
  /** Precios con/sin IGV elegidos a mano: ya no se cambian solos con el tipo de comprobante */
  private igvChosen = false;

  // ── Proveedores ──
  protected readonly suppliersRes = rxResource({ stream: () => this.api.suppliers() });
  protected readonly suppliers = computed(() => loaded(this.suppliersRes)() ?? []);
  protected readonly addingSupplier = signal(false);

  // ── Insumos usados sin stock (se descuentan de esta compra) ──
  private readonly shortagesRes = rxResource({
    stream: () => this.inventory.shortages().pipe(catchError(() => of([]))),
  });
  protected readonly settle = signal(true);
  protected readonly pendingShortages = computed(() => {
    const ids = new Set(this.linesValue().map((l) => l.product?.id));
    return (loaded(this.shortagesRes)() ?? []).filter((s) => ids.has(s.product.id));
  });

  protected shortageText(s: {
    quantity: number;
    product: { name: string; baseUnit: BaseUnit };
  }): string {
    return `${formatQty(s.quantity)} ${unitLabel(s.product.baseUnit, s.quantity)} de ${s.product.name}`;
  }

  // ── Último costo de cada producto (para comparar) ──
  private readonly lastCosts = signal<Record<number, LastCost | null>>({});

  // ── Estado ──
  protected readonly tried = signal(false);
  protected readonly saving = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly restoredAt = signal<string | null>(null);
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly editingPrice = signal<number | null>(null);
  protected readonly newPrice = new FormControl<number | null>(null, [Validators.min(0)]);
  protected readonly savingPrice = signal(false);

  protected readonly totals = computed(() => {
    const include = this.headerValue().pricesIncludeIgv ?? false;
    let taxable = 0;
    let igv = 0;
    for (const l of this.linesValue()) {
      if (!l.product || !l.quantity || l.unitPrice === null || l.unitPrice === undefined) continue;
      const a = lineAmounts(Number(l.quantity), Number(l.unitPrice), include, l.product.igv);
      taxable += a.taxable;
      igv += a.igv;
    }
    taxable = round2(taxable);
    igv = round2(igv);
    return { taxable, igv, total: round2(taxable + igv) };
  });

  /** ¿Cuadra con el total que dice el papel? */
  protected readonly paperCheck = computed(() => {
    const paper = this.headerValue().paperTotal;
    if (paper === null || paper === undefined || (paper as unknown) === '') return null;
    const diff = round2(Number(paper) - this.totals().total);
    if (Math.abs(diff) < 0.005) return { tone: 'ok' as const, text: 'Cuadra con la ficha' };
    if (Math.abs(diff) <= PAPER_TOLERANCE)
      return { tone: 'ok' as const, text: `Difiere ${money(Math.abs(diff))} por redondeo` };
    return {
      tone: 'warn' as const,
      text: `No cuadra: la ficha dice ${money(Number(paper))} y suma ${money(this.totals().total)} (${diff > 0 ? 'faltan' : 'sobran'} ${money(Math.abs(diff))}). Revisa cantidades y precios.`,
    };
  });

  protected readonly lineErrors = computed(() =>
    this.linesValue().map((l) => {
      const p = l.product;
      const needsLot = !!p && (p.tracksExpiry || p.controlled);
      return {
        quantity: !l.quantity || Number(l.quantity) <= 0,
        price: l.unitPrice === null || l.unitPrice === undefined || Number(l.unitPrice) < 0,
        lot: needsLot && !l.lotNumber?.trim(),
        expiry: !!p?.tracksExpiry && !l.expiresAt,
        expired: !!p?.tracksExpiry && !!l.expiresAt && l.expiresAt < this.today,
      };
    }),
  );

  protected readonly canSave = computed(() => this.linesValue().length > 0 && !this.saving());

  constructor() {
    this.restoreDraft();
    const destroyRef = inject(DestroyRef);

    // Boleta y nota de venta suelen traer precios con IGV; la factura, el valor unitario sin IGV
    this.header.controls.docType.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => {
      if (!this.igvChosen)
        this.header.controls.pricesIncludeIgv.setValue(type !== 'FACTURA' && type !== 'GUIA');
    });

    // Borrador automático (por usuario y en este navegador)
    this.header.valueChanges
      .pipe(debounceTime(AUTOSAVE_MS), takeUntilDestroyed())
      .subscribe(() => this.saveDraft());
    this.lines.valueChanges
      .pipe(debounceTime(AUTOSAVE_MS), takeUntilDestroyed())
      .subscribe(() => this.saveDraft());
    destroyRef.onDestroy(() => {
      if (!this.saving()) this.saveDraft();
    });

    // Si solo hay un proveedor, ya queda elegido
    effect(() => {
      const list = this.suppliers();
      if (list.length === 1 && this.header.controls.supplierId.value === null)
        this.header.controls.supplierId.setValue(list[0].id);
    });
  }

  newLine(product: LineProduct) {
    const largest = [...product.presentations].sort((a, b) => b.factor - a.factor)[0];
    return new FormGroup({
      product: new FormControl<LineProduct>(product, { nonNullable: true }),
      presentationId: new FormControl<number>(largest?.id ?? 0, { nonNullable: true }),
      quantity: new FormControl<number | null>(null),
      lotNumber: new FormControl('', { nonNullable: true }),
      expiresAt: new FormControl('', { nonNullable: true }),
      unitPrice: new FormControl<number | null>(null),
    });
  }

  // ── Líneas ──

  protected addProduct(p: ProductSummary): void {
    if (!p.presentations.some((x) => x.active)) {
      this.toast.error(`${p.name} no tiene presentaciones activas: agrégalas en su ficha`);
      return;
    }
    this.lines.push(this.newLine(toLineProduct(p)));
    this.loadLastCost(p.id);
    const index = this.lines.length - 1;
    setTimeout(() => document.getElementById(`pl-qty-${index}`)?.focus());
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    if (this.editingPrice() === index) this.editingPrice.set(null);
  }

  protected presentationOf(index: number): Presentation | undefined {
    const l = this.lines.at(index).getRawValue();
    return l.product.presentations.find((p) => p.id === Number(l.presentationId));
  }

  protected lineTotal(index: number): number | null {
    const l = this.linesValue()[index];
    if (!l?.product || !l.quantity || l.unitPrice === null || l.unitPrice === undefined)
      return null;
    return lineAmounts(
      Number(l.quantity),
      Number(l.unitPrice),
      this.headerValue().pricesIncludeIgv ?? false,
      l.product.igv,
    ).total;
  }

  /** "500 tabletas" que entran al stock */
  protected unitsText(index: number): string {
    const l = this.linesValue()[index];
    const pres = this.presentationOf(index);
    if (!l?.product || !pres || !l.quantity) return '';
    const units = Math.round(Number(l.quantity) * pres.factor * 1000) / 1000;
    if (pres.factor === 1) return '';
    const [one, many] = BASE_UNIT_LABELS[l.product.baseUnit];
    return `Entran ${formatQty(units)} ${units === 1 ? one : many}`;
  }

  /** Costo sin IGV de una presentación, según cómo vienen los precios en la ficha */
  private netCost(index: number): number | null {
    const l = this.linesValue()[index];
    if (
      !l?.product ||
      l.unitPrice === null ||
      l.unitPrice === undefined ||
      (l.unitPrice as unknown) === ''
    )
      return null;
    const price = Number(l.unitPrice);
    return this.headerValue().pricesIncludeIgv && l.product.igv === 'TAXED'
      ? price / (1 + IGV)
      : price;
  }

  /** "Vendes a S/ 12.00 · margen 38 %" con su tono */
  protected margin(
    index: number,
  ): { text: string; tone: 'ok' | 'low' | 'loss' | 'none'; price: number | null } | null {
    const l = this.linesValue()[index];
    const pres = this.presentationOf(index);
    if (!l?.product || !pres) return null;
    if (pres.price === null) return { text: 'Sin precio de venta', tone: 'none', price: null };
    const cost = this.netCost(index);
    const sale = l.product.igv === 'TAXED' ? pres.price / (1 + IGV) : pres.price;
    if (cost === null || cost === 0 || sale <= 0)
      return { text: `Vendes a ${money(pres.price)}`, tone: 'none', price: pres.price };
    const percent = Math.round(((sale - cost) / sale) * 1000) / 10;
    if (percent < 0)
      return {
        text: `Vendes a ${money(pres.price)}: por debajo del costo`,
        tone: 'loss',
        price: pres.price,
      };
    return {
      text: `Vendes a ${money(pres.price)} · margen ${percent.toLocaleString('es-PE')} %`,
      tone: percent < 15 ? 'low' : 'ok',
      price: pres.price,
    };
  }

  /** Último costo en la misma presentación y forma (con o sin IGV) que se está escribiendo */
  protected lastCostOf(index: number): { text: string; change: string | null; up: boolean } | null {
    const l = this.linesValue()[index];
    const pres = this.presentationOf(index);
    const last = l?.product ? this.lastCosts()[l.product.id] : null;
    if (!l?.product || !pres || !last) return null;
    const withIgv = this.headerValue().pricesIncludeIgv && l.product.igv === 'TAXED';
    const previous = round2(last.unitCost * pres.factor * (withIgv ? 1 + IGV : 1));
    const text = `Última compra: ${money(previous)}`;
    const price = l.unitPrice === null || l.unitPrice === undefined ? null : Number(l.unitPrice);
    if (!price || !previous) return { text, change: null, up: false };
    const change = Math.round(((price - previous) / previous) * 100);
    if (Math.abs(change) < 10) return { text, change: null, up: false };
    return {
      text,
      change: `${change > 0 ? 'sube' : 'baja'} ${Math.abs(change)} %`,
      up: change > 0,
    };
  }

  protected lastCostPlaceholder(index: number): string {
    const last = this.lastCostOf(index);
    return last ? last.text.replace('Última compra: S/ ', '') : '0.00';
  }

  private loadLastCost(productId: number): void {
    if (productId in this.lastCosts()) return;
    this.api
      .lastCost(productId)
      .pipe(catchError(() => of(null)))
      .subscribe((cost) => this.lastCosts.update((all) => ({ ...all, [productId]: cost })));
  }

  // ── Cambiar el precio de venta desde la línea ──

  protected editPrice(index: number): void {
    this.newPrice.setValue(this.presentationOf(index)?.price ?? null);
    this.editingPrice.set(index);
    setTimeout(() => document.getElementById(`pl-sale-${index}`)?.focus());
  }

  protected savePrice(index: number): void {
    const pres = this.presentationOf(index);
    const value = this.newPrice.value;
    if (!pres || value === null || value < 0 || this.savingPrice()) return;
    this.savingPrice.set(true);
    this.inventory
      .updatePresentation(pres.id, { price: Number(value) })
      .pipe(finalize(() => this.savingPrice.set(false)))
      .subscribe({
        next: (updated) => {
          // Todas las líneas del mismo producto ven el precio nuevo
          for (const group of this.lines.controls) {
            const product = group.controls.product.value;
            if (!product.presentations.some((p) => p.id === updated.id)) continue;
            group.controls.product.setValue({
              ...product,
              presentations: product.presentations.map((p) =>
                p.id === updated.id ? { ...p, price: updated.price } : p,
              ),
            });
          }
          this.editingPrice.set(null);
          this.toast.success(`Precio de venta actualizado: ${money(updated.price)}`);
        },
        error: (error) => this.toast.error(apiErrorMessage(error, 'No se pudo cambiar el precio')),
      });
  }

  // ── Teclado: Enter pasa al campo siguiente (no guarda la compra por accidente) ──

  protected nextField(event: Event): void {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.type === 'search' || target.closest('app-product-search')) return;
    event.preventDefault();
    const fields = [...document.querySelectorAll<HTMLElement>('[data-entry]')].filter(
      (el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null,
    );
    const at = fields.indexOf(target);
    if (at < 0) return;
    const next = fields[at + 1];
    if (next) next.focus();
    else this.search().focus();
  }

  protected chooseIgv(include: boolean): void {
    this.igvChosen = true;
    this.header.controls.pricesIncludeIgv.setValue(include);
  }

  // ── Proveedor nuevo ──

  protected supplierCreated(s: Supplier): void {
    this.addingSupplier.set(false);
    this.suppliersRes.reload();
    this.header.controls.supplierId.setValue(s.id);
    this.toast.success(`Proveedor ${s.name} agregado`);
  }

  // ── Foto de la ficha ──

  protected pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.fileError.set(null);
    if (!file) return;
    if (!/^image\/|^application\/pdf$/.test(file.type)) {
      this.fileError.set('Sube una foto o un PDF');
      return;
    }
    if (file.type === 'application/pdf' && file.size > MAX_FILE_BYTES) {
      this.fileError.set('El PDF pesa más de 5 MB');
      return;
    }
    this.file.set(file);
  }

  // ── Guardar ──

  protected async save(): Promise<void> {
    this.tried.set(true);
    this.serverError.set(null);
    this.header.markAllAsTouched();
    const lineBad = this.lineErrors().findIndex((e) => Object.values(e).some(Boolean));
    if (this.header.invalid || !this.lines.length || lineBad >= 0) {
      if (!this.lines.length) this.toast.error('Agrega al menos un producto de la ficha');
      setTimeout(() =>
        document.querySelector<HTMLElement>('#purchase-form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const h = this.header.getRawValue();
    const input: PurchaseInput = {
      supplierId: Number(h.supplierId),
      docType: h.docType,
      docNumber: h.docNumber.trim(),
      issuedAt: h.issuedAt,
      notes: h.notes.trim() || null,
      pricesIncludeIgv: h.pricesIncludeIgv,
      settleShortages: this.pendingShortages().length > 0 && this.settle(),
      lines: this.lines.getRawValue().map((l) => ({
        productId: l.product.id,
        presentationId: Number(l.presentationId),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        lotNumber: l.product.tracksExpiry || l.product.controlled ? l.lotNumber.trim() : null,
        expiresAt: l.product.tracksExpiry ? l.expiresAt : null,
      })),
    };

    this.saving.set(true);
    try {
      const purchase = await firstValueFrom(this.api.create(input));
      this.clearDraft();
      const file = this.file();
      if (file) {
        try {
          const shrunk = await shrinkImage(file);
          await firstValueFrom(this.api.uploadFile(purchase.id, shrunk.blob, shrunk.name));
        } catch (error) {
          this.toast.error(
            apiErrorMessage(
              error,
              'La compra se guardó, pero no se pudo subir la foto de la ficha',
            ),
          );
        }
      }
      const settled = purchase.settledShortages ?? 0;
      this.toast.success(
        `Compra ${purchase.code} registrada: ${purchase.lines} ${purchase.lines === 1 ? 'producto' : 'productos'}` +
          (settled
            ? ` y ${settled === 1 ? '1 insumo usado sin stock descontado' : `${settled} insumos usados sin stock descontados`}`
            : ''),
      );
      // replaceUrl: «Volver» desde la compra lleva a Compras, no a la ficha ya guardada
      await this.router.navigate(['/inventario/compras', purchase.id], { replaceUrl: true });
    } catch (error) {
      const message = apiErrorMessage(error, 'No se pudo registrar la compra');
      this.serverError.set(message);
      this.toast.error(message);
      this.saving.set(false);
    }
  }

  protected discardDraft(): void {
    this.clearDraft();
    this.lines.clear();
    this.header.reset({
      supplierId: null,
      docType: 'FACTURA',
      docNumber: '',
      issuedAt: this.today,
      pricesIncludeIgv: false,
      notes: '',
      paperTotal: null,
    });
    this.igvChosen = false;
    this.restoredAt.set(null);
    this.tried.set(false);
  }

  protected bad(name: 'supplierId' | 'docNumber' | 'issuedAt'): boolean {
    const c = this.header.controls[name];
    return c.invalid && (c.touched || this.tried());
  }

  protected issuedFuture(): boolean {
    return this.header.controls.issuedAt.value > this.today;
  }

  // ── Borrador ──

  private saveDraft(): void {
    try {
      if (!this.lines.length && !this.header.controls.docNumber.value.trim()) {
        localStorage.removeItem(this.draftKey);
        return;
      }
      const draft: Draft = {
        savedAt: new Date().toISOString(),
        header: this.header.getRawValue(),
        lines: this.lines.getRawValue(),
      };
      localStorage.setItem(this.draftKey, JSON.stringify(draft));
    } catch {
      // Sin almacenamiento (modo privado): se sigue sin borrador
    }
  }

  private restoreDraft(): void {
    let draft: Draft | null = null;
    try {
      const raw = localStorage.getItem(this.draftKey);
      draft = raw ? (JSON.parse(raw) as Draft) : null;
    } catch {
      draft = null;
    }
    if (!draft?.header) return;
    this.header.setValue({ ...this.header.getRawValue(), ...draft.header }, { emitEvent: false });
    this.igvChosen = true;
    for (const l of draft.lines ?? []) {
      if (!l.product) continue;
      const group = this.newLine(l.product);
      group.setValue({ ...group.getRawValue(), ...l });
      this.lines.push(group, { emitEvent: false });
      this.loadLastCost(l.product.id);
    }
    this.lines.updateValueAndValidity();
    this.header.updateValueAndValidity();
    this.restoredAt.set(formatDate(draft.savedAt, 'datetime'));
  }

  private clearDraft(): void {
    try {
      localStorage.removeItem(this.draftKey);
    } catch {
      // nada que limpiar
    }
  }
}
