import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NavigationHistoryService, pageLabel } from './navigation-history.service';

@Component({ template: '' })
class Blank {}

describe('NavigationHistoryService ("Volver" a donde vino)', () => {
  let router: Router;
  let history: NavigationHistoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'comprobantes', component: Blank },
          { path: 'caja', component: Blank },
          { path: 'caja/tickets/:id', component: Blank },
          { path: 'clientes/nuevo', component: Blank },
          { path: 'clientes/:id', component: Blank },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    history = TestBed.inject(NavigationHistoryService);
  });

  it('desde Comprobantes, el ticket vuelve a Comprobantes con sus filtros', async () => {
    await router.navigateByUrl('/comprobantes');
    await router.navigate(['/comprobantes'], { queryParams: { tipo: 'BOLETA' }, replaceUrl: true });
    await router.navigateByUrl('/caja/tickets/9');
    expect(history.previous()).toBe('/comprobantes?tipo=BOLETA');
    expect(pageLabel(history.previous()!)).toBe('Comprobantes');
  });

  it('entrar directo al ticket no tiene anterior: se usa el destino de respaldo', async () => {
    await router.navigateByUrl('/caja/tickets/9');
    expect(history.previous()).toBeNull();
    history.back('/caja');
    await TestBed.inject(Router).navigated;
    await new Promise((r) => setTimeout(r));
    expect(router.url).toBe('/caja');
  });

  it('salir de un formulario guardado (replaceUrl) no deja el formulario en el camino de vuelta', async () => {
    await router.navigateByUrl('/caja');
    await router.navigateByUrl('/clientes/nuevo');
    await router.navigate(['/clientes', 7], { replaceUrl: true });
    expect(history.previous()).toBe('/caja');
    expect(pageLabel('/clientes/7')).toBe('Cliente');
  });
});
