import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
    pet: { id: id * 10, name: `Mascota ${id}`, species: 'DOG', aggressive: false, allergies: null },
    client: { id: id * 100, name: `Cliente ${id}`, phone: '987654321' },
    attendedBy: null,
    ...overrides,
  };
}

describe('QueuePage (cola de hoy)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  function render(role: 'RECEPTION' | 'GROOMER', items: QueueItem[]) {
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

  it('al atender, cambia el estado y mueve la tarjeta', () => {
    const fixture = render('RECEPTION', [item(1)]);
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Atender')!.click();
    const req = http.expectOne('/api/queue/1');
    expect(req.request.body).toEqual({ status: 'IN_PROGRESS' });
    req.flush(item(1, { status: 'IN_PROGRESS', startedAt: '2026-10-27T14:20:00Z' }));
    fixture.detectChanges();
    expect(el.querySelector('[aria-labelledby="col-IN_PROGRESS"]')!.textContent).toContain(
      'Mascota 1',
    );
  });

  it('el groomer ve la cola pero sin botones de acción', () => {
    const el: HTMLElement = render('GROOMER', [item(1)]).nativeElement;
    expect(el.textContent).toContain('Mascota 1');
    const buttons = [...el.querySelectorAll('button')].filter((b) => !b.closest('dialog'));
    expect(buttons.map((b) => b.textContent?.trim()).join('|')).not.toMatch(
      /Atender|Agregar a la cola/,
    );
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
    await tick();
    el.querySelector<HTMLButtonElement>('button[form="add-queue-form"]')!.click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/queue');
    expect(req.request.body).toEqual({ petId: 33, urgent: false, reason: null });
    req.flush(
      item(4, {
        pet: { id: 33, name: 'Luna', species: 'CAT', aggressive: false, allergies: null },
      }),
    );
    fixture.detectChanges();
    expect(el.querySelector('[aria-labelledby="col-ARRIVED"]')!.textContent).toContain('Luna');
  });
});
