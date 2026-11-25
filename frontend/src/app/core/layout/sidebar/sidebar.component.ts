import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { LogoComponent } from '../../../shared/ui/logo/logo.component';
import { SessionService } from '../../auth/session.service';
import { LayoutService } from '../layout.service';
import { NavigationHistoryService } from '../../navigation/navigation-history.service';
import { APP_BRAND, NavItem, navFor } from '../nav-items';

/** Pantallas a las que se llega desde varias secciones: el menú marca la sección de donde vino */
const SHARED_DETAIL = /^\/(caja\/tickets|mascotas|recetas|consentimientos|atenciones)\/\d+/;
const pathOf = (url: string) => url.split(/[?#]/)[0];

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, IconComponent, LogoComponent],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  protected readonly layout = inject(LayoutService);
  protected readonly session = inject(SessionService);
  protected readonly groups = computed(() => navFor(this.session.role()));
  protected readonly brand = APP_BRAND;

  private readonly router = inject(Router);
  private readonly history = inject(NavigationHistoryService);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** La opción del menú que corresponde a una dirección (la ruta más larga que la contiene) */
  private match(url: string): NavItem | null {
    const path = pathOf(url);
    let best: NavItem | null = null;
    for (const item of this.groups().flatMap((g) => g.items)) {
      const hit = item.exact
        ? path === item.route
        : path === item.route || path.startsWith(item.route + '/');
      if (hit && (!best || item.route.length > best.route.length)) best = item;
    }
    return best;
  }

  /** Un ticket abierto desde Comprobantes marca Comprobantes, no Caja (igual mascota, receta…) */
  protected readonly active = computed(() => {
    const url = this.url();
    const prev = this.history.previous();
    if (prev && SHARED_DETAIL.test(pathOf(url))) {
      const origin = this.match(prev);
      if (origin) return origin.route;
    }
    return this.match(url)?.route ?? null;
  });
}
