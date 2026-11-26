import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { QueueItem } from '../../core/services/queue.service';
import { stubDialog, tick } from '../../shared/testing';
import { QueuePage } from './queue.page';

function item(id: number, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    day: '2026-10-27',
    type: 'CONSULTATION',
    status: 'ARRIVED',
    urgent: false,
    reason: null,
    arrivedAt: `2026-10-27T14:0${id}:00Z`,
    startedAt: null,
    finishedAt: null,
    pet: {
      id: id * 10,
      number: id,
      name: `Mascota ${id}`,
      species: 'DOG',
      aggressive: false,
      allergies: null,
    },
    client: { id: id * 100, number: id, name: `Cliente ${id}`, phone: '987654321' },
    attendedBy: null,
    visit: null,
    transport: 'NONE',
    transportAddress: null,
    transportPrice: null,
    deliveredHomeAt: null,
    deliveredHomeBy: null,
    homePending: false,
    hospitalized: false,
    ...overrides,
  };
}

describe('QueuePage (cola de hoy)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  function render(role: 'RECEPTION' | 'GROOMER' | 'VET', items: QueueItem[]) {
    TestBed.configureTestingModule({
      imports: [QueuePage],
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
    const fixture = TestBed.createComponent(QueuePage);
    fixture.detectChanges();
    http.expectOne('/api/queue').flush({ day: '2026-10-27', items });
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('ordena cada columna con las urgencias primero', () => {
    const fixture = render('RECEPTION', [
      item(1),
      item(2, { urgent: true }),
      item(3, {
        status: 'IN_PROGRESS',
        startedAt: '2026-10-27T14:10:00Z',
        attendedBy: { id: 2, fullName: 'Dra. Ruiz' },
      }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const arrived = el.querySelector('[aria-labelledby="col-ARRIVED"]')!;
    const names = [...arrived.querySelectorAll('article')].map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual(['Mascota 2, urgente', 'Mascota 1']);
    expect(el.querySelector('[aria-labelledby="col-IN_PROGRESS"]')!.textContent).toContain(
      'Atiende Dra. Ruiz',
    );
  });

  it('recepción no abre consultas: pone en espera y lo llama el veterinario', () => {
    const fixture = render('RECEPTION', [item(1)]);
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map(
      (b) => b.textContent?.trim(),
    );
    expect(buttons).not.toContain('Atender');
    expect(buttons).toContain('Pasar a espera');
  });

  it('"Atender" abre la atención y lleva a su pantalla', () => {
    const fixture = render('VET', [item(1)]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Atender')!.click();
    const req = http.expectOne('/api/visits');
    expect(req.request.body).toEqual({ petId: 10, queueEntryId: 1 });
    req.flush({ id: 55 });
    expect(navigate).toHaveBeenCalledWith(['/atenciones', 55]);
  });

  it('si ya tenía una atención abierta, lleva a esa', () => {
    const fixture = render('VET', [item(1)]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Atender')!.click();
    http
      .expectOne('/api/visits')
      .flush(
        { message: 'Mascota 1 ya tiene una atención abierta', details: { visitId: 9 } },
        { status: 409, statusText: 'Conflict' },
      );
    expect(navigate).toHaveBeenCalledWith(['/atenciones', 9]);
  });

  it('en atención con una atención abierta: "Continuar atención" y no se mueve por fuera', () => {
    const fixture = render('VET', [
      item(1, {
        status: 'IN_PROGRESS',
        startedAt: '2026-10-27T14:10:00Z',
        visit: { id: 7, status: 'OPEN' },
      }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector<HTMLAnchorElement>('a[href="/atenciones/7"]');
    expect(link?.textContent?.replace(/\s+/g, ' ')).toContain('Continuar atención');
    const labels = [...el.querySelectorAll('article button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Terminar');
  });

  it('recepción ve quién atiende la consulta, sin un botón que no puede usar', () => {
    const el: HTMLElement = render('RECEPTION', [
      item(1, {
        status: 'IN_PROGRESS',
        startedAt: '2026-10-27T14:10:00Z',
        attendedBy: { id: 2, fullName: 'Dra. Ruiz' },
        visit: { id: 7, status: 'OPEN' },
      }),
    ]).nativeElement;
    expect(el.querySelector('a[href="/atenciones/7"]')).toBeNull();
    expect(el.querySelector('[aria-labelledby="col-IN_PROGRESS"]')!.textContent).toContain(
      'Con Dra. Ruiz',
    );
  });

  it('abierta hace más de 2 horas: se avisa en ámbar', () => {
    const el: HTMLElement = render('VET', [
      item(1, {
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      }),
      item(2, {
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      }),
    ]).nativeElement;
    const text = el.querySelector('[aria-labelledby="col-IN_PROGRESS"]')!.textContent!;
    expect(text).toContain('Abierta hace 3 h');
    expect(text).toContain('En atención hace 20 min');
  });

  it('urgente, movilidad y sacar de la cola van en el menú ⋯', () => {
    const fixture = render('VET', [item(1)]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[aria-label="Sacar a Mascota 1 de la cola"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[aria-label="Más acciones para Mascota 1"]')!.click();
    fixture.detectChanges();
    const items = [...el.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim());
    expect(items).toEqual(['Marcar urgente', 'Movilidad (recojo o entrega)', 'Sacar de la cola…']);
    (el.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/queue/1' && r.method === 'PATCH').flush({});
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('el groomer ve la cola pero sin botones de acción', () => {
    const el: HTMLElement = render('GROOMER', [item(1)]).nativeElement;
    expect(el.textContent).toContain('Mascota 1');
    const buttons = [...el.querySelectorAll('button')].filter((b) => !b.closest('dialog'));
    expect(buttons.map((b) => b.textContent?.trim()).join('|')).not.toMatch(
      /Atender|Agregar a la cola/,
    );
  });

  it('consulta con entrega: "por llevar a casa" y se marca entregado', () => {
    const fixture = render('RECEPTION', [
      item(1, {
        status: 'DONE',
        finishedAt: '2026-10-27T15:00:00Z',
        transport: 'ROUND_TRIP',
        transportAddress: 'Av. Lima 123',
        transportPrice: 20,
        homePending: true,
      }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('1 por llevar a casa');
    expect(el.textContent).toContain('Falta llevarlo a casa');
    expect(el.textContent!.replace(/\s+/g, ' ')).toContain(
      'Recojo y entrega · S/ 20.00 · Av. Lima 123',
    );
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Entregado en casa')!
      .click();
    http.expectOne({ method: 'POST', url: '/api/queue/1/delivered-home' }).flush(
      item(1, {
        status: 'DONE',
        finishedAt: '2026-10-27T15:00:00Z',
        transport: 'ROUND_TRIP',
        transportPrice: 20,
        deliveredHomeAt: '2026-10-27T16:00:00Z',
        deliveredHomeBy: { id: 1, fullName: 'Ana' },
      }),
    );
    fixture.detectChanges();
    expect(el.textContent).not.toContain('por llevar a casa');
    expect(el.textContent).toContain('Entregado en casa');
    expect(el.textContent).toContain('por Ana');
  });

  it('terminados sin movilidad: sin botón "Llevar a casa" (la lista queda simple)', () => {
    const el: HTMLElement = render('RECEPTION', [
      item(1, { status: 'DONE', finishedAt: '2026-10-27T15:00:00Z' }),
    ]).nativeElement;
    expect(el.querySelector('[aria-label="Llevar a Mascota 1 a su casa"]')).toBeNull();
    expect(el.textContent).not.toContain('Llevar a casa');
  });

  it('sacar de la cola con movilidad: pregunta si se cobra igual', () => {
    const fixture = render('RECEPTION', [
      item(1, { transport: 'PICKUP', transportAddress: 'Av. Lima 123', transportPrice: 10 }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Lo recogemos · S/ 10.00');
    el.querySelector<HTMLButtonElement>('[aria-label="Más acciones para Mascota 1"]')!.click();
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((b) => b.textContent?.includes('Sacar de la cola'))!
      .click();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Cobrar la movilidad igual');
    dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Sacar de la cola')!
      .click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/queue/1' });
    expect(req.request.body).toEqual({ status: 'CANCELLED', chargeTransport: true });
    req.flush(item(1, { status: 'CANCELLED' }));
  });

  it('agrega a la cola buscando al cliente y eligiendo la mascota', async () => {
    const fixture = render('RECEPTION', [item(1)]);
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Agregar a la cola'))!
      .click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#aq-search')!;
    input.value = 'rosa';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    http
      .expectOne((r) => r.url === '/api/clients' && r.params.get('q') === 'rosa')
      .flush({
        items: [
          {
            id: 7,
            name: 'Rosa Quispe',
            docType: 'DNI',
            docNumber: '45678912',
            phone: '987654321',
            active: true,
            lastVisit: null,
            pets: [
              {
                id: 10,
                name: 'Mascota 1',
                species: 'DOG',
                aggressive: false,
                hasAllergies: false,
                active: true,
              },
              {
                id: 33,
                name: 'Luna',
                species: 'CAT',
                aggressive: false,
                hasAllergies: false,
                active: true,
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    const petButtons = [...el.querySelectorAll<HTMLButtonElement>('dialog button')];
    // La que ya está en la cola no se puede elegir
    expect(petButtons.find((b) => b.textContent?.includes('Mascota 1'))!.disabled).toBe(true);
    petButtons.find((b) => b.textContent?.includes('Luna'))!.click();
    fixture.detectChanges();
    // Para la movilidad: dirección del dueño y el último precio
    http.expectOne('/api/clients/7').flush({ id: 7, address: 'Av. Lima 123', district: 'Chosica' });
    http.expectOne('/api/clients/7/transport-price').flush({ price: 15 });
    await tick();
    fixture.detectChanges();
    // Recojo y entrega: propone la dirección y el último precio
    [...el.querySelectorAll<HTMLButtonElement>('dialog [role="radio"]')]
      .find((b) => b.textContent?.includes('Recojo y entrega'))!
      .click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#aq-address')!.value).toBe('Av. Lima 123, Chosica');
    expect(el.querySelector<HTMLInputElement>('#aq-price')!.value).toBe('15');
    expect(el.textContent).toContain('Última vez: S/ 15.00');
    // Un cero de más no pasa
    const price = el.querySelector<HTMLInputElement>('#aq-price')!;
    price.value = '1200';
    price.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[form="add-queue-form"]')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Hasta S/ 500.00');
    price.value = '18';
    price.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[form="add-queue-form"]')!.click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/queue');
    expect(req.request.body).toEqual({
      petId: 33,
      urgent: false,
      reason: null,
      transport: 'ROUND_TRIP',
      transportAddress: 'Av. Lima 123, Chosica',
      transportPrice: 18,
    });
    req.flush(
      item(4, {
        pet: {
          id: 33,
          number: 4,
          name: 'Luna',
          species: 'CAT',
          aggressive: false,
          allergies: null,
        },
      }),
    );
    fixture.detectChanges();
    expect(el.querySelector('[aria-labelledby="col-ARRIVED"]')!.textContent).toContain('Luna');
  });

  it('muestra cómo reconocer al cliente y a la mascota, sus avisos, y Enter elige la única posible', async () => {
    const fixture = render('RECEPTION', [item(1)]);
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Agregar a la cola'))!
      .click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#aq-search')!;
    input.value = '77';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    http
      .expectOne((r) => r.url === '/api/clients' && r.params.get('q') === '77')
      .flush({
        items: [
          {
            id: 7,
            number: 12,
            name: 'Gabriela Medina Gutiérrez',
            docType: 'DNI',
            docNumber: '45677912',
            phone: '960477990',
            active: true,
            lastVisit: null,
            pets: [
              {
                id: 10,
                number: 1,
                name: 'Mascota 1',
                species: 'DOG',
                aggressive: false,
                hasAllergies: false,
                active: true,
              },
              {
                id: 33,
                number: 80,
                name: 'Mía',
                species: 'DOG',
                sex: 'FEMALE',
                breed: 'Shih tzu',
                birthDate: null,
                aggressive: true,
                aggressiveNote: 'Usar bozal',
                hasAllergies: true,
                active: true,
              },
            ],
          },
        ],
        total: 9,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    const dialog = input.closest('dialog')!;
    // Por qué salió: lo buscado en negrita en el DNI y el celular
    const marks = [...dialog.querySelectorAll('mark')].map((m) => m.textContent?.trim());
    expect(marks).toEqual(['77', '77']);
    expect(dialog.textContent).toContain('Perro · Hembra · Shih tzu');
    expect(dialog.textContent).toContain('Ya en la cola · Llegó');
    // Agrupado por dueño, con su DNI y celular
    expect(dialog.querySelectorAll('ul > li')).toHaveLength(1);
    expect(dialog.textContent).toContain('DNI 45677912');
    expect(dialog.textContent).toContain('Agresivo');
    expect(dialog.textContent).toContain('Alergias');
    expect(dialog.textContent).toContain('Hay 8 clientes más');

    // Solo Mía se puede elegir: Enter la elige
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    http.expectOne((r) => /^\/api\/clients\/\d+$/.test(r.url)).flush({ address: null });
    http.expectOne((r) => r.url.endsWith('/transport-price')).flush({ price: null });
    await tick();
    expect(dialog.textContent).toContain('Usar bozal');
    expect(dialog.textContent).toContain('Tiene alergias');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Vacuna')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('button[form="add-queue-form"]')!.click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/queue');
    expect(req.request.body).toEqual({ petId: 33, urgent: false, reason: 'Vacuna' });
    req.flush(item(5, { pet: { ...item(5).pet, id: 33, name: 'Mía' } }));
  });

  it('sin resultados, "Registrar cliente nuevo" lleva lo escrito', async () => {
    const fixture = render('RECEPTION', []);
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Agregar a la cola'))!
      .click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#aq-search')!;
    input.value = '45677912';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    http
      .expectOne((r) => r.url === '/api/clients')
      .flush({ items: [], total: 0, page: 1, pageSize: 20 });
    fixture.detectChanges();
    const link = el.querySelector<HTMLAnchorElement>('a[href^="/clientes/nuevo"]')!;
    expect(link.getAttribute('href')).toBe('/clientes/nuevo?buscar=45677912');
  });
});
