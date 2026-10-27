import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { LogoComponent } from '../../../shared/ui/logo/logo.component';
import { SessionService } from '../../auth/session.service';
import { LayoutService } from '../layout.service';
import { APP_BRAND, navFor } from '../nav-items';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, IconComponent, LogoComponent],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  protected readonly layout = inject(LayoutService);
  protected readonly session = inject(SessionService);
  protected readonly groups = computed(() => navFor(this.session.role()));
  protected readonly brand = APP_BRAND;
}
