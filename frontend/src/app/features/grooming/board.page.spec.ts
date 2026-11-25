import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { GroomingCard } from '../../core/services/grooming.models';
import { stubDialog } from '../../shared/testing';
import { GroomingBoardPage } from './board.page';

function card(
  id: number,
  status: GroomingCard['status'],
  extra: Partial<GroomingCard> = {},
): GroomingCard {
  return {
    id,
    code: `GR-0000${id}`,
    day: '2026-10-29',
    status,
    size: 'SMALL',
    promisedAt: null,
    checkInAt: '2026-10-29T15:00:00.000Z',
    bathingAt: null,
    cuttingAt: null,
    readyAt: null,
    notifiedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    fleas: false,
    ticks: false,
    matting: false,
    aggressive: false,
    instructions: null,
    transport: 'NONE',
    transportPrice: null,
    visitId: 100 + id,
    queueEntryId: null,
    pet: { id, number: id, name: `Mascota${id}`, species: 'DOG', breed: null, allergies: null },
    client: { id: 9, name: 'Rosa Quispe', phone: '987654321' },
    groomer: null,
    services: [{ id: 1, description: 'Baño completo', quantity: 1, total: 40, status: 'PENDING' }],
    total: 40,
    pending: 40,
    ...extra,
  };
}

describe('GroomingBoardPage (tablero)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);
  afterEach(() => http.verify());

  function render(role: 'GROOMER' | 'RECEPTION' | 'CASHIER', cards: GroomingCard[]) {
    TestBed.configureTestingModule({
      imports: [GroomingBoardPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      role,
      clinic: { name: 'Vet Sur' },
    } as never);
    const fixture = TestBed.createComponent(GroomingBoardPage);
    fixture.detectChanges();
    http.expectOne('/api/grooming/groomers').flush([]);
    http.expectOne('/api/grooming').flush(cards);
    fixture.detectChanges();
    return fixture;
  }

  /** Botones visibles fuera de los modales cerrados */
  const buttons = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent?.includes(text) && !b.closest('dialog:not([open])'),
    );

  it('muestra cada estado en su columna y avisa por WhatsApp cuando está listo', () => {
    const el: HTMLElement = render('GROOMER', [
      card(1, 'WAITING', { aggressive: true }),
      card(2, 'READY'),
      card(3, 'DELIVERED', { deliveredAt: '2026-10-29T18:00:00.000Z' }),
    ]).nativeElement;
    const column = (name: string) => el.querySelector(`section[aria-label="${name}"]`)!;
    expect(column('En espera').textContent).toContain('Mascota1');
    expect(column('En espera').textContent).toContain('Agresivo');
    expect(column('Listo').textContent).toContain('Mascota2');
    const whatsapp = column('Listo').querySelector<HTMLAnchorElement>('a[href^="https://wa.me/"]')!;
    expect(whatsapp.href).toContain('51987654321');
    expect(el.textContent).toContain('Entregados hoy');
    expect(el.textContent).toContain('Por cobrar S/ 40.00');
  });

  it('"Pasar a" mueve la tarjeta y, si el servidor lo rechaza, vuelve', () => {
    const fixture = render('GROOMER', [card(1, 'WAITING')]);
    const el: HTMLElement = fixture.nativeElement;
    buttons(el, 'Pasar a Baño')[0].click();
    fixture.detectChanges();
    expect(el.querySelector('section[aria-label="Baño"]')!.textContent).toContain('Mascota1');
    http
      .expectOne({ method: 'PATCH', url: '/api/grooming/1/status' })
      .flush({ message: 'La mascota ya se entregó' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(el.querySelector('section[aria-label="En espera"]')!.textContent).toContain('Mascota1');
  });

  it('entrega a quien recoge y lleva a caja si queda por cobrar', async () => {
    const fixture = render('RECEPTION', [card(2, 'READY')]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    buttons(el, 'Entregar')[0].click();
    fixture.detectChanges();
    http.expectOne('/api/clients/9').flush({
      id: 9,
      name: 'Rosa Quispe',
      docNumber: '45678912',
      authorized: [{ id: 3, name: 'Luis Quispe', dni: '41234567', phone: null, relation: 'Hijo' }],
    });
    fixture.detectChanges();
    buttons(el, 'Luis Quispe')[0].click();
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>('#deliver-form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/grooming/2/deliver' });
    expect(req.request.body).toEqual({
      pickedUpBy: 'Luis Quispe',
      pickedUpDocument: '41234567',
      pickedUpRelation: 'Hijo',
    });
    req.flush({ ...card(2, 'DELIVERED'), pending: 40, client: { id: 9 } });
    http.expectOne('/api/grooming').flush([]);
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/caja'], { queryParams: { cobrar: 9 } });
  });

  it('lo trajo el dueño y ya no puede volver: recepción agrega "Lo llevamos" con precio', async () => {
    const fixture = render('RECEPTION', [card(1, 'BATHING')]);
    const el: HTMLElement = fixture.nativeElement;
    (fixture.componentInstance as unknown as { open(c: GroomingCard): void }).open(
      card(1, 'BATHING'),
    );
    const detail = {
      ...card(1, 'BATHING'),
      transportAddress: null,
      skinNotes: null,
      belongings: null,
      signerName: null,
      signature: null,
      pickedUpBy: null,
      pickedUpDocument: null,
      pickedUpRelation: null,
      cancelReason: null,
      createdBy: { id: 1, fullName: 'Ana' },
      deliveredBy: null,
      cancelledBy: null,
      client: { id: 9, name: 'Rosa Quispe', phone: '987654321', docType: null, docNumber: null },
      clinic: { name: 'Vet Sur', ruc: null, address: null, phone: null, logoUrl: null },
    };
    http.match((r) => r.url === '/api/grooming/1').forEach((r) => r.flush(detail));
    fixture.detectChanges();
    buttons(el, 'Agregar')[0].click();
    http.expectOne('/api/pets/1/immunization-card').flush({
      pet: { client: { id: 9, address: 'Av. Lima 123', district: 'Chosica' } },
    });
    http.expectOne('/api/clients/9/transport-price').flush({ price: null });
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('dialog[open] [role="radio"]')]
      .find((b) => b.textContent?.includes('Lo llevamos'))!
      .click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#bd-mov-address')!.value).toBe(
      'Av. Lima 123, Chosica',
    );
    const price = el.querySelector<HTMLInputElement>('#bd-mov-price')!;
    price.value = '12';
    price.dispatchEvent(new Event('input'));
    buttons(el, 'Guardar')[0].click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/grooming/1/transport' });
    expect(req.request.body).toEqual({
      transport: 'DROPOFF',
      transportAddress: 'Av. Lima 123, Chosica',
      transportPrice: 12,
    });
    req.flush({
      ...detail,
      transport: 'DROPOFF',
      transportPrice: 12,
      transportAddress: 'Av. Lima 123, Chosica',
    });
    fixture.detectChanges();
    expect(el.querySelector('dialog[open]')!.textContent).toContain('Lo llevamos');
  });

  it('caja solo mira: no mueve ni entrega', () => {
    const el: HTMLElement = render('CASHIER', [card(1, 'WAITING'), card(2, 'READY')]).nativeElement;
    expect(buttons(el, 'Pasar a').length).toBe(0);
    expect(buttons(el, 'Entregar').length).toBe(0);
    expect(el.textContent).not.toContain('Nuevo ingreso');
  });
});
