import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { catchError, filter, interval, merge, of, startWith, switchMap, throttleTime } from 'rxjs';
import { DashboardService, HeaderAlert } from '../../services/dashboard.service';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { AuthService } from '../../auth/auth.service';
import { SessionService } from '../../auth/session.service';
import { LayoutService } from '../layout.service';

export interface HeaderNotification {
  id: string;
  title: string;
  detail: string;
  link: string;
  query?: Record<string, string>;
  tone: 'danger' | 'warning' | 'info';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Texto de cada aviso; el número y el enlace vienen del backend */
export function toNotification(a: HeaderAlert): HeaderNotification {
  const base = { id: a.kind, link: a.link, query: a.query };
  switch (a.kind) {
    case 'urgent':
      return {
        ...base,
        tone: 'danger',
        title: `${plural(a.count, 'urgencia', 'urgencias')} en la cola`,
        detail: 'Pasan antes que los demás',
      };
    case 'billing':
      return {
        ...base,
        tone: 'danger',
        title: `${plural(a.count, 'comprobante', 'comprobantes')} con problemas`,
        detail: 'SUNAT los rechazó o no salen: revisa el motivo',
      };
    case 'staleCash':
      return {
        ...base,
        tone: 'danger',
        title: 'Caja abierta desde otro día',
        detail: 'Ciérrala con arqueo antes de seguir cobrando',
      };
    case 'expiring':
      return {
        ...base,
        tone: 'warning',
        title: `${plural(a.count, 'lote vencido o por vencer', 'lotes vencidos o por vencer')}`,
        detail: 'Vencidos o dentro de los próximos 30 días',
      };
    case 'shortage':
      return {
        ...base,
        tone: 'warning',
        title: `${plural(a.count, 'insumo usado', 'insumos usados')} sin stock`,
        detail: 'Registra la compra o haz un conteo',
      };
    case 'lowStock':
      return {
        ...base,
        tone: 'info',
        title: `${plural(a.count, 'producto', 'productos')} con stock bajo`,
        detail: 'Están en el mínimo o por debajo',
      };
  }
}

/** Cada cuánto se revisan los avisos aunque nadie navegue (ms) */
const ALERTS_EVERY = 120_000;

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

  private readonly dashboard = inject(DashboardService);
  protected readonly notifications = signal<HeaderNotification[]>([]);

  constructor() {
    // Al entrar, al cambiar de pantalla (como mucho una vez cada 20 s) y cada 2 minutos.
    merge(
      this.router.events.pipe(
        filter((e) => e instanceof NavigationEnd),
        throttleTime(20_000),
      ),
      interval(ALERTS_EVERY),
    )
      .pipe(
        startWith(null),
        switchMap(() => this.dashboard.alerts().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((alerts) => {
        if (alerts) this.notifications.set(alerts.map(toNotification));
      });
  }

  protected openNotification(n: HeaderNotification): void {
    this.openMenu.set(null);
    this.router.navigate([n.link], { queryParams: n.query ?? {} });
  }

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
