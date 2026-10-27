import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';

const COLLAPSED_KEY = 'vet.sidebar.collapsed';
/** Mismo punto de quiebre que la clase `lg:` de Tailwind (64rem). */
const DESKTOP_QUERY = '(min-width: 64rem)';

/** Estado compartido del layout (sidebar colapsado en escritorio / abierto en móvil). */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** Escritorio: menú reducido a iconos. Se recuerda entre sesiones. */
  readonly collapsed = signal(readCollapsed());
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
    media?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => media?.removeEventListener('change', onChange));

    effect(() => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(this.collapsed()));
      } catch {
        /* almacenamiento no disponible: no es crítico */
      }
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
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
function desktopQuery(): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(DESKTOP_QUERY) : null;
}
