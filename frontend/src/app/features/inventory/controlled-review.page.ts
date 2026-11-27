import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CATEGORY_LABELS,
  CONTROLLED_LABEL,
  INVENTORY_HELP,
  ProductSummary,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';
import { CONTROLLED_REVIEWED_KEY } from './controlled-reviewed';

/**
 * Revisar psicotrópicos: la casilla se llamaba "Controlado" y la clínica la marcó en casi todos los
 * medicamentos. Aquí se ven todos juntos y se quitan los que no son, de una vez.
 */
@Component({
  selector: 'app-controlled-review-page',
  imports: [RouterLink, BackLinkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl space-y-5 pb-4">
      <div>
        <app-back-link fallback="/inventario" fallbackLabel="Inventario" />
        <h1 class="font-display text-2xl font-semibold text-slate-900">Revisar psicotrópicos</h1>
        <p class="mt-1 text-slate-600">
          Antes esta casilla decía «Controlado» y se marcó por error en muchos medicamentos. Deja
          marcados solo los que de verdad son estupefacientes o psicotrópicos.
        </p>
      </div>

      <div class="rounded-2xl bg-white p-4 text-sm text-slate-700 ring-1 ring-slate-200">
        <p>
          <strong class="font-semibold text-slate-900">Sí son:</strong> ketamina, tramadol,
          diazepam, fenobarbital, butorfanol, midazolam y similares.
        </p>
        <p class="mt-1">
          <strong class="font-semibold text-slate-900">No son:</strong> antibióticos, vitaminas,
          suplementos, antiparasitarios, cremas, laxantes.
        </p>
        <p class="mt-1 text-slate-600">
          Los que quedan marcados piden lote al comprar, y receta, paciente y veterinario colegiado
          en cada uso.
        </p>
      </div>

      @if (loading()) {
        <div class="card h-40 animate-pulse" aria-busy="true"></div>
      } @else if (!items().length) {
        <div class="card px-6 py-10 text-center">
          <app-icon name="check" class="mx-auto size-8 text-emerald-600" />
          <p class="mt-3 font-medium text-slate-900">
            No hay productos marcados como psicotrópicos
          </p>
          <a routerLink="/inventario" class="btn btn-secondary mt-5">Volver al inventario</a>
        </div>
      } @else {
        <div class="card overflow-hidden">
          <div
            class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3"
          >
            <p class="text-sm text-slate-700" aria-live="polite">
              <strong class="font-semibold tabular-nums">{{ keep().length }}</strong> de
              {{ items().length }} quedan como psicotrópicos
            </p>
            <button type="button" class="btn btn-ghost h-9 px-3 text-sm" (click)="uncheckAll()">
              Ninguno lo es
            </button>
          </div>
          <ul class="divide-y divide-slate-100">
            @for (p of items(); track p.id) {
              <li>
                <label
                  class="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-3 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    class="size-5 shrink-0 rounded accent-rose-600"
                    [checked]="isKept(p.id)"
                    (change)="toggle(p.id, $any($event.target).checked)"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium text-slate-900">{{ p.name }}</span>
                    <span class="block text-xs text-slate-600">{{
                      categoryLabels[p.category]
                    }}</span>
                  </span>
                  <span
                    class="shrink-0 text-sm font-medium"
                    [class]="isKept(p.id) ? 'text-rose-700' : 'text-slate-600'"
                    >{{ isKept(p.id) ? 'Sí es psicotrópico' : 'No lo es' }}</span
                  >
                </label>
              </li>
            }
          </ul>
        </div>
        <div
          class="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          <a routerLink="/inventario" class="btn btn-ghost hidden sm:inline-flex">Cancelar</a>
          <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save()">
            @if (saving()) {
              <app-icon name="loader" class="size-4 animate-spin" /> Guardando…
            } @else if (removed().length) {
              Quitar {{ removed().length }} y guardar
            } @else {
              Están bien así
            }
          </button>
        </div>
      }
    </div>
  `,
})
export class ControlledReviewPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly help = INVENTORY_HELP;
  protected readonly label = CONTROLLED_LABEL;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly items = signal<ProductSummary[]>([]);
  private readonly kept = signal<Set<number>>(new Set());
  protected readonly keep = computed(() => this.items().filter((p) => this.kept().has(p.id)));
  protected readonly removed = computed(() => this.items().filter((p) => !this.kept().has(p.id)));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const all: ProductSummary[] = [];
      for (let page = 1; page <= 10; page++) {
        const res = await firstValueFrom(
          this.inventory.list({ controlled: true, status: 'all', page }),
        );
        all.push(...res.items);
        if (all.length >= res.total || !res.items.length) break;
      }
      this.items.set(all);
      this.kept.set(new Set(all.map((p) => p.id)));
    } catch (error) {
      this.toast.error(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected isKept(id: number): boolean {
    return this.kept().has(id);
  }

  protected toggle(id: number, keep: boolean): void {
    this.kept.update((s) => {
      const next = new Set(s);
      if (keep) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected uncheckAll(): void {
    this.kept.set(new Set());
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      for (const p of this.removed())
        await firstValueFrom(this.inventory.update(p.id, { controlled: false }));
      try {
        localStorage.setItem(CONTROLLED_REVIEWED_KEY, JSON.stringify(this.keep().map((p) => p.id)));
      } catch {
        // sin almacenamiento: el aviso puede volver a salir, no pasa nada
      }
      const n = this.removed().length;
      this.toast.success(
        n
          ? `Listo: ${n} ${n === 1 ? 'producto ya no es' : 'productos ya no son'} psicotrópico.`
          : 'Revisado.',
      );
      void this.router.navigate(['/inventario']);
    } catch (error) {
      this.toast.error(apiErrorMessage(error));
      this.saving.set(false);
    }
  }
}
