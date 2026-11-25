import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { STOCK_ROLES } from '../../core/services/inventory.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';

const TABS: { label: string; route: string; icon: IconName; exact: boolean }[] = [
  { label: 'Productos', route: '/inventario', icon: 'package', exact: true },
  { label: 'Compras', route: '/inventario/compras', icon: 'receipt', exact: false },
  { label: 'Proveedores', route: '/inventario/proveedores', icon: 'building', exact: false },
];

/**
 * Pestañas de Inventario. Compras y Proveedores son de quien ingresa stock (administrador y
 * veterinario); recepción y caja solo consultan productos, así que no ven pestañas.
 */
@Component({
  selector: 'app-inventory-tabs',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (visible()) {
      <nav
        aria-label="Inventario"
        class="-mx-1 overflow-x-auto overflow-y-hidden border-b border-slate-200"
      >
        <ul class="flex min-w-max gap-1 px-1">
          @for (tab of tabs; track tab.route) {
            <li>
              <a
                [routerLink]="tab.route"
                routerLinkActive="!border-anil-600 !text-anil-700"
                [routerLinkActiveOptions]="tab.exact ? EXACT_PATH : SUBSET_PATH"
                ariaCurrentWhenActive="page"
                class="-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
              >
                <app-icon [name]="tab.icon" class="size-4" />
                {{ tab.label }}
              </a>
            </li>
          }
        </ul>
      </nav>
    }
  `,
})
export class InventoryTabsComponent {
  // Los filtros (?filtro=, ?q=) no deben apagar la pestaña activa
  protected readonly EXACT_PATH: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };
  protected readonly SUBSET_PATH: IsActiveMatchOptions = { ...this.EXACT_PATH, paths: 'subset' };

  private readonly session = inject(SessionService);
  protected readonly tabs = TABS;
  protected readonly visible = computed(() =>
    STOCK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
}
