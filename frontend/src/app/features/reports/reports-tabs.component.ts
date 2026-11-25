import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';

const TABS: { label: string; route: string; icon: IconName }[] = [
  { label: 'Ventas', route: '/reportes', icon: 'chart-column' },
  { label: 'Margen', route: '/reportes/margen', icon: 'trending-up' },
  { label: 'Inventario', route: '/reportes/inventario', icon: 'package' },
  { label: 'Control', route: '/reportes/control', icon: 'shield-check' },
];

/**
 * Pestañas de Reportes: cada una es su propia dirección (se puede compartir o recargar) y llevan
 * el período elegido (?periodo=…), así Ventas, Margen y Control muestran las mismas fechas.
 */
@Component({
  selector: 'app-reports-tabs',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav
      aria-label="Reportes"
      class="-mx-1 overflow-x-auto overflow-y-hidden border-b border-slate-200"
    >
      <ul class="flex min-w-max gap-1 px-1">
        @for (tab of tabs; track tab.route) {
          <li>
            <a
              [routerLink]="tab.route"
              routerLinkActive="!border-anil-600 !text-anil-700"
              [routerLinkActiveOptions]="activeOptions"
              queryParamsHandling="preserve"
              ariaCurrentWhenActive="page"
              class="-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              <span class="hidden sm:inline-flex" aria-hidden="true"
                ><app-icon [name]="tab.icon" class="size-4"
              /></span>
              {{ tab.label }}
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class ReportsTabsComponent {
  protected readonly tabs = TABS;
  /** Marcada aunque cambie el período (?periodo=…) */
  protected readonly activeOptions: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    fragment: 'ignored',
    matrixParams: 'ignored',
  };
}
