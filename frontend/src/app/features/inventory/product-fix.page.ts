import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  BASE_UNIT_LABELS,
  BaseUnit,
  CATEGORY_LABELS,
  NEW_PRODUCT_UNITS,
  ProductFixItem,
  ProductFixRow,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, unitLabel } from '../../shared/utils/stock';
import { apiErrorDetails, apiErrorMessage } from '../../shared/utils/validators';
import { addSuggestions } from './stock-suggestions';

interface RowState {
  trae: boolean;
  unit: BaseUnit;
  sellable: boolean;
}

/**
 * Corregir productos: los que se crearon con el stock escrito en «Trae» (Unidad = 3 unidades) o
 * marcados como insumo teniendo precio. Se corrigen todos de una vez; lo que estaba en «Trae» pasa
 * a "Cargar stock" como cantidad sugerida.
 */
@Component({
  selector: 'app-product-fix-page',
  imports: [RouterLink, BackLinkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl space-y-5 pb-4">
      <div>
        <app-back-link fallback="/inventario" fallbackLabel="Inventario" />
        <h1 class="font-display text-2xl font-semibold text-slate-900">Corregir productos</h1>
        <p class="mt-1 text-slate-600">
          Productos que se llenaron con un dato en el lugar equivocado. Revisa y guarda todos
          juntos.
        </p>
      </div>

      <div class="rounded-2xl bg-white p-4 text-sm text-slate-700 ring-1 ring-slate-200">
        <p>
          <strong class="font-semibold text-slate-900">«Trae»</strong> es cuántas de la unidad
          vienen en esa presentación: un frasco suelto trae <strong>1</strong>. Si ahí pusieron el
          stock (3), se cambia a 1 y ese 3 pasa a <strong>Cargar stock</strong>.
        </p>
        <p class="mt-1">
          <strong class="font-semibold text-slate-900">Se cuenta por:</strong> un shampoo o una
          loción, Frasco. Solo se puede cambiar si el producto aún no tiene compras ni ventas.
        </p>
      </div>

      @if (loading()) {
        <div class="card h-40 animate-pulse" aria-busy="true"></div>
      } @else if (loadError(); as err) {
        <div class="card px-6 py-8 text-center">
          <p class="text-slate-700">{{ err }}</p>
          <button type="button" class="btn btn-secondary mt-4" (click)="load()">Reintentar</button>
        </div>
      } @else if (!items().length) {
        <div class="card px-6 py-10 text-center">
          <app-icon name="check" class="mx-auto size-8 text-emerald-600" />
          <p class="mt-3 font-medium text-slate-900">No hay productos por corregir</p>
          <a routerLink="/inventario" class="btn btn-secondary mt-5">Volver al inventario</a>
        </div>
      } @else {
        <div class="card overflow-hidden">
          <p class="border-b border-slate-200 px-5 py-3 text-sm text-slate-700" aria-live="polite">
            <strong class="font-semibold tabular-nums">{{ marked().length }}</strong> de
            {{ items().length }} {{ items().length === 1 ? 'producto' : 'productos' }} por corregir
          </p>
          <ul class="divide-y divide-slate-100">
            @for (p of items(); track p.id) {
              @let s = state()[p.id];
              <li class="space-y-3 px-5 py-4" [id]="'fix-' + p.id">
                <div>
                  <p class="font-medium text-slate-900">{{ p.name }}</p>
                  <p class="text-xs text-slate-600">{{ categoryLabels[p.category] }}</p>
                </div>

                @if (p.presentation; as pres) {
                  <label class="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      class="mt-0.5 size-5 shrink-0 rounded accent-anil-600"
                      [checked]="s.trae"
                      (change)="set(p.id, { trae: $any($event.target).checked })"
                    />
                    <span class="text-sm text-slate-800">
                      «{{ pres.name }}» dice que trae
                      <strong class="tabular-nums">{{ qty(pres.factor) }}</strong>
                      {{ unitsOf(p.baseUnit, pres.factor) }}.
                      <span class="font-medium text-slate-900">Poner Trae = 1</span>
                      @if (p.totalStock <= 0 && pres.factor > 1) {
                        <span class="block text-slate-600"
                          >El {{ qty(pres.factor) }} pasa a Cargar stock como cantidad.</span
                        >
                      }
                    </span>
                  </label>
                  @if (s.trae && p.totalStock > 0) {
                    <p
                      class="flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200"
                    >
                      <app-icon name="alert" class="mt-0.5 size-4 shrink-0 text-amber-700" />
                      Ya tiene stock ({{ qty(p.totalStock) }}
                      {{ unitsOf(p.baseUnit, p.totalStock) }}). Después revisa la cantidad con
                      «Conteo físico» en su ficha.
                    </p>
                  }
                }

                @if (p.canChangeUnit) {
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label [for]="'fix-unit-' + p.id" class="text-sm text-slate-700"
                      >Se cuenta por</label
                    >
                    <select
                      [id]="'fix-unit-' + p.id"
                      class="field-input h-11 w-40"
                      (change)="set(p.id, { unit: $any($event.target).value })"
                    >
                      @for (u of unitOptions(p); track u) {
                        <option [value]="u" [selected]="u === s.unit">
                          {{ cap(unitNames[u][0]) }}
                        </option>
                      }
                    </select>
                    @if (s.unit !== p.baseUnit) {
                      <span class="text-sm text-anil-800"
                        >Cambia de {{ cap(unitNames[p.baseUnit][0]) }} a
                        {{ cap(unitNames[s.unit][0]) }}</span
                      >
                    }
                  </div>
                }

                @if (p.supplyWithPrice) {
                  <label class="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      class="mt-0.5 size-5 shrink-0 rounded accent-anil-600"
                      [checked]="s.sellable"
                      (change)="set(p.id, { sellable: $any($event.target).checked })"
                    />
                    <span class="text-sm text-slate-800">
                      Está como insumo pero tiene precio.
                      <span class="font-medium text-slate-900">Se vende al cliente</span>
                      <span class="block text-slate-600"
                        >Si de verdad solo se gasta en la clínica, desmárcalo.</span
                      >
                    </span>
                  </label>
                }

                @if (errors()[p.id]; as err) {
                  <p class="field-error" role="alert">{{ err }}</p>
                }
              </li>
            }
          </ul>
        </div>
        <div
          class="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          <a routerLink="/inventario" class="btn btn-ghost hidden sm:inline-flex">Cancelar</a>
          <button
            type="button"
            class="btn btn-primary"
            [disabled]="saving() || !marked().length"
            (click)="save()"
          >
            @if (saving()) {
              <app-icon name="loader" class="size-4 animate-spin" /> Guardando…
            } @else {
              Corregir {{ marked().length }} y guardar
            }
          </button>
        </div>
      }
    </div>
  `,
})
export class ProductFixPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly unitNames = BASE_UNIT_LABELS;
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly items = signal<ProductFixRow[]>([]);
  protected readonly state = signal<Record<number, RowState>>({});
  protected readonly errors = signal<Record<number, string>>({});

  /** Lo que se va a mandar: solo los productos con algo marcado */
  protected readonly marked = computed(() => {
    const st = this.state();
    return this.items()
      .map((p): ProductFixItem | null => {
        const s = st[p.id];
        const item: ProductFixItem = { productId: p.id };
        if (p.presentation && s.trae) item.presentationId = p.presentation.id;
        if (p.canChangeUnit && s.unit !== p.baseUnit) item.baseUnit = s.unit;
        if (p.supplyWithPrice && s.sellable) item.sellable = true;
        return Object.keys(item).length > 1 ? item : null;
      })
      .filter((i) => i !== null);
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const { items } = await firstValueFrom(this.inventory.productFixes());
      this.items.set(items);
      this.state.set(
        Object.fromEntries(
          items.map((p) => [p.id, { trae: !!p.presentation, unit: p.baseUnit, sellable: true }]),
        ),
      );
    } catch (error) {
      this.loadError.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected set(id: number, patch: Partial<RowState>): void {
    this.state.update((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
    if (this.errors()[id])
      this.errors.update((all) => {
        const { [id]: _, ...rest } = all;
        return rest;
      });
  }

  protected unitOptions(p: ProductFixRow): BaseUnit[] {
    return NEW_PRODUCT_UNITS.includes(p.baseUnit)
      ? NEW_PRODUCT_UNITS
      : [p.baseUnit, ...NEW_PRODUCT_UNITS];
  }

  protected cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  protected qty(n: number): string {
    return formatQty(n);
  }

  protected unitsOf(unit: BaseUnit, n: number): string {
    return unitLabel(unit, n);
  }

  protected async save(): Promise<void> {
    const items = this.marked();
    if (this.saving() || !items.length) return;
    this.saving.set(true);
    try {
      const res = await firstValueFrom(this.inventory.applyFixes(items));
      addSuggestions(res.suggestions);
      const done = `${res.fixed} ${res.fixed === 1 ? 'producto corregido' : 'productos corregidos'}.`;
      if (res.suggestions.length) {
        this.toast.success(`${done} Ya está la cantidad: pon el vencimiento y guarda.`);
        await this.router.navigateByUrl('/inventario/cargar-stock');
      } else {
        this.toast.success(done);
        await this.load();
      }
    } catch (error) {
      const rows = apiErrorDetails<{ rows: { productId: number; message: string }[] }>(error).rows;
      if (rows?.length) {
        this.errors.set(Object.fromEntries(rows.map((r) => [r.productId, r.message])));
        document.getElementById(`fix-${rows[0].productId}`)?.scrollIntoView({ block: 'center' });
      }
      this.toast.error(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
