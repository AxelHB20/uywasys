import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { HospitalizationDetail } from '../../core/services/hospitalization.models';
import { HospitalizationDetailPage } from './detail.page';

const NOW = Date.now();
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function detail(overrides: Partial<HospitalizationDetail> = {}): HospitalizationDetail {
  return {
    id: 7,
    number: 3,
    code: 'HZ-00003',
    status: 'ACTIVE',
    cage: 'J-1',
    homeDelivery: null,
    reason: 'Gastroenteritis',
    diagnosis: 'Gastroenteritis hemorrágica',
    admittedAt: at(-600),
    dischargedAt: null,
    days: 1,
    visitId: 40,
    pet: {
      id: 2,
      name: 'Boris',
      species: 'DOG',
      breed: null,
      weightKg: 6.2,
      allergies: 'Penicilina',
      aggressive: false,
    },
    client: { id: 1, name: 'Fernando Ramos', phone: '962721470' },
    vet: { id: 3, fullName: 'Dra. Lucía Ruiz' },
    activeOrders: 1,
    overdue: 1,
    due: 0,
    next: { at: at(180), description: 'Metronidazol' },
    lastVitals: {
      at: at(-60),
      temperatureC: 39.8,
      heartRate: 120,
      respiratoryRate: 24,
      weightKg: null,
      mucosa: 'Rosadas',
    },
    window: { from: at(-600), to: at(1440) },
    orders: [
      {
        id: 11,
        kind: 'MEDICATION',
        description: 'Metronidazol',
        dose: '15 mg/kg',
        route: 'IV',
        everyHours: 4,
        startsAt: at(-540),
        endsAt: null,
        stoppedAt: null,
        notes: null,
        active: true,
        createdBy: { id: 3, fullName: 'Dra. Lucía Ruiz' },
        slots: [
          { at: at(-540), state: 'GIVEN', doneAt: at(-530) },
          { at: at(-300), state: 'SKIPPED', doneAt: at(-290) },
          { at: at(-60), state: 'OVERDUE', doneAt: null },
          { at: at(180), state: 'PENDING', doneAt: null },
        ],
      },
    ],
    entries: [
      {
        id: 1,
        kind: 'NOTE',
        at: at(-100),
        order: null,
        scheduledAt: null,
        skipped: false,
        temperatureC: null,
        heartRate: null,
        respiratoryRate: null,
        weightKg: null,
        mucosa: null,
        notes: 'Más activo',
        by: { id: 3, fullName: 'Dra. Lucía Ruiz' },
      },
    ],
    vitals: [
      {
        at: at(-60),
        temperatureC: 39.8,
        heartRate: 120,
        respiratoryRate: 24,
        weightKg: null,
        mucosa: 'Rosadas',
      },
    ],
    account: { total: 180, pending: 180, lines: 2 },
    dischargeNotes: null,
    daysCharged: null,
    dischargedBy: null,
    ...overrides,
  };
}

describe('HospitalizationDetailPage (hoja de tratamiento)', () => {
  let http: HttpTestingController;
  // jsdom no implementa <dialog>
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => http?.verify());

  function render(role: 'VET' | 'RECEPTION' = 'VET') {
    TestBed.configureTestingModule({
      imports: [HospitalizationDetailPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({ id: 3, fullName: 'Dra. Lucía Ruiz', role } as never);
    const fixture = TestBed.createComponent(HospitalizationDetailPage);
    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    http.expectOne('/api/hospitalizations/7').flush(detail());
    fixture.detectChanges();
    return fixture;
  }

  it('muestra las horas con su estado en texto, la fiebre y las alergias', () => {
    const fixture = render();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Metronidazol');
    expect(text).toContain('Atrasada');
    expect(text).toContain('Omitida');
    expect(text).toContain('Alta'); // temperatura
    expect(text).toContain('Penicilina');
    expect(text).toContain('S/ 180.00 por cobrar');
    expect(text).toContain('Dar de alta');
  });

  it('registrar la dosis atrasada envía la hora programada', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const overdue = [...el.querySelectorAll<HTMLButtonElement>('[role=listitem] button')].find(
      (b) => b.textContent?.includes('Atrasada'),
    )!;
    overdue.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('button[form="dose-form"]')!.click();
    const req = http.expectOne({ method: 'POST', url: '/api/hospitalizations/7/entries' });
    expect(req.request.body).toMatchObject({ kind: 'DOSE', orderId: 11, skipped: false });
    expect(req.request.body.scheduledAt).toBe(detail().orders[0].slots[2].at);
    req.flush(detail());
  });

  it('recepción registra pero no indica ni da de alta', () => {
    const fixture = render('RECEPTION');
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .filter((b) => !b.closest('dialog'))
      .map((b) => b.textContent?.trim());
    expect(buttons).not.toContain('Nueva indicación');
    expect(buttons).not.toContain('Dar de alta');
    expect(buttons.some((t) => t?.includes('Registrar'))).toBe(true);
  });
});
