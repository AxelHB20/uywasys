import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter, throttleTime } from 'rxjs';
import { SessionService } from '../auth/session.service';
import {
  EventView,
  NotificationEvent,
  NotificationsView,
  eventView,
  SystemBanner,
} from './notifications.models';

/** Un aviso emergente en la esquina (desaparece solo; las urgencias se quedan más) */
export interface NotificationToast {
  id: string;
  view: EventView;
  link: string;
  query?: Record<string, string>;
  urgent: boolean;
}

interface Prefs {
  sound: boolean;
  desktop: boolean;
}

const VISIBLE_EVERY = 30_000;
const HIDDEN_EVERY = 90_000;
const MAX_TOASTS = 3;

/**
 * Centro de notificaciones: consulta pendientes y lo que pasó hoy (cada 30 s con la pestaña a la
 * vista, cada 90 s minimizada), cuenta las no leídas y muestra un aviso emergente cuando llega algo
 * nuevo. Sonido y avisos del escritorio son opcionales y los activa cada usuario.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);

  readonly alerts = signal<NotificationsView['alerts']>([]);
  readonly events = signal<NotificationEvent[]>([]);
  readonly banners = signal<SystemBanner[]>([]);
  /** Cuántas veces llegó la información (la primera solo aprende lo que ya había) */
  readonly refreshes = signal(0);
  readonly seenAt = signal<string | null>(null);
  readonly toasts = signal<NotificationToast[]>([]);
  readonly prefs = signal<Prefs>({ sound: false, desktop: false });
  /** Para marcar en la lista lo que era nuevo al abrir la campana */
  readonly highlightSince = signal<string | null>(null);
  /** Con la campana abierta los avisos emergentes no tapan el panel */
  readonly panelOpen = signal(false);

  readonly unread = computed(() => {
    const seen = this.seenAt();
    return this.events().filter((e) => !seen || e.at > seen).length;
  });
  readonly dangerAlerts = computed(
    () =>
      this.alerts().filter((a) =>
        ['urgent', 'doses', 'billing', 'billingLate', 'staleCash'].includes(a.kind),
      ).length,
  );

  private known: Set<string> | null = null;
  private lastDoses = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subs: Subscription | null = null;
  private running = false;

  /** Lo llama la cabecera al entrar a la app; se detiene al salir */
  start(destroyRef: DestroyRef): void {
    if (this.running) return;
    this.running = true;
    this.known = null;
    this.prefs.set(this.readPrefs());
    this.subs = this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        throttleTime(20_000),
      )
      .subscribe(() => this.refresh());
    const onVisible = () => !document.hidden && this.refresh();
    document.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => {
      this.running = false;
      this.subs?.unsubscribe();
      if (this.timer) clearTimeout(this.timer);
      document.removeEventListener('visibilitychange', onVisible);
      this.toasts.set([]);
      this.banners.set([]);
    });
    this.refresh();
  }

  refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.http.get<NotificationsView>('/api/notifications').subscribe({
      next: (v) => {
        this.apply(v);
        this.schedule();
      },
      error: () => this.schedule(),
    });
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.refresh(), document.hidden ? HIDDEN_EVERY : VISIBLE_EVERY);
  }

  private apply(v: NotificationsView): void {
    this.alerts.set(v.alerts);
    this.events.set(v.events);
    this.banners.set(v.banners ?? []);
    this.refreshes.update((n) => n + 1);
    this.seenAt.set(v.seenAt);
    const doses = v.alerts.find((a) => a.kind === 'doses')?.count ?? 0;
    // La primera carga solo aprende lo que ya había: no salta un aviso por cada cosa del día
    if (this.known) {
      const fresh = v.events.filter(
        (e) => !this.known!.has(e.id) && (!v.seenAt || e.at > v.seenAt),
      );
      for (const e of fresh.reverse()) this.announce(e);
      if (doses > this.lastDoses)
        this.push({
          id: `doses:${Date.now()}`,
          urgent: true,
          link: '/hospitalizacion',
          view: {
            title: doses === 1 ? '1 dosis atrasada' : `${doses} dosis atrasadas`,
            detail: 'Regístralas en la hoja de tratamiento',
            icon: 'alert',
            tone: 'danger',
            action: 'Ver',
          },
        });
    }
    this.lastDoses = doses;
    this.known = new Set(v.events.map((e) => e.id));
  }

  private announce(e: NotificationEvent): void {
    const view = eventView(e);
    this.push({ id: e.id, view, link: e.link, query: e.query, urgent: e.urgent });
    const prefs = this.prefs();
    if (e.urgent && prefs.sound) this.beep();
    if (
      prefs.desktop &&
      document.hidden &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const n = new Notification(view.title, {
        body: view.detail,
        tag: e.id,
        icon: '/favicon.ico',
      });
      n.onclick = () => {
        window.focus();
        this.open(e.link, e.query);
        n.close();
      };
    }
  }

  private push(t: NotificationToast): void {
    this.toasts.update((list) => [t, ...list.filter((x) => x.id !== t.id)].slice(0, MAX_TOASTS));
  }

  dismiss(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  open(link: string, query?: Record<string, string>): void {
    void this.router.navigate([link], { queryParams: query ?? {} });
  }

  /** Al abrir la campana: lo nuevo se resalta en la lista y el contador se limpia */
  markSeen(): void {
    this.highlightSince.set(this.seenAt());
    if (!this.unread()) return;
    this.seenAt.set(new Date().toISOString());
    this.http.post<{ seenAt: string }>('/api/notifications/seen', {}).subscribe({
      next: ({ seenAt }) => this.seenAt.set(seenAt),
      error: () => undefined,
    });
  }

  setPref(key: keyof Prefs, value: boolean): void {
    if (
      key === 'desktop' &&
      value &&
      'Notification' in window &&
      Notification.permission !== 'granted'
    ) {
      void Notification.requestPermission().then((p) => {
        this.savePrefs({ ...this.prefs(), desktop: p === 'granted' });
      });
      return;
    }
    this.savePrefs({ ...this.prefs(), [key]: value });
    if (key === 'sound' && value) this.beep();
  }

  desktopBlocked(): boolean {
    return 'Notification' in window && Notification.permission === 'denied';
  }

  private prefsKey(): string {
    return `uywa.notificaciones.${this.session.user()?.id ?? 0}`;
  }

  private readPrefs(): Prefs {
    try {
      const raw = localStorage.getItem(this.prefsKey());
      return raw
        ? { sound: false, desktop: false, ...JSON.parse(raw) }
        : { sound: false, desktop: false };
    } catch {
      return { sound: false, desktop: false };
    }
  }

  private savePrefs(p: Prefs): void {
    this.prefs.set(p);
    try {
      localStorage.setItem(this.prefsKey(), JSON.stringify(p));
    } catch {
      /* navegación privada: solo dura esta sesión */
    }
  }

  /** Dos tonos cortos, sin archivos de audio */
  private beep(): void {
    try {
      const ctx = new AudioContext();
      [880, 660].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.17);
      });
      setTimeout(() => void ctx.close(), 600);
    } catch {
      /* sin audio disponible */
    }
  }
}
