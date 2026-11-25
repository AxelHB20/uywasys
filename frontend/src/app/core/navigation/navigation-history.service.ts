import { Injectable, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

interface Entry {
  id: number;
  url: string;
  /** Dónde estaba la página al salir, para dejarla igual al volver */
  scrollY?: number;
}

const path = (url: string) => url.split(/[?#]/)[0];

/** Nombre de la pantalla a la que se vuelve, por su dirección (la más específica primero). */
const PAGE_LABELS: [RegExp, string][] = [
  [/^\/dashboard/, 'Inicio'],
  [/^\/cola/, 'Cola de hoy'],
  [/^\/citas/, 'Citas'],
  [/^\/atenciones\/\d+/, 'Atención'],
  [/^\/atenciones/, 'Atenciones'],
  [/^\/clientes\/importar/, 'Importar clientes'],
  [/^\/clientes\/\d+/, 'Cliente'],
  [/^\/clientes/, 'Clientes'],
  [/^\/mascotas\/\d+\/carnet/, 'Carnet'],
  [/^\/mascotas\/\d+/, 'Historia clínica'],
  [/^\/historias/, 'Historias clínicas'],
  [/^\/vacunas/, 'Refuerzos'],
  [/^\/consultas/, 'Consultas'],
  [/^\/presupuestos\/\d+/, 'Presupuesto'],
  [/^\/presupuestos/, 'Presupuestos'],
  [/^\/hospitalizacion\/\d+/, 'Hospitalización'],
  [/^\/hospitalizacion/, 'Hospitalización'],
  [/^\/grooming/, 'Grooming'],
  [/^\/plantillas/, 'Plantillas'],
  [/^\/inventario\/controlados/, 'Controlados'],
  [/^\/inventario\/compras\/nueva/, 'Recibir compra'],
  [/^\/inventario\/compras\/\d+/, 'Compra'],
  [/^\/inventario\/compras/, 'Compras'],
  [/^\/inventario\/proveedores/, 'Proveedores'],
  [/^\/inventario\/\d+/, 'Producto'],
  [/^\/inventario/, 'Inventario'],
  [/^\/servicios/, 'Servicios'],
  [/^\/caja\/tickets/, 'Ticket'],
  [/^\/caja/, 'Caja'],
  [/^\/comprobantes\/configuracion/, 'Configuración de comprobantes'],
  [/^\/comprobantes/, 'Comprobantes'],
  [/^\/reportes/, 'Reportes'],
  [/^\/actividad/, 'Actividad'],
  [/^\/usuarios/, 'Usuarios'],
  [/^\/configuracion/, 'Configuración'],
];

export function pageLabel(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  return PAGE_LABELS.find(([re]) => re.test(path))?.[1] ?? null;
}

/**
 * Historial de navegación dentro de la app: "Volver" regresa a la pantalla de donde vino
 * (con sus filtros, porque viven en la dirección), y no a una fija. Las navegaciones con
 * `replaceUrl` (filtros, o salir de un formulario ya guardado) no agregan pasos.
 */
@Injectable({ providedIn: 'root' })
export class NavigationHistoryService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly stack: Entry[] = [];
  private popTo: number | null = null;
  private replacing = false;
  /** La pantalla anterior dentro de la app (null si se entró directo por la dirección) */
  readonly previous = signal<string | null>(null);

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.popTo =
          e.navigationTrigger === 'popstate' ? (e.restoredState?.navigationId ?? -1) : null;
        this.replacing = !!this.router.currentNavigation()?.extras.replaceUrl;
        const top = this.stack.at(-1);
        if (top) top.scrollY = window.scrollY;
        return;
      }
      if (!(e instanceof NavigationEnd)) return;
      const entry: Entry = { id: e.id, url: e.urlAfterRedirects };
      const replace = this.replacing;
      const before = this.stack.at(-1);
      let restore: number | undefined;
      if (this.popTo !== null) {
        // Atrás o adelante del navegador: se vuelve a esa entrada si la conocemos
        const at = this.stack.findIndex((s) => s.id === this.popTo);
        if (at >= 0) {
          restore = this.stack[at].scrollY;
          this.stack.length = at + 1;
          this.stack[at] = { ...entry, scrollY: restore };
        } else this.stack.push(entry);
      } else if (replace && before) this.stack[this.stack.length - 1] = entry;
      else this.stack.push(entry);
      this.previous.set(this.stack.length > 1 ? this.stack[this.stack.length - 2].url : null);

      if (restore !== undefined) this.restoreScroll(restore);
      // Pantalla nueva: arriba. Solo filtros de la misma pantalla: se queda donde está
      else if (!before || path(before.url) !== path(entry.url)) window.scrollTo?.({ top: 0 });
    });
  }

  /** Al volver, la lista se carga después: se reintenta hasta que la página alcance esa altura */
  private restoreScroll(y: number): void {
    let tries = 0;
    const attempt = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= y || tries++ > 20) window.scrollTo?.({ top: Math.min(y, Math.max(max, 0)) });
      else setTimeout(attempt, 50);
    };
    setTimeout(attempt);
  }

  /** Vuelve a la pantalla anterior; si se entró directo, va a `fallback` */
  back(fallback: string): void {
    if (this.previous()) this.location.back();
    else void this.router.navigateByUrl(fallback);
  }
}
