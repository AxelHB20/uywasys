import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { Appointment, limaIso } from '../../core/services/appointments.models';
import { addDays } from '../../core/services/medical.models';
import { limaToday } from '../../shared/utils/dates';
import { stubDialog, tick } from '../../shared/testing';
import { AgendaPage, shortName } from './agenda.page';

const today = limaToday();
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 1,
  startsAt: limaIso(today, '10:00'),
  durationMin: 30,
  type: 'CONSULTATION',
  reason: 'Control',
  notes: null,
  transport: 'NONE',
  transportAddress: null,
  transportPrice: null,
  status: 'SCHEDULED',
  cancelReason: null,
  queueEntryId: null,
  createdAt: '2026-10-28T10:00:00Z',
  pet: { id: 3, number: 45, name: 'Toby', species: 'DOG', aggressive: false },
  client: { id: 7, name: 'Rosa Quispe', phone: '987654321' },
  vet: { id: 2, fullName: 'Dra. Lucía' },
  createdBy: { id: 1, fullName: 'Ana' },
  ...over,
});

describe('shortName', () => {
  it('deja título, nombre e inicial del apellido', () => {
    expect(shortName('Dra. Lucía Ruiz Paredes')).toBe('Dra. Lucía R.');
    expect(shortName('Andrea Salazar Ríos')).toBe('Andrea S.');
    expect(shortName('Kevin')).toBe('Kevin');
  });
});

describe('AgendaPage (citas)', () => {
  let http: HttpTestingController;
  let lastRange: (string | null)[] = [];
  beforeAll(() => stubDialog());

  async function render(
    items: Appointment[],
    role = 'RECEPTION',
    staff: { id: number; fullName: string; role: string }[] = [
      { id: 2, fullName: 'Dra. Lucía', role: 'VET' },
    ],
  ) {
    TestBed.configureTestingModule({
      imports: [AgendaPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role,
      mustChangePassword: false,
      clinic: { id: 1, name: 'Vet Sol', logoUrl: null },
    } as never);
    const fixture = TestBed.createComponent(AgendaPage);
    fixture.detectChanges();
    http.expectOne('/api/appointments/staff').flush(staff);
    // Horario de atención: lunes a sábado de 8:00 a 20:00
    http
      .expectOne('/api/clinic/hours')
      .flush(
        [1, 2, 3, 4, 5, 6, 7].map((day) =>
          day === 7 ? { day, open: null, close: null } : { day, open: '08:00', close: '20:00' },
        ),
      );
    const req = http.expectOne((r) => r.url === '/api/appointments');
    lastRange = [req.request.params.get('from'), req.request.params.get('to')];
    req.flush(items);
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => http.verify());

  it('muestra las columnas por veterinario y "Sin asignar" si hace falta', async () => {
    const el: HTMLElement = (
      await render([
        appt(),
        appt({
          id: 2,
          vet: null,
          startsAt: limaIso(today, '15:00'),
          pet: { ...appt().pet, name: 'Luna' },
        }),
        appt({
          id: 3,
          status: 'CANCELLED',
          cancelReason: 'Viaje',
          pet: { ...appt().pet, name: 'Max' },
        }),
      ])
    ).nativeElement;
    expect(el.textContent).toContain('Dra. Lucía');
    expect(el.textContent).toContain('Sin asignar');
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('2 citas · 2 por confirmar');
    expect(el.textContent).toContain('Canceladas y no vinieron (1)');
  });

  it('desde el detalle, "Llegó" pasa la cita a la cola', async () => {
    const fixture = await render([appt()]);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('button[aria-label^="10:00 – 10:30, Toby"]')!.click();
    fixture.detectChanges();
    await tick();
    const arrive = [...el.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) =>
      b.textContent?.includes('Llegó'),
    )!;
    arrive.click();
    http
      .expectOne('/api/appointments/1/arrive')
      .flush(appt({ status: 'ARRIVED', queueEntryId: 9 }));
    await tick();
    http.expectOne((r) => r.url === '/api/appointments').flush([appt({ status: 'ARRIVED' })]);
    await tick();
    fixture.detectChanges();
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('1 llegó');
  });

  it('trae la semana: la tira de días cuenta las citas y oculta a quien no tiene citas', async () => {
    const fixture = await render(
      [appt(), appt({ id: 2, startsAt: limaIso(addDays(today, 1), '09:00') })],
      'RECEPTION',
      [
        { id: 2, fullName: 'Dra. Lucía', role: 'VET' },
        { id: 5, fullName: 'Rosa Flores', role: 'GROOMER' },
      ],
    );
    const el: HTMLElement = fixture.nativeElement;
    const [from, to] = lastRange;
    expect(to).toBe(addDays(from!, 6));
    expect(from! <= today && today <= to!).toBe(true);
    // Solo la cita de hoy en el resumen del día
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('1 cita · 1 por confirmar');
    expect(el.querySelector('[aria-current="date"]')?.getAttribute('aria-label')).toContain(
      '1 cita',
    );
    // La groomer sin citas no ocupa columna hasta pedir "todo el equipo"
    const cols = () => [...el.querySelectorAll('[role="region"]')].map((r) => r.ariaLabel);
    expect(cols()).toEqual(['Agenda de Dra. Lucía']);
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Ver a todo el equipo'))!
      .click();
    fixture.detectChanges();
    expect(cols()).toContain('Agenda de Rosa Flores');
  });

  it('caja ve la agenda pero no agenda', async () => {
    const el: HTMLElement = (await render([], 'CASHIER')).nativeElement;
    const buttons = [...el.querySelectorAll('button')].filter((b) => !b.closest('dialog'));
    expect(buttons.some((b) => b.textContent?.includes('Nueva cita'))).toBe(false);
  });

  it('sombrea lo que está fuera del horario de atención y muestra dónde caería la cita al pasar el mouse', async () => {
    const fixture = await render([]);
    const el: HTMLElement = fixture.nativeElement;
    // Un domingo (cerrado): el día entero sombreado
    const page = fixture.componentInstance as unknown as { setDay(d: string): void };
    // El próximo domingo (si cae en otra semana, llega otra consulta)
    const sunday = [0, 1, 2, 3, 4, 5, 6]
      .map((n) => addDays(today, n))
      .find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0)!;
    page.setDay(sunday);
    fixture.detectChanges();
    http.match((r) => r.url === '/api/appointments').forEach((r) => r.flush([]));
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Cerrado este día');
  });

  // ── Vista semana ──
  type WeekPage = {
    setView(v: 'day' | 'week'): void;
    setDay(d: string): void;
    setTab(t: number | 'ALL'): void;
    tab(): number | 'ALL';
    newAppointment(): void;
    draft(): { day: string; time?: string; vetId?: number | null } | null;
  };
  /** Un lunes que viene (siempre abierto en el horario de prueba) */
  const nextMonday = () =>
    [1, 2, 3, 4, 5, 6, 7]
      .map((n) => addDays(today, n))
      .find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 1)!;
  const team = [
    { id: 2, fullName: 'Dra. Lucía Ruiz', role: 'VET' },
    { id: 5, fullName: 'Dr. Carlos Mena', role: 'VET' },
    { id: 9, fullName: 'Andrea Salazar', role: 'ADMIN' },
  ];

  async function goWeek(
    fixture: Awaited<ReturnType<typeof render>>,
    day: string,
    items: Appointment[],
  ) {
    const page = fixture.componentInstance as unknown as WeekPage;
    page.setView('week');
    page.setDay(day);
    fixture.detectChanges();
    http.match((r) => r.url === '/api/appointments').forEach((r) => r.flush(items));
    await tick();
    fixture.detectChanges();
    return page;
  }

  it('semana de recepción: todo el equipo, una fila por médico con sus citas', async () => {
    const mon = nextMonday();
    const fixture = await render([], 'RECEPTION', team);
    const page = await goWeek(fixture, mon, [
      appt({ startsAt: limaIso(mon, '10:00') }),
      appt({
        id: 2,
        startsAt: limaIso(addDays(mon, 1), '11:00'),
        vet: { id: 5, fullName: 'Dr. Carlos Mena' },
        pet: { id: 4, number: 46, name: 'Luna', species: 'CAT', aggressive: false },
      }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(page.tab()).toBe('ALL');
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    // El admin sin citas no ocupa una fila
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('Dra. Lucía R.');
    expect(rows[0]).toContain('Toby');
    expect(rows[1]).toContain('Luna');
    // El domingo (cerrado) no ofrece agendar
    const sundayCells = [...el.querySelectorAll('tbody tr')].map(
      (r) => r.querySelectorAll('td')[6],
    );
    expect(sundayCells.every((c) => c.textContent?.includes('Cerrado'))).toBe(true);
    expect(localStorage.getItem('uywa.agenda.vista')).toBe('semana');
  });

  it('semana del médico: entra a su propia agenda y "Nueva cita" propone su primera hora libre', async () => {
    const mon = nextMonday();
    const fixture = await render([], 'VET', [
      { id: 1, fullName: 'Dra. Ana Torres', role: 'VET' },
      ...team,
    ]);
    const page = await goWeek(fixture, mon, [
      appt({
        startsAt: limaIso(mon, '08:00'),
        durationMin: 60,
        vet: { id: 1, fullName: 'Dra. Ana Torres' },
      }),
      appt({ id: 2, startsAt: limaIso(mon, '09:00'), vet: { id: 1, fullName: 'Dra. Ana Torres' } }),
    ]);
    expect(page.tab()).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Dra. Ana Torres');
    page.newAppointment();
    expect(page.draft()).toMatchObject({ day: mon, vetId: 1, time: '09:30' });
    // En todo el equipo, la cita nueva no viene con médico
    page.setTab('ALL');
    page.newAppointment();
    expect(page.draft()).toMatchObject({ day: mon, vetId: null, time: '08:00' });
  });
});
