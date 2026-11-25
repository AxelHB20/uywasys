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
  invoiceRuc: null,
  invoiceName: null,
  invoiceAddress: null,
  invoiceEmail: null,
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

  const visit = (id: number, petId = 3, petName = 'Toby') => ({
    id,
    type: 'CONSULTATION',
    status: 'CLOSED',
    reason: `Control ${id}`,
    weightKg: null,
    openedAt: '2026-10-27T15:00:00Z',
    closedAt: '2026-10-27T15:20:00Z',
    queueEntryId: null,
    pet: { id: petId, number: 45, name: petName, species: 'DOG' },
    client: { id: 7, number: 12, name: 'Rosa Quispe' },
    attendedBy: { id: 2, fullName: 'Dra. Ruiz' },
    total: 60,
  });

  function render(
    role: 'RECEPTION' | 'GROOMER' | 'VET' | 'ADMIN',
    data: ClientDetail = client,
    extra: { visits?: unknown[]; inProgress?: { visitId: number; petName: string }[] } = {},
  ) {
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
      inProgress: extra.inProgress ?? [],
      receipts: [],
    });
    http
      .expectOne((r) => r.url === '/api/visits' && r.params.get('clientId') === '7')
      .flush({
        items: extra.visits ?? [
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
        total: extra.visits?.length ?? 1,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    // La tarjeta del portal consulta su estado (no la hay en una ficha anonimizada)
    for (const req of http.match('/api/clients/7/portal'))
      req.flush({
        active: false,
        createdAt: null,
        expiresAt: null,
        lastViewedAt: null,
        viewCount: 0,
        createdBy: null,
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

  const pet = (id: number, name: string, over: Partial<ClientDetail['pets'][number]> = {}) => ({
    ...client.pets[0],
    id,
    number: 40 + id,
    name,
    allergies: null,
    aggressive: false,
    aggressiveNote: null,
    ...over,
  });

  it('recepción agenda desde la mascota y el ⋯ trae ingreso a grooming y editar', () => {
    const fixture = render('RECEPTION');
    const el: HTMLElement = fixture.nativeElement;
    const schedule = [...el.querySelectorAll<HTMLAnchorElement>('a')].find(
      (a) => a.textContent?.trim() === 'Agendar',
    )!;
    expect(schedule.getAttribute('href')).toBe(
      '/citas?nueva=1&petId=3&mascota=Toby&cliente=Rosa%20Quispe',
    );
    el.querySelector<HTMLButtonElement>('[aria-label="Más acciones para Toby"]')!.click();
    fixture.detectChanges();
    const menu = el.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain('Ingreso a grooming');
    expect(menu.textContent).toContain('Editar mascota');
    expect(menu.querySelector('a[href="/grooming/ingreso?petId=3"]')).not.toBeNull();
    // Esc lo cierra
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('el veterinario ve Atender y agenda desde el ⋯', () => {
    const fixture = render('VET');
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Más acciones para Toby"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')?.textContent).toContain('Agendar cita');
  });

  it('muestra la próxima cita y avisa si una atención sigue abierta', () => {
    const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const el: HTMLElement = render(
      'RECEPTION',
      {
        ...client,
        pets: [
          {
            ...client.pets[0],
            nextAppointment: {
              id: 9,
              startsAt,
              type: 'CONSULTATION',
              reason: 'Control',
              vet: null,
            },
          },
        ],
      },
      { inProgress: [{ visitId: 21, petName: 'Toby' }] },
    ).nativeElement;
    expect(el.textContent).toContain('Próxima cita:');
    expect(el.textContent).toMatch(/Próxima cita:\s+\S+ \d+ · \d{2}:\d{2} · Control/);
    expect(el.textContent).toContain('Toby sigue en atención.');
  });

  it('desde 4 mascotas: buscar y filtrar, con las mismas tarjetas', () => {
    const fixture = render('RECEPTION', {
      ...client,
      pets: [
        pet(1, 'Manchas', { aggressive: true }),
        pet(2, 'Michina', { species: 'CAT' }),
        pet(3, 'Bobby'),
        pet(4, 'Luna', { allergies: 'Pollo' }),
      ],
    });
    const el: HTMLElement = fixture.nativeElement;
    const names = () => [...el.querySelectorAll('h3')].map((h) => h.textContent?.trim());
    expect(names()).toEqual(['Manchas', 'Michina', 'Bobby', 'Luna']);
    const search = el.querySelector<HTMLInputElement>('#pet-search')!;
    search.value = 'mich';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(names()).toEqual(['Michina']);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Con alerta'))!.click();
    fixture.detectChanges();
    expect(names()).toEqual(['Manchas', 'Luna']);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Gatos'))!.click();
    fixture.detectChanges();
    expect(names()).toEqual(['Michina']);
  });

  it('con 3 mascotas o menos no hay buscador', () => {
    const el: HTMLElement = render('RECEPTION').nativeElement;
    expect(el.querySelector('#pet-search')).toBeNull();
  });

  it('atenciones: las 5 últimas, "Ver las N" y filtro por mascota', () => {
    const visits = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      visit(n, n <= 5 ? 3 : 8, n <= 5 ? 'Toby' : 'Luna'),
    );
    const fixture = render('RECEPTION', client, { visits });
    const el: HTMLElement = fixture.nativeElement;
    const rows = () => el.querySelectorAll('a[href^="/atenciones/"]').length;
    expect(rows()).toBe(5);
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Ver las 7 atenciones'))!
      .click();
    fixture.detectChanges();
    expect(rows()).toBe(7);
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim().startsWith('Luna'))!
      .click();
    fixture.detectChanges();
    expect(rows()).toBe(2);
  });

  it('editar: la factura se agrega aparte y el RUC trae la razón social sin cambiar el nombre', async () => {
    const fixture = render('RECEPTION');
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => !b.closest('dialog') && b.textContent?.trim() === 'Editar')!
      .click();
    fixture.detectChanges();
    expect(el.querySelector('#e-invoice-ruc')).toBeNull();
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Agregar RUC para facturas'))!
      .click();
    fixture.detectChanges();
    const ruc = el.querySelector<HTMLInputElement>('#e-invoice-ruc')!;
    ruc.value = '20601234565';
    ruc.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    http
      .expectOne((r) => r.url === '/api/billing/lookup' && r.params.get('number') === '20601234565')
      .flush({
        name: 'ALBERGUE PATITAS S.A.C.',
        address: 'Jr. Arequipa 618',
        status: 'ACTIVO',
        condition: 'HABIDO',
        source: 'APISPERU',
      });
    fixture.detectChanges();
    expect(el.querySelector('#e-invoice-card')?.textContent).toContain('ALBERGUE PATITAS S.A.C.');
    expect(el.querySelector<HTMLInputElement>('#e-name')?.value ?? 'Rosa Quispe').toBe(
      'Rosa Quispe',
    );
    el.querySelector<HTMLButtonElement>('button[type="submit"][form="client-form"]')!.click();
    const req = http.expectOne('/api/clients/7');
    expect(req.request.body).toMatchObject({
      name: 'Rosa Quispe',
      invoiceRuc: '20601234565',
      invoiceName: 'ALBERGUE PATITAS S.A.C.',
      invoiceAddress: 'Jr. Arequipa 618',
    });
    req.flush(client);
  });
});
