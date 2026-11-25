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
    sales: { total: 0, collected: 0, refunded: 0, receipts: 0 },
    recentClients: [
      {
        id: 7,
        name: 'Rosa Quispe',
        createdAt: '2026-10-27T14:00:00Z',
        pets: [{ name: 'Mishi', species: 'CAT' }],
      },
    ],
  };

  // 21 días: S/ 100 por día, salvo hoy (S/ 40) y el mismo día de la semana anterior (S/ 90)
  const recent = Array.from({ length: 21 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10),
    collected: i === 20 ? 40 : i === 13 ? 90 : 100,
  }));
  const month = {
    recent,
    from: '2026-11-01',
    to: '2026-11-02',
    previous: { from: '2026-10-01', to: '2026-10-02' },
    kpis: {
      sold: 1500,
      pending: 300,
      collected: 1200,
      receipts: 12,
      averageTicket: 100,
      visits: 10,
      newClients: 2,
    },
    previousKpis: {
      sold: 1000,
      pending: 0,
      collected: 1000,
      receipts: 10,
      averageTicket: 100,
      visits: 9,
      newClients: 1,
    },
    days: [
      { day: '2026-11-01', collected: 500 },
      { day: '2026-11-02', collected: 700 },
    ],
    previousDays: [
      { day: '2026-10-01', collected: 400 },
      { day: '2026-10-02', collected: 600 },
      { day: '2026-10-03', collected: 300 },
    ],
  };

  const appointment = (id: number, startsAt: string, status: string, pet: string) => ({
    id,
    startsAt,
    durationMin: 30,
    type: 'CONSULTATION',
    reason: null,
    notes: null,
    status,
    cancelReason: null,
    queueEntryId: null,
    createdAt: startsAt,
    pet: { id: id + 100, number: 1, name: pet, species: 'DOG', aggressive: false },
    client: { id: 7, name: 'Rosa Quispe', phone: '987654321' },
    vet: { id: 2, fullName: 'Dra. Lucía Ruiz' },
    createdBy: { id: 1, fullName: 'Ana' },
  });

  const due = (id: number, name: string, daysLeft: number) => ({
    id,
    kind: 'VACCINE',
    name,
    appliedAt: '2025-10-30',
    nextDueAt: '2026-10-30',
    daysLeft,
    pet: { id: 3, number: 1, name: 'Mishi', species: 'CAT' },
    client: { id: 7, name: 'Rosa Quispe', phone: '987654321' },
  });

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
    http
      .expectOne('/api/dashboard')
      .flush({ ...summary, sales: { total: 1250.5, collected: 1250.5, refunded: 0, receipts: 7 } });
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    await vet.whenStable();
    vet.detectChanges();
    expect(vet.nativeElement.textContent).not.toContain('Cobrado hoy');

    TestBed.inject(SessionService).user.update((u) => (u ? { ...u, role: 'CASHIER' } : u));
    vet.detectChanges();
    const text: string = vet.nativeElement.textContent;
    expect(text).toContain('Cobrado hoy');
    expect(text).toContain('S/ 1,250.50');
    expect(text).toContain('7 cobros');
  });

  it('un día con solo devoluciones no muestra un cobrado negativo', async () => {
    const page = render();
    http.expectOne('/api/dashboard').flush({
      ...summary,
      sales: { total: -45, collected: 0, refunded: 45, receipts: 0 },
    });
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    await page.whenStable();
    TestBed.inject(SessionService).user.update((u) => (u ? { ...u, role: 'CASHIER' } : u));
    page.detectChanges();
    const text: string = page.nativeElement.textContent;
    expect(text).toContain('S/ 0.00');
    expect(text).toContain('S/ 45.00 devuelto');
    expect(text).not.toContain('-45');
  });

  it('el cobrado del mes y su gráfico son solo del administrador', async () => {
    for (const role of ['VET', 'RECEPTION', 'CASHIER', 'GROOMER'] as const) {
      TestBed.inject(SessionService).user.update((u) => (u ? { ...u, role } : u));
      const fixture = render();
      http.expectOne('/api/dashboard').flush(summary);
      http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
      http.expectNone('/api/reports/month');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Cobrado en');
      http.verify();
    }
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
    http.expectOne('/api/reports/month').flush(month);
    await fixture.whenStable();
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Primeros pasos');
    expect(text).toContain('2 de 3');
  });

  it('el administrador ve lo cobrado en el mes contra el mes anterior al mismo día', async () => {
    TestBed.inject(SessionService).user.update((u) => (u ? { ...u, role: 'ADMIN' } : u));
    const fixture = render();
    http.expectOne('/api/dashboard').flush(summary);
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    http.expectOne('/api/clinic/setup').flush({ profileComplete: true, teamMembers: 2 });
    http.expectOne('/api/reports/month').flush(month);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Cobrado en noviembre');
    expect(el.textContent).toContain('S/ 1,200.00');
    expect(el.textContent).toContain('Sube 20 %');
    expect(el.textContent).toContain('frente al 1–2 oct');
    // Barras de las últimas 2 semanas; el promedio no cuenta hoy (va en curso)
    expect(el.querySelector('app-daily-bars svg[role="img"]')?.getAttribute('aria-label')).toBe(
      'Cobrado por día, últimos 14 días: S/ 1,330.00 en total, promedio diario S/ 99.23.',
    );
    // Hoy frente al mismo día de la semana anterior, sin porcentaje (hoy aún no termina)
    expect(el.textContent).toContain('pasado: S/ 90.00');
  });

  it('el veterinario no consulta lo cobrado en el mes', async () => {
    const fixture = render();
    http.expectOne('/api/dashboard').flush(summary);
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    http.expectNone('/api/reports/month');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Cobrado en');
  });

  it('citas de hoy, refuerzos con WhatsApp y avisos de la campana', async () => {
    const fixture = render();
    http.expectOne('/api/dashboard').flush({
      ...summary,
      appointments: {
        total: 2,
        pending: 1,
        arrived: 1,
        noShow: 0,
        items: [
          appointment(21, '2026-10-27T13:00:00Z', 'ARRIVED', 'Toby'),
          appointment(22, '2099-10-27T21:30:00Z', 'CONFIRMED', 'Luna'),
        ],
      },
      reminders: {
        upcoming: 1,
        overdue: 1,
        items: [due(31, 'Séxtuple', 3), due(32, 'Antirrábica', -10)],
      },
      alerts: [
        { kind: 'urgent', count: 1, link: '/cola' },
        { kind: 'lowStock', count: 2, link: '/inventario', query: { filtro: 'low' } },
      ],
    });
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!;
    expect(text).toContain('1 por llegar · 1 llegó');
    expect(text).toContain('08:00'); // 13:00 UTC en Lima
    expect(text).toContain('Llegó');
    expect(text).toContain('Próxima'); // Luna aún no llega
    expect(text).toContain('1 esta semana');
    expect(text).toContain('1 vencido');
    expect(text).toContain('En 3 días');
    expect(text).toContain('Vencida hace 10 días');
    const whatsapp = el.querySelector<HTMLAnchorElement>(
      'a[aria-label^="Recordar por WhatsApp a Rosa Quispe (En 3 días)"]',
    )!;
    expect(whatsapp.href).toContain('https://wa.me/51987654321?text=');
    expect(decodeURIComponent(whatsapp.href)).toContain('la vacuna Séxtuple');
    expect(text).toContain('1 urgencia en la cola');
    expect(text).toContain('2 productos con stock bajo');
  });

  it('sin refuerzos para quien no llama a los dueños (caja)', async () => {
    TestBed.inject(SessionService).user.update((u) => (u ? { ...u, role: 'CASHIER' } : u));
    const fixture = render();
    http.expectOne('/api/dashboard').flush({
      ...summary,
      appointments: { total: 0, pending: 0, arrived: 0, noShow: 0, items: [] },
      reminders: null,
      alerts: [],
    });
    http.expectOne('/api/health').flush({ status: 'ok', time: '2026-10-27T15:00:00Z' });
    await fixture.whenStable();
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('No hay citas para hoy');
    expect(text).not.toContain('Refuerzos que tocan');
    expect(text).not.toContain('Avisos');
  });
});

describe('greetingFor', () => {
  it('saluda según la hora de Lima', () => {
    expect(greetingFor(8)).toBe('Buenos días');
    expect(greetingFor(15)).toBe('Buenas tardes');
    expect(greetingFor(20)).toBe('Buenas noches');
  });
});
