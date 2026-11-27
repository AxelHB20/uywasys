import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { HospitalizationDetail } from '../../core/services/hospitalization.models';
import { HospitalizationDetailPage, givenAtIso } from './detail.page';

const NOW = Date.now();
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function detail(overrides: Partial<HospitalizationDetail> = {}): HospitalizationDetail {
  return {
    id: 7,
    number: 3,
    code: 'HZ-00003',
    status: 'ACTIVE',
    voluntary: false,
    cage: null,
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
        bill: {
          careServiceId: null,
          productId: 5,
          presentationId: 9,
          description: 'Metronidazol 500 mg · Frasco',
          unitPrice: 8,
          alreadyCharged: 0,
        },
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
    prescriptions: 0,
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

  function render(role: 'VET' | 'RECEPTION' = 'VET', registrar?: string) {
    TestBed.configureTestingModule({
      imports: [HospitalizationDetailPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({ id: 3, fullName: 'Dra. Lucía Ruiz', role } as never);
    const fixture = TestBed.createComponent(HospitalizationDetailPage);
    fixture.componentRef.setInput('id', '7');
    if (registrar) fixture.componentRef.setInput('registrar', registrar);
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
    // La hora real en que se dio (por defecto, ahora)
    expect(Math.abs(new Date(req.request.body.givenAt).getTime() - Date.now())).toBeLessThan(
      2 * 60_000,
    );
    req.flush(detail());
  });

  it('desde el tablero (?registrar=1) abre directo la dosis atrasada', () => {
    const fixture = render('RECEPTION', '1');
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog[open]');
    expect(dialog?.textContent).toContain('Registrar dosis');
    expect(dialog?.textContent).toContain('Se dio a las');
  });

  it('suspender pide confirmación antes de enviar', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Suspender Metronidazol"]')!.click();
    fixture.detectChanges();
    http.expectNone('/api/hospitalizations/7/orders/11/stop');
    expect(el.querySelector('dialog[open]')?.textContent).toContain('¿Suspender Metronidazol?');
    [...el.querySelectorAll<HTMLButtonElement>('dialog[open] button')]
      .find((b) => b.textContent?.trim() === 'Suspender')!
      .click();
    http
      .expectOne({ method: 'POST', url: '/api/hospitalizations/7/orders/11/stop' })
      .flush(detail());
  });

  it('el alta obliga a elegir la estancia y cobra aparte lo dado en la hoja', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Dar de alta' && !b.closest('dialog'))!
      .click();
    http
      .expectOne((r) => r.url === '/api/care-services')
      .flush([{ id: 4, name: 'Hospitalización (día)', category: 'HOSPITALIZATION', price: 120 }]);
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Metronidazol 500 mg · Frasco');
    expect(dialog.textContent).toContain('Aún no tiene receta');
    const submit = el.querySelector<HTMLButtonElement>('button[form="discharge-form"]')!;
    submit.click();
    fixture.detectChanges();
    http.expectNone('/api/hospitalizations/7/discharge');
    expect(dialog.textContent).toContain('Elige si se cobra la estancia');

    el.querySelector<HTMLInputElement>(
      'input[name="stay"][value="none"], input[value="none"]',
    )!.click();
    fixture.detectChanges();
    submit.click();
    const req = http.expectOne({ method: 'POST', url: '/api/hospitalizations/7/discharge' });
    expect(req.request.body).toMatchObject({
      outcome: 'DISCHARGED',
      careServiceId: null,
      days: null,
      extras: [{ orderId: 11, quantity: 1 }],
    });
    req.flush(detail({ status: 'DISCHARGED' }));
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

describe('givenAtIso (hora real de la dosis)', () => {
  it('usa la hora de hoy en Lima y, si queda en el futuro, la de ayer', () => {
    const now = new Date('2026-11-27T05:30:00Z'); // 00:30 en Lima
    expect(givenAtIso('00:10', now)).toBe('2026-11-27T05:10:00.000Z');
    expect(givenAtIso('23:50', now)).toBe('2026-11-27T04:50:00.000Z');
    expect(givenAtIso('', now)).toBeUndefined();
  });
});
