import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { SessionUser } from './core/auth/auth.models';
import { authInterceptor } from './core/auth/auth.interceptor';

const user: SessionUser = {
  id: 1,
  fullName: 'Ana Quispe',
  email: 'ana@uywa.pe',
  role: 'ADMIN',
  licenseNumber: null,
  mustChangePassword: false,
  clinic: { id: 1, name: 'Veterinaria San Martín', logoUrl: null },
};

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('App', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  it('sin sesión, manda al login y recuerda a dónde volver', async () => {
    const fixture = TestBed.createComponent(App);
    const navigation = router.navigateByUrl('/inventario');
    await tick();
    http
      .expectOne('/api/auth/me')
      .flush(
        { message: 'Inicia sesión para continuar' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await navigation;
    await fixture.whenStable();
    expect(router.url).toBe('/login?volver=%2Finventario');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Inicia sesión');
  });

  it('con sesión, muestra el nombre de la clínica y del usuario', async () => {
    const fixture = TestBed.createComponent(App);
    const navigation = router.navigateByUrl('/dashboard');
    await tick();
    http.expectOne('/api/auth/me').flush(user);
    await navigation;
    fixture.detectChanges();
    await tick();
    http
      .expectOne('/api/health')
      .flush({ status: 'ok', database: 'up', time: '2026-10-27T19:00:00Z' });
    http.expectOne('/api/clinic/setup').flush({ profileComplete: false, teamMembers: 0 });
    http.expectOne('/api/dashboard').flush({
      day: '2026-10-27',
      queue: { arrived: 0, waiting: 0, inProgress: 0, urgent: 0, done: 0, items: [] },
      clients: { active: 0, newThisMonth: 0 },
      pets: { active: 0 },
      inventory: { expiring: 0, lowStock: 0 },
      sales: { total: 0, collected: 0, refunded: 0, receipts: 0 },
      recentClients: [],
    });
    // Lo cobrado en el mes (solo el administrador); si falla, el inicio sigue igual
    http.expectOne('/api/reports/month').flush(null, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('aside')?.textContent).toContain('Veterinaria San Martín');
    expect(el.textContent).toMatch(/Buen(os|as) (días|tardes|noches)/);
    expect(el.textContent).toContain('Ana');
  });

  it('con clave temporal, obliga a cambiarla antes de entrar', async () => {
    const fixture = TestBed.createComponent(App);
    const navigation = router.navigateByUrl('/dashboard');
    await tick();
    http.expectOne('/api/auth/me').flush({ ...user, mustChangePassword: true });
    await navigation;
    await fixture.whenStable();
    expect(router.url).toBe('/cambiar-clave');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('clave temporal');
  });

  it('solo el administrador entra a usuarios', async () => {
    const fixture = TestBed.createComponent(App);
    const navigation = router.navigateByUrl('/usuarios');
    await tick();
    http.expectOne('/api/auth/me').flush({ ...user, role: 'VET', licenseNumber: '123' });
    await navigation;
    fixture.detectChanges();
    await tick();
    http
      .expectOne('/api/health')
      .flush({ status: 'ok', database: 'up', time: '2026-10-27T19:00:00Z' });
    http.expectNone('/api/clinic/setup');
    http.expectOne('/api/dashboard').flush({
      day: '2026-10-27',
      queue: { arrived: 0, waiting: 0, inProgress: 0, urgent: 0, done: 0, items: [] },
      clients: { active: 0, newThisMonth: 0 },
      pets: { active: 0 },
      inventory: { expiring: 0, lowStock: 0 },
      sales: { total: 0, collected: 0, refunded: 0, receipts: 0 },
      recentClients: [],
    });
    await fixture.whenStable();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('aside')?.textContent,
    ).not.toContain('Usuarios');
    expect(router.url).toBe('/dashboard');
  });
});
