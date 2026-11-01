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

  const summary = {
    day: '2026-10-27',
    queue: {
      arrived: 1,
      waiting: 0,
      inProgress: 1,
      urgent: 1,
      done: 3,
      items: [
        {
          id: 9,
          day: '2026-10-27',
          type: 'CONSULTATION',
          status: 'IN_PROGRESS',
          urgent: true,
          reason: 'Vómitos',
          arrivedAt: '2026-10-27T14:00:00Z',
          startedAt: '2026-10-27T14:10:00Z',
          finishedAt: null,
          pet: { id: 3, name: 'Mishi', species: 'CAT', aggressive: false, allergies: 'Pollo' },
          client: { id: 7, name: 'Rosa Quispe', phone: '987654321' },
          attendedBy: { id: 2, fullName: 'Luis' },
        },
      ],
    },
    clients: { active: 12, newThisMonth: 4 },
    pets: { active: 18 },
    inventory: { expiring: 0, lowStock: 0 },
    sales: { total: 0, receipts: 0 },
    recentClients: [
      {
        id: 7,
        name: 'Rosa Quispe',
        createdAt: '2026-10-27T14:00:00Z',
        pets: [{ name: 'Mishi', species: 'CAT' }],
      },
    ],
  };

  function render() {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    return fixture;
  }

  it('muestra cifras reales y la cola de hoy, sin avisos técnicos', async () => {
    const fixture = render();
    http.expectOne('/api/dashboard').flush(summary);
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    await fixture.whenStable();
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('12');
    expect(text).toContain('+4');
    expect(text).toContain('1 urgencia');
    expect(text).toContain('Mishi');
    expect(text).toContain('Vómitos');
    expect(text).not.toContain('Sistema en línea');
    expect(text).not.toContain('No hay conexión');
  });

  it('las ventas del día las ve quien maneja la caja, no el veterinario', async () => {
    const vet = render();
    http.expectOne('/api/dashboard').flush({ ...summary, sales: { total: 1250.5, receipts: 7 } });
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    await vet.whenStable();
    vet.detectChanges();
    expect(vet.nativeElement.textContent).not.toContain('Ventas de hoy');

    TestBed.inject(SessionService).user.update((u) => (u ? { ...u, role: 'CASHIER' } : u));
    vet.detectChanges();
    const text: string = vet.nativeElement.textContent;
    expect(text).toContain('Ventas de hoy');
    expect(text).toContain('S/ 1,250.50');
    expect(text).toContain('7 cobros');
  });

  it('avisa solo cuando no hay conexión con el servidor', async () => {
    const fixture = render();
    http.expectOne('/api/dashboard').flush(null, { status: 0, statusText: 'Unknown' });
    http.expectOne('/api/health').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay conexión con el servidor');
  });

  it('el veterinario no ve los primeros pasos de configuración', async () => {
    const fixture = render();
    http.expectOne('/api/dashboard').flush(summary);
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    http.expectNone('/api/clinic/setup');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Primeros pasos');
  });

  it('el administrador ve la guía mientras la clínica no esté lista', async () => {
    TestBed.inject(SessionService).user.update((u) => (u ? { ...u, role: 'ADMIN' } : u));
    const fixture = render();
    http.expectOne('/api/dashboard').flush(summary);
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    http.expectOne('/api/clinic/setup').flush({ profileComplete: true, teamMembers: 0 });
    await fixture.whenStable();
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Primeros pasos');
    expect(text).toContain('2 de 3');
  });
});

describe('greetingFor', () => {
  it('saluda según la hora de Lima', () => {
    expect(greetingFor(8)).toBe('Buenos días');
    expect(greetingFor(15)).toBe('Buenas tardes');
    expect(greetingFor(20)).toBe('Buenas noches');
  });
});
