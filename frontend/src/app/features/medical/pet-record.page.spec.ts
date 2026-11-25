import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { PetRecordPage } from './pet-record.page';

describe('PetRecordPage', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const vaccine = (id: number, name: string, appliedAt: string, nextDueAt: string | null) => ({
    id,
    petId: 3,
    visitId: null,
    kind: 'VACCINE',
    name,
    laboratory: null,
    batchNumber: null,
    appliedAt,
    nextDueAt,
    external: false,
    externalClinic: null,
    notes: null,
    createdAt: `${appliedAt}T15:00:00Z`,
    voidedAt: null,
    voidReason: null,
    appliedBy: { id: 2, fullName: 'Dra. Ruiz', licenseNumber: '08451' },
  });

  function render(role: 'RECEPTION' | 'VET', opts: { next?: boolean; vaccines?: unknown[] } = {}) {
    TestBed.configureTestingModule({
      imports: [PetRecordPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role,
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(PetRecordPage);
    fixture.componentRef.setInput('id', '3');
    fixture.detectChanges();
    http.expectOne('/api/pets/3/immunization-card').flush({
      clinic: { name: 'Huellitas', address: null, phone: null, logoUrl: null },
      pet: {
        id: 3,
        number: 26,
        name: 'Firulais',
        species: 'DOG',
        breed: 'Yorkshire',
        sex: 'FEMALE',
        neutered: true,
        birthDate: null,
        birthDateEstimated: false,
        weightKg: 3.11,
        allergies: null,
        aggressive: false,
        aggressiveNote: null,
        deceasedAt: null,
        active: true,
        client: {
          id: 7,
          name: 'Yesenia Mendoza',
          phone: '945381778',
          address: null,
          district: null,
        },
      },
      items: [],
      nextAppointment: opts.next
        ? {
            id: 9,
            startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            type: 'CONSULTATION',
            reason: 'Control',
            vet: null,
          }
        : null,
    });
    http.expectOne('/api/pets/3/immunizations').flush(opts.vaccines ?? []);
    http.expectOne('/api/pets/3/grooming').flush([]);
    http.expectOne('/api/visits/pet/3/weights').flush([]);
    const visits = http.expectOne((r) => r.url === '/api/visits');
    // Solo las atenciones médicas: los baños tienen su sección
    expect(visits.request.params.get('type')).toBe('CONSULTATION');
    visits.flush({
      items: [
        {
          id: 21,
          type: 'HOSPITALIZATION',
          status: 'CLOSED',
          reason: 'Posoperatorio',
          diagnosis: 'Piometra',
          diagnosisDefinitive: false,
          weightKg: 3.11,
          openedAt: '2026-11-17T15:00:00Z',
          closedAt: null,
          queueEntryId: null,
          pet: { id: 3, number: 26, name: 'Firulais', species: 'DOG' },
          client: { id: 7, number: 12, name: 'Yesenia Mendoza' },
          attendedBy: { id: 2, fullName: 'Dra. Ruiz' },
          total: 0,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    fixture.detectChanges();
    http
      .match((r) => r.url.includes('/attachments') || r.url.includes('/consents'))
      .forEach((r) => r.flush([]));
    fixture.detectChanges();
    return fixture;
  }

  it('médico: dueño con enlace, Atender y el internamiento con su nombre', () => {
    const el: HTMLElement = render('VET', { next: true }).nativeElement;
    expect(el.querySelector('a[href="/clientes/7"]')?.textContent).toContain('Yesenia Mendoza');
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(buttons).toContain('Atender');
    expect(buttons).not.toContain('A la cola');
    expect(el.textContent).toContain('Internamiento');
    expect(el.textContent).toMatch(/Próxima cita:\s+\S+ \d+ \S+ · \d{2}:\d{2} · Control/);
  });

  it('recepción: A la cola; el ⋯ trae presupuesto, grooming y carnet', () => {
    const fixture = render('RECEPTION');
    const el: HTMLElement = fixture.nativeElement;
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(buttons).toContain('A la cola');
    expect(buttons).not.toContain('Atender');
    expect(el.textContent).not.toContain('Próxima cita');
    el.querySelector<HTMLButtonElement>('[aria-label="Más acciones"]')!.click();
    fixture.detectChanges();
    const menu = el.querySelector('[role="menu"]')!.textContent ?? '';
    expect(menu).toContain('Presupuesto');
    expect(menu).toContain('Ingreso a grooming');
    expect(menu).toContain('Imprimir carnet');
  });

  it('el carnet resume lo vencido o el próximo refuerzo (de la última dosis)', () => {
    const overdue = render('VET', {
      vaccines: [
        vaccine(1, 'Rabia', iso(-400), iso(-35)),
        vaccine(2, 'Rabia', iso(-30), iso(335)),
        vaccine(3, 'Triple', iso(-380), iso(-15)),
      ],
    }).nativeElement as HTMLElement;
    // Rabia ya se reforzó: solo Triple está vencida
    expect(overdue.textContent).toMatch(/Vencido:\s+Triple · desde/);
    expect(overdue.textContent).not.toMatch(/Rabia · desde/);
  });
});
