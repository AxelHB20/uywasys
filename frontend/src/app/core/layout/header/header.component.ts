import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HeaderAlert } from '../../services/dashboard.service';
import {
  NotificationEvent,
  TONE_TILE,
  eventView,
  timeAgo,
} from '../../services/notifications.models';
import { NotificationsService } from '../../services/notifications.service';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { IconName } from '../../../shared/ui/icon/icons';
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
    case 'doses':
      return {
        ...base,
        tone: 'danger',
        title: `${plural(a.count, 'dosis atrasada', 'dosis atrasadas')} en hospitalización`,
        detail: 'Regístralas en la hoja de tratamiento',
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
    case 'labReview':
      return {
        ...base,
        tone: 'warning',
        title: `${plural(a.count, 'resultado', 'resultados')} de examen por revisar`,
        detail: 'Revísalos e interprétalos antes de avisar al dueño',
      };
    case 'billingLate':
      return {
        ...base,
        tone: 'danger',
        title: `${plural(a.count, 'comprobante', 'comprobantes')} sin aceptar hace más de un día`,
        detail: 'SUNAT da hasta 3 días para la factura: revísalos hoy',
      };
    case 'staleGrooming':
      return {
        ...base,
        tone: 'warning',
        title: `${plural(a.count, 'grooming sin entregar', 'grooming sin entregar')} de días anteriores`,
        detail: 'Entrégalos en el tablero para poder cobrarlos',
      };
    case 'staleVisits':
      return {
        ...base,
        tone: 'danger',
        title: `${plural(a.count, 'atención abierta', 'atenciones abiertas')} de días anteriores`,
        detail: 'Ciérralas para poder cobrarlas',
      };
    case 'labOverdue':
      return {
        ...base,
        tone: 'warning',
        title: `${plural(a.count, 'examen', 'exámenes')} sin resultado hace días`,
        detail: 'Llama al laboratorio o revisa si se tomó la muestra',
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

type OpenMenu = 'notifications' | 'profile' | null;

@Component({
  selector: 'app-header',
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet, IconComponent],
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

  protected readonly center = inject(NotificationsService);
  /** Pendientes (conteos de siempre) en palabras */
  protected readonly notifications = computed(() => this.center.alerts().map(toNotification));
  protected readonly tab = signal<'events' | 'pending'>('events');
  protected readonly now = signal(Date.now());
  protected readonly eventView = eventView;
  protected readonly timeAgo = timeAgo;
  protected readonly tile = TONE_TILE;
  protected readonly alertTile: Record<HeaderNotification['tone'], string> = {
    danger: TONE_TILE.danger,
    warning: TONE_TILE.warning,
    info: TONE_TILE.info,
  };
  protected readonly alertIcon: Record<string, IconName> = {
    urgent: 'alert',
    doses: 'pill',
    billing: 'file-text',
    billingLate: 'clock',
    staleCash: 'receipt',
    expiring: 'calendar',
    shortage: 'package',
    lowStock: 'package',
  };
  /** Lo nuevo desde la última vez que abrió la campana (se resalta en la lista) */
  protected readonly fresh = computed(() => {
    const since = this.center.highlightSince();
    return this.center.events().filter((e) => !since || e.at > since);
  });
  protected readonly earlier = computed(() => {
    const since = this.center.highlightSince();
    return since ? this.center.events().filter((e) => e.at <= since) : [];
  });
  /** El número de la campana: no leídas; un pulso cuando sube */
  protected readonly badge = computed(() => this.center.unread());
  protected readonly pop = signal(false);
  /** La campana se balancea una vez cuando llega algo urgente (no al entrar a la app) */
  protected readonly ring = signal(false);
  private readonly urgentUnread = computed(() => {
    const seen = this.center.seenAt();
    return this.center.events().filter((e) => e.urgent && (!seen || e.at > seen)).length;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.center.start(destroyRef);
    effect(() => this.center.panelOpen.set(this.openMenu() === 'notifications'));
    let last = 0;
    effect(() => {
      const n = this.badge();
      if (n > last) {
        this.pop.set(false);
        setTimeout(() => this.pop.set(true));
      }
      last = n;
    });
    let lastUrgent = 0;
    effect(() => {
      const n = this.urgentUnread();
      // La primera carga solo aprende lo que ya había
      if (this.center.refreshes() > 1 && n > lastUrgent) {
        this.ring.set(false);
        setTimeout(() => this.ring.set(true));
      }
      lastUrgent = n;
    });
  }

  /** Qué verá en "Para ti" según su rol */
  protected readonly emptyHint = computed(() => {
    switch (this.session.role()) {
      case 'VET':
        return 'Te avisaremos cuando llegue un paciente a la cola o te agenden una cita.';
      case 'GROOMER':
        return 'Te avisaremos cuando ingrese una mascota a grooming.';
      case 'RECEPTION':
      case 'CASHIER':
        return 'Te avisaremos cuando una atención quede lista para cobrar o un baño esté listo para entregar.';
      default:
        return 'Llegadas, cobros pendientes, baños listos, citas nuevas y comprobantes rechazados.';
    }
  });

  protected toggleNotifications(): void {
    const opening = this.openMenu() !== 'notifications';
    this.toggle('notifications');
    if (opening) {
      this.now.set(Date.now());
      this.tab.set(
        this.center.events().length || !this.notifications().length ? 'events' : 'pending',
      );
      this.center.markSeen();
      // Lo que estaba en avisos emergentes ya está a la vista en la lista
      this.center.toasts.set([]);
    }
  }

  protected openEvent(e: NotificationEvent): void {
    this.openMenu.set(null);
    this.center.open(e.link, e.query);
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
