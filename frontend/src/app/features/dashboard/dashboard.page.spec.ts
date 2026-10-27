import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { DashboardPage, greetingFor } from './dashboard.page';

describe('DashboardPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana Quispe',
      email: 'ana@uywa.pe',
      role: 'VET',
      licenseNumber: '12345',
      mustChangePassword: false,
      clinic: { id: 1, name: 'Veterinaria San Martín', logoUrl: null },
    });
  });

  afterEach(() => http.verify());

  it('muestra el sistema conectado cuando la API responde', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    http
      .expectOne('/api/health')
      .flush({ status: 'ok', database: 'up', time: '2026-10-27T19:00:00Z' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sistema en línea');
  });

  it('avisa cuando no hay conexión con el servidor', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    http.expectOne('/api/health').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No hay conexión con el servidor',
    );
  });

  it('el veterinario no ve los primeros pasos de configuración', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    http
      .expectOne('/api/health')
      .flush({ status: 'ok', database: 'up', time: '2026-10-27T19:00:00Z' });
    http.expectNone('/api/clinic/setup');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Primeros pasos');
  });

  it('el administrador ve qué pasos ya completó', async () => {
    const session = TestBed.inject(SessionService);
    session.user.update((u) => (u ? { ...u, role: 'ADMIN' } : u));
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    http
      .expectOne('/api/health')
      .flush({ status: 'ok', database: 'up', time: '2026-10-27T19:00:00Z' });
    http.expectOne('/api/clinic/setup').flush({ profileComplete: true, teamMembers: 0 });
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Primeros pasos');
    expect(text).toContain('1 de 4');
    expect(text).toContain('Hecho');
  });
});
