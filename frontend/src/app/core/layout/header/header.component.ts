import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { AuthService } from '../../auth/auth.service';
import { SessionService } from '../../auth/session.service';
import { LayoutService } from '../layout.service';

export interface HeaderNotification {
  id: number;
  title: string;
  detail: string;
  time: string;
}

type OpenMenu = 'notifications' | 'profile' | null;

@Component({
  selector: 'app-header',
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  templateUrl: './header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class HeaderComponent {
  protected readonly layout = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly search = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(80)],
  });

  protected readonly openMenu = signal<OpenMenu>(null);

  protected readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);

  // TODO: alimentar desde NotificationService (stock bajo, vacunas por vencer, citas del día).
  protected readonly notifications = signal<HeaderNotification[]>([]);

  submitSearch(): void {
    if (this.search.invalid) return;
    const q = this.search.value.trim();
    this.router.navigate(['/clientes'], { queryParams: q ? { q } : {} });
    this.searchInput().nativeElement.blur();
  }

  logout(): void {
    this.openMenu.set(null);
    this.auth.logout();
  }

  toggle(menu: Exclude<OpenMenu, null>): void {
    this.openMenu.update((current) => (current === menu ? null : menu));
  }

  onDocumentClick(event: MouseEvent): void {
    if (this.openMenu() && !this.host.nativeElement.contains(event.target as Node)) {
      this.openMenu.set(null);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.openMenu.set(null);
      this.layout.closeMobile();
      return;
    }
    // Atajo "/" para ir a la búsqueda (salvo que ya se esté escribiendo en un campo)
    const target = event.target as HTMLElement;
    const typing =
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      this.searchInput().nativeElement.focus();
    }
  }
}
