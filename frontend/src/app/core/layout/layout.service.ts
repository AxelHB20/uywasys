import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

const COLLAPSED_KEY = 'vet.sidebar.collapsed';
/** Mismo punto de quiebre que la clase `lg:` de Tailwind (64rem). */
const DESKTOP_QUERY = '(min-width: 64rem)';
/** Tablet acostada / laptop chica: entre `lg` y `xl` (64rem–80rem). El menú va solo con íconos. */
const TABLET_QUERY = '(min-width: 64rem) and (max-width: 79.98rem)';

/** Estado compartido del layout (sidebar colapsado en escritorio / abierto en móvil). */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** Escritorio: menú reducido a iconos (preferencia que se recuerda entre sesiones). */
  private readonly collapsedPref = signal(readCollapsed());
  /** Tablet acostada (1024–1279 px): el menú arranca con íconos para dar espacio al contenido. */
  readonly isTablet = signal(mediaQuery(TABLET_QUERY)?.matches ?? false);
  /** En tablet se puede abrir el menú completo un momento (no se recuerda). */
  private readonly tabletExpanded = signal(false);
  /** Menú con íconos: en tablet salvo que se abra; en escritorio, según la preferencia. */
  readonly collapsed = computed(() =>
    this.isTablet() ? !this.tabletExpanded() : this.collapsedPref(),
  );
  /** Móvil: menú desplegado sobre el contenido. */
  readonly mobileOpen = signal(false);
  /** true en pantallas `lg` o más anchas. */
  readonly isDesktop = signal(desktopQuery()?.matches ?? true);

  constructor() {
    const media = desktopQuery();
    const onChange = (e: MediaQueryListEvent) => {
      this.isDesktop.set(e.matches);
      if (e.matches) this.mobileOpen.set(false);
    };
    const tablet = mediaQuery(TABLET_QUERY);
    const onTablet = (e: MediaQueryListEvent) => {
      this.isTablet.set(e.matches);
      this.tabletExpanded.set(false);
    };
    media?.addEventListener('change', onChange);
    tablet?.addEventListener('change', onTablet);
    inject(DestroyRef).onDestroy(() => {
      media?.removeEventListener('change', onChange);
      tablet?.removeEventListener('change', onTablet);
    });

    effect(() => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(this.collapsedPref()));
      } catch {
        /* almacenamiento no disponible: no es crítico */
      }
    });
  }

  toggleCollapsed(): void {
    if (this.isTablet()) this.tabletExpanded.update((v) => !v);
    else this.collapsedPref.update((v) => !v);
  }

  openMobile(): void {
    this.mobileOpen.set(true);
  }

  closeMobile(): void {
    this.mobileOpen.set(false);
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** matchMedia no existe en algunos entornos (SSR, jsdom en pruebas). */
function mediaQuery(query: string): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(query) : null;
}

function desktopQuery(): MediaQueryList | null {
  return mediaQuery(DESKTOP_QUERY);
}
