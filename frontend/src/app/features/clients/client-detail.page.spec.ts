import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { ClientDetail } from '../../core/services/clients.models';
import { stubDialog, tick } from '../../shared/testing';
import { ClientDetailPage } from './client-detail.page';

const client: ClientDetail = {
  id: 7,
  number: 12,
  docType: 'DNI',
  docNumber: '45678912',
  name: 'Rosa Quispe',
  phone: '987654321',
  email: null,
  address: null,
  district: null,
  notes: null,
  active: true,
  consentAt: '2026-10-27T15:00:00Z',
  consentVersion: 'v1',
  consentChannel: 'FORM',
  marketingConsent: false,
  createdAt: '2026-10-27T15:00:00Z',
  authorized: [],
  pets: [
    {
      id: 3,
      number: 45,
      clientId: 7,
      name: 'Toby',
      species: 'DOG',
      breed: 'Mestizo',
      sex: 'MALE',
      neutered: false,
      birthDate: '2022-05-01',
      birthDateEstimated: true,
      weightKg: 12.5,
      color: null,
      microchip: null,
      allergies: 'Penicilina',
      aggressive: true,
      aggressiveNote: 'Bozal para uñas',
      notes: null,
      deceasedAt: null,
      active: true,
    },
  ],
};

describe('ClientDetailPage (ficha)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  function render(role: 'RECEPTION' | 'GROOMER') {
    TestBed.configureTestingModule({
      imports: [ClientDetailPage],
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
    const fixture = TestBed.createComponent(ClientDetailPage);
    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    http.expectOne('/api/clients/7').flush(client);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('muestra las alertas de la mascota con texto, no solo color', () => {
    const el: HTMLElement = render('RECEPTION').nativeElement;
    expect(el.textContent).toContain('Agresivo.');
    expect(el.textContent).toContain('Bozal para uñas');
    expect(el.textContent).toContain('Alergias: Penicilina');
    expect(el.querySelector('a[href="https://wa.me/51987654321"]')).not.toBeNull();
  });

  it('muestra los códigos correlativos de la clínica, no el id interno', () => {
    const el: HTMLElement = render('RECEPTION').nativeElement;
    expect(el.textContent).toContain('C-00012');
    expect(el.textContent).toContain('HC-00045');
    expect(el.textContent).not.toContain('C-00007');
  });

  it('el groomer consulta pero no ve botones para editar ni poner en cola', () => {
    const el: HTMLElement = render('GROOMER').nativeElement;
    expect(el.textContent).toContain('Toby');
    // Solo botones de la página (los de los modales cerrados no cuentan)
    const visible = [...el.querySelectorAll('button')]
      .filter((b) => !b.closest('dialog'))
      .map((b) => b.textContent?.trim());
    expect(visible.join('|')).not.toMatch(/Poner en cola|Editar datos|Agregar/);
  });

  it('pone a la mascota en la cola con motivo y urgencia', async () => {
    const fixture = render('RECEPTION');
    const el: HTMLElement = fixture.nativeElement;
    const queueButton = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Poner en cola'),
    )!;
    queueButton.click();
    fixture.detectChanges();
    await tick();
    const reason = el.querySelector<HTMLInputElement>('#q-reason')!;
    reason.value = 'Vómitos';
    reason.dispatchEvent(new Event('input'));
    el.querySelector<HTMLInputElement>('#queue-form input[type="checkbox"]')!.click();
    el.querySelector<HTMLButtonElement>('button[form="queue-form"]')!.click();
    const req = http.expectOne('/api/queue');
    expect(req.request.body).toEqual({ petId: 3, urgent: true, reason: 'Vómitos' });
    req.flush({});
  });
});
