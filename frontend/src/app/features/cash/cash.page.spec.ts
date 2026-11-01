import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { SessionSummary } from '../../core/services/cash.models';
import { stubDialog, tick } from '../../shared/testing';
import { CashPage } from './cash.page';

const session: SessionSummary = {
  id: 3,
  status: 'OPEN',
  register: { id: 1, name: 'Caja principal' },
  openingAmount: 100,
  openedAt: '2026-10-28T13:00:00Z',
  openedBy: { id: 1, fullName: 'Ana' },
  closedAt: null,
  closedBy: null,
  expectedCash: 160,
  countedCash: null,
  difference: null,
  closingNote: null,
  byMethod: [
    { method: 'CASH', label: 'Efectivo', collected: 60, refunded: 0, net: 60 },
    { method: 'YAPE', label: 'Yape', collected: 40, refunded: 0, net: 40 },
  ],
  expenses: 0,
  totals: { collected: 100, refunded: 0, net: 100, receipts: 1 },
  receipts: [],
  movements: [],
};

const account = {
  client: {
    id: 7,
    number: 12,
    name: 'Rosa Quispe',
    phone: '987654321',
    docType: null,
    docNumber: null,
  },
  pending: [
    {
      id: 1,
      description: 'Consulta general',
      pet: { id: 3, name: 'Toby' },
      total: 50,
      paidAmount: 0,
      balance: 50,
      createdAt: '2026-10-28T13:10:00Z',
      status: 'PENDING',
    },
    {
      id: 2,
      description: 'Vacunación',
      pet: { id: 3, name: 'Toby' },
      total: 60,
      paidAmount: 0,
      balance: 60,
      createdAt: '2026-10-28T13:12:00Z',
      status: 'PENDING',
    },
  ],
  pendingTotal: 110,
  receipts: [],
};

describe('CashPage (caja)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  function render(
    current: SessionSummary | null,
    billing = { enabled: false, provider: 'SIMULATED', production: false, simulated: true },
  ) {
    TestBed.configureTestingModule({
      imports: [CashPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role: 'CASHIER',
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(CashPage);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/care-services').flush([]);
    http.expectOne('/api/billing/status').flush(billing);
    http.expectOne('/api/cash/sessions/current').flush(current);
    if (current)
      http
        .expectOne('/api/cash/pending')
        .flush([
          { client: account.client, balance: 110, charges: 2, since: '2026-10-28T13:10:00Z' },
        ]);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  const button = (root: Element, text: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(text),
    )!;
  const type = (el: HTMLElement, selector: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('con la caja cerrada pide el monto inicial y la abre', () => {
    const fixture = render(null);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('La caja está cerrada');
    type(el, '#open-amount', '100');
    button(el, 'Abrir caja').click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/cash/sessions');
    expect(req.request.body).toEqual({ openingAmount: 100 });
    req.flush(session);
    http.expectOne('/api/cash/pending').flush([]);
    fixture.detectChanges();
    expect(el.textContent).toContain('Efectivo en caja');
    expect(el.textContent).toContain('S/ 160.00');
  });

  it('cobro parcial en efectivo: aplica a los cargos elegidos y lleva al ticket', async () => {
    const fixture = render(session);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Rosa Quispe');
    el.querySelector<HTMLButtonElement>('[aria-label="Cobrar a Rosa Quispe"]')!.click();
    http.expectOne('/api/clients/7/account').flush(account);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();

    type(el, '#collect-amount', '80');
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    expect(el.querySelector<HTMLInputElement>('#collect-amount-0')!.value).toBe('80');
    button(dialog, 'Cobrar S/').click();

    const req = http.expectOne('/api/cash/receipts');
    expect(req.request.body).toMatchObject({
      clientId: 7,
      chargeIds: [1, 2],
      amount: 80,
      payments: [{ method: 'CASH', amount: 80, tendered: null, operationCode: null }],
    });
    expect(req.request.body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({ id: 44, code: 'NV-000002' });
    expect(navigate).toHaveBeenCalledWith(['/caja/tickets', 44]);
  });

  it('Yape sin código de operación no se envía', async () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Cobrar a Rosa Quispe"]')!.click();
    http.expectOne('/api/clients/7/account').flush(account);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    // Cambia de efectivo a Yape (cubre el total con un solo medio)
    button(dialog, 'Yape').click();
    fixture.detectChanges();
    expect(el.querySelector('#collect-code-0')).not.toBeNull();
    button(dialog, 'Cobrar S/').click();
    http.expectNone('/api/cash/receipts');
  });

  it('cerrar con diferencia exige el motivo', async () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Cerrar caja').click();
    fixture.detectChanges();
    await tick();
    type(el, '#close-counted', '150');
    fixture.detectChanges();
    expect(el.textContent).toContain('Faltan S/ 10.00');
    button(el.querySelector('dialog[open]')!, 'Cerrar caja').click();
    fixture.detectChanges();
    http.expectNone((r) => r.url.endsWith('/close'));
    expect(el.textContent).toContain('Explica la diferencia');

    type(el, '#close-note', 'Vuelto mal dado');
    button(el.querySelector('dialog[open]')!, 'Cerrar caja').click();
    const req = http.expectOne('/api/cash/sessions/3/close');
    expect(req.request.body).toEqual({ countedCash: 150, note: 'Vuelto mal dado' });
    req.flush({
      ...session,
      status: 'CLOSED',
      closedAt: '2026-10-28T22:00:00Z',
      countedCash: 150,
      difference: -10,
      closingNote: 'Vuelto mal dado',
    });
    fixture.detectChanges();
    expect(el.textContent).toContain('La caja está cerrada');
    expect(el.textContent).toContain('S/ -10.00');
  });

  it('con facturación activa, el cobro sale con boleta por defecto y la factura pide RUC', async () => {
    const fixture = render(session, {
      enabled: true,
      provider: 'SIMULATED',
      production: false,
      simulated: true,
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Cobrar a Rosa Quispe"]')!.click();
    http.expectOne('/api/clients/7/account').flush({
      ...account,
      client: { ...account.client, docType: 'DNI', docNumber: '45678912' },
    });
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Comprobante');
    expect(dialog.textContent).toContain('Simulación');
    expect(dialog.textContent).toContain('La factura necesita un cliente con RUC');
    const radio = (v: string) =>
      dialog.querySelector<HTMLButtonElement>(`[role="radio"][data-value="${v}"]`)!;
    expect(radio('BOLETA').getAttribute('aria-checked')).toBe('true');
    expect(radio('FACTURA').getAttribute('aria-disabled')).toBe('true');

    // La factura deshabilitada no se elige; la nota de venta sí
    radio('FACTURA').click();
    fixture.detectChanges();
    expect(radio('BOLETA').getAttribute('aria-checked')).toBe('true');
    radio('NOTE').click();
    fixture.detectChanges();
    expect(radio('NOTE').getAttribute('aria-checked')).toBe('true');
    expect(radio('BOLETA').getAttribute('aria-checked')).toBe('false');
    radio('BOLETA').click();
    fixture.detectChanges();

    button(dialog, 'Cobrar S/').click();
    const req = http.expectOne('/api/cash/receipts');
    expect(req.request.body.document).toBe('BOLETA');
    req.flush({ id: 50, code: 'NV-000003', document: { code: 'B001-00000001' } });
  });
});
