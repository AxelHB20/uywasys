import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
  anonymizedAt: null,
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

  function render(role: 'RECEPTION' | 'GROOMER' | 'VET' | 'ADMIN', data: ClientDetail = client) {
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
    http.expectOne('/api/clients/7').flush(data);
    http.expectOne('/api/clients/7/account').flush({
      client: {
        id: 7,
        number: 12,
        name: 'Rosa Quispe',
        phone: '987654321',
        docType: 'DNI',
        docNumber: '45678912',
      },
      pending: [
        {
          id: 1,
          description: 'Vacunación séxtuple',
          pet: { id: 3, name: 'Toby' },
          total: 60,
          paidAmount: 20,
          balance: 40,
          status: 'PENDING',
        },
      ],
      pendingTotal: 40,
      receipts: [],
    });
    http
      .expectOne((r) => r.url === '/api/visits' && r.params.get('clientId') === '7')
      .flush({
        items: [
          {
            id: 21,
            type: 'CONSULTATION',
            status: 'CLOSED',
            reason: 'Vacuna anual',
            weightKg: 12.4,
            openedAt: '2026-10-27T15:00:00Z',
            closedAt: '2026-10-27T15:20:00Z',
            queueEntryId: null,
            pet: { id: 3, number: 45, name: 'Toby', species: 'DOG' },
            client: { id: 7, number: 12, name: 'Rosa Quispe' },
            attendedBy: { id: 2, fullName: 'Dra. Ruiz' },
            total: 60,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
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

  it('muestra lo que debe y el historial de atenciones', () => {
    const el: HTMLElement = render('RECEPTION').nativeElement;
    expect(el.textContent).toContain('S/ 40.00');
    expect(el.textContent).toContain('por cobrar');
    const visit = el.querySelector<HTMLAnchorElement>('a[href="/atenciones/21"]');
    expect(visit?.textContent).toContain('Vacuna anual');
    expect(visit?.textContent).toContain('12.4 kg');
  });

  it('"Atender" abre la atención sin pasar por la cola', () => {
    const fixture = render('VET');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Atender')!.click();
    const req = http.expectOne('/api/visits');
    expect(req.request.body).toEqual({ petId: 3 });
    req.flush({ id: 30 });
    expect(navigate).toHaveBeenCalledWith(['/atenciones', 30]);
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
    const queueButton = [...el.querySelectorAll('button')].find(
      (b) => !b.closest('dialog') && b.textContent?.includes('A la cola'),
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

  it('derechos ARCO: solo el administrador descarga o borra los datos, con motivo y confirmación', async () => {
    const reception = render('RECEPTION').nativeElement as HTMLElement;
    expect(reception.textContent).not.toContain('Descargar sus datos');
    TestBed.resetTestingModule();

    const fixture = render('ADMIN');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('texto v1');
    const outside = (text: string) =>
      [...el.querySelectorAll('button')].find(
        (b) => !b.closest('dialog') && b.textContent?.trim() === text,
      )!;

    outside('Descargar sus datos').click();
    http.expectOne('/api/clients/7/export').flush(new Blob(['{}'], { type: 'application/json' }));

    outside('Borrar sus datos').click();
    fixture.detectChanges();
    await tick();
    const dialog = () => el.querySelector('dialog[open]')!;
    const confirm = () =>
      [...dialog().querySelectorAll('button')].find((b) => b.textContent?.includes('Borrar'))!;
    const reason = el.querySelector<HTMLInputElement>('#anon-reason')!;
    reason.value = 'Lo pidió por escrito';
    reason.dispatchEvent(new Event('input'));
    confirm().click();
    fixture.detectChanges();
    // Sin marcar "no se puede deshacer" no se envía
    http.expectNone('/api/clients/7/anonymize');
    expect(el.textContent).toContain('Marca la casilla para confirmar');

    dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    confirm().click();
    const req = http.expectOne('/api/clients/7/anonymize');
    expect(req.request.body).toEqual({ reason: 'Lo pidió por escrito' });
    req.flush({ ...client, name: 'Cliente anonimizado', anonymizedAt: '2026-10-28T21:00:00Z' });
    // Recarga la ficha ya anonimizada
    http.expectOne('/api/clients/7').flush({ ...client, anonymizedAt: '2026-10-28T21:00:00Z' });
    http.expectOne('/api/clients/7/account').flush({
      client: { ...client },
      pending: [],
      pendingTotal: 0,
      receipts: [],
    });
    http
      .expectOne((r) => r.url === '/api/visits')
      .flush({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('una ficha anonimizada no muestra contacto ni permite editar', () => {
    const el: HTMLElement = render('ADMIN', {
      ...client,
      name: 'Cliente anonimizado',
      docType: null,
      docNumber: null,
      phone: '000000000',
      active: false,
      anonymizedAt: '2026-10-28T21:00:00Z',
      pets: client.pets.map((p) => ({ ...p, active: false })),
    }).nativeElement;
    expect(el.textContent).toContain('Datos personales borrados el 28/10/2026');
    expect(el.textContent).not.toContain('000 000 000');
    expect(el.textContent).not.toContain('WhatsApp');
    expect(el.textContent).not.toContain('Descargar sus datos');
    const labels = [...el.querySelectorAll('button')]
      .filter((b) => !b.closest('dialog'))
      .map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Editar');
  });
});
