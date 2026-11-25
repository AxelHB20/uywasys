import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationToastsComponent } from '../notifications/notification-toasts.component';
import { HeaderComponent } from '../header/header.component';
import { LayoutService } from '../layout.service';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { SystemBannersComponent } from '../notifications/system-banners.component';

/** Estructura principal de la app: menú lateral fijo + barra superior + contenido. */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    SidebarComponent,
    HeaderComponent,
    NotificationToastsComponent,
    SystemBannersComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      href="#contenido"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
    >
      Saltar al contenido
    </a>

    <app-sidebar />

    <div
      class="flex min-h-dvh flex-col transition-[padding] duration-200 ease-out"
      [class]="layout.collapsed() ? 'lg:pl-24' : 'lg:pl-72'"
    >
      <app-header />
      <app-notification-toasts />
      <app-system-banners />
      <main
        id="contenido"
        tabindex="-1"
        class="flex-1 px-4 pb-10 pt-2 focus:outline-none sm:px-6 lg:px-8"
      >
        <div class="mx-auto w-full max-w-7xl">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
export class ShellComponent {
  protected readonly layout = inject(LayoutService);
}
