import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { Appointment, limaIso } from '../../core/services/appointments.models';
import { limaToday } from '../../shared/utils/dates';
import { stubDialog, tick } from '../../shared/testing';
import { AgendaPage } from './agenda.page';

const today = limaToday();
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 1,
  startsAt: limaIso(today, '10:00'),
  durationMin: 30,
  type: 'CONSULTATION',
  reason: 'Control',
  notes: null,
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

describe('AgendaPage (citas)', () => {
  let http: HttpTestingController;
  beforeAll(() => stubDialog());

  async function render(items: Appointment[], role = 'RECEPTION') {
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
    http
      .expectOne('/api/appointments/staff')
      .flush([{ id: 2, fullName: 'Dra. Lucía', role: 'VET' }]);
    http.expectOne((r) => r.url === '/api/appointments').flush(items);
    await tick();
    fixture.detectChanges();
    return fixture;
  }

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
    expect(el.textContent).toContain('1 llegaron');
  });

  it('caja ve la agenda pero no agenda', async () => {
    const el: HTMLElement = (await render([], 'CASHIER')).nativeElement;
    const buttons = [...el.querySelectorAll('button')].filter((b) => !b.closest('dialog'));
    expect(buttons.some((b) => b.textContent?.includes('Nueva cita'))).toBe(false);
  });
});
