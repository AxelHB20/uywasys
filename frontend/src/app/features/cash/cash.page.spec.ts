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
    {
      method: 'CASH',
      label: 'Efectivo',
      collected: 60,
      refunded: 0,
      net: 60,
      payments: 1,
      withoutCode: 0,
    },
    {
      method: 'YAPE',
      label: 'Yape',
      collected: 40,
      refunded: 0,
      net: 40,
      payments: 2,
      withoutCode: 1,
    },
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
    lastClosed: SessionSummary | null = null,
    pendingList: unknown[] | null = null,
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
    if (!current) {
      http
        .expectOne((r) => r.method === 'GET' && r.url === '/api/cash/sessions')
        .flush({ items: lastClosed ? [{ id: lastClosed.id, status: 'CLOSED' }] : [] });
      if (lastClosed) http.expectOne(`/api/cash/sessions/${lastClosed.id}`).flush(lastClosed);
    }
    if (current)
      http.expectOne('/api/cash/pending').flush(
        pendingList ?? [
          {
            client: account.client,
            balance: 110,
            charges: 2,
            since: '2026-10-28T13:10:00Z',
            last: '2026-10-28T13:10:00Z',
            pets: ['Toby'],
            sources: ['GROOMING'],
          },
        ],
      );
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

  it('resume la caja: por cobrar, ticket promedio, medios y aviso si sigue abierta de otro día', () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toMatch(/Esta caja es (de ayer|del .+ \(hace \d+ días\))/);
    expect(el.textContent).toContain('Ciérrala y abre la de hoy');
    expect(el.textContent).toContain('1 cliente con saldo');
    expect(el.textContent).toContain('S/ 110.00');
    expect(el.textContent).toContain('Ticket promedio S/ 100.00');
    expect(el.querySelectorAll('[aria-label="Resumen de la caja"] .rounded-sm').length).toBe(2);
    expect(el.textContent).toContain('Aún no hay cobros en esta caja');
  });

  it('cobro parcial en efectivo: aplica a los cargos elegidos y lleva al ticket', async () => {
    const fixture = render(session);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Rosa Quispe');
    expect(el.textContent).toContain('Toby');
    expect(el.textContent).toContain('Grooming');
    el.querySelector<HTMLButtonElement>('[aria-label="Cobrar a Rosa Quispe"]')!.click();
    http.expectOne('/api/clients/7/account').flush(account);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();

    // El abono se abre solo cuando paga una parte
    expect(el.querySelector('#collect-amount')).toBeNull();
    button(el.querySelector('dialog[open]')!, 'Paga solo una parte').click();
    fixture.detectChanges();
    type(el, '#collect-amount', '80');
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    // Sin anotar lo recibido en efectivo no se cobra
    button(dialog, 'Cobrar S/').click();
    http.expectNone('/api/cash/receipts');
    // El problema sale junto al campo, no como aviso flotante
    fixture.detectChanges();
    expect(dialog.querySelector('[role="alert"]')!.textContent).toContain('Anota cuánto recibió');
    // Montos rápidos: exacto o billetes por encima
    expect(dialog.textContent).toContain('S/ 100.00');
    button(dialog, 'Exacto').click();
    fixture.detectChanges();
    button(dialog, 'Cobrar S/').click();

    const req = http.expectOne('/api/cash/receipts');
    expect(req.request.body).toMatchObject({
      clientId: 7,
      chargeIds: [1, 2],
      amount: 80,
      payments: [{ method: 'CASH', amount: 80, tendered: 80, operationCode: null }],
    });
    expect(req.request.body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({ id: 44, code: 'NV-000002' });
    expect(navigate).toHaveBeenCalledWith(['/caja/tickets', 44]);
  });

  it('movilidad: el precio se corrige en el cobro (lápiz) y el total sigue', async () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Cobrar a Rosa Quispe"]')!.click();
    const move = {
      id: 3,
      description: 'Movilidad · Recojo y entrega',
      pet: { id: 3, name: 'Toby' },
      total: 15,
      paidAmount: 0,
      balance: 15,
      createdAt: '2026-10-28T13:15:00Z',
      status: 'PENDING',
      transport: true,
    };
    http
      .expectOne('/api/clients/7/account')
      .flush({ ...account, pending: [...account.pending, move], pendingTotal: 125 });
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    // Solo la movilidad tiene lápiz
    expect(dialog.querySelectorAll('[title="Cambiar precio"]')).toHaveLength(1);
    dialog.querySelector<HTMLButtonElement>('[title="Cambiar precio"]')!.click();
    fixture.detectChanges();
    type(el, '#mov-price-3', '20');
    button(dialog, 'Listo').click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/charges/3/transport-price' });
    expect(req.request.body).toEqual({ price: 20 });
    req.flush({ ...move, total: 20, balance: 20 });
    fixture.detectChanges();
    expect(button(dialog, 'Cobrar S/').textContent).toContain('S/ 130.00');
  });

  async function openCollect(fixture: ReturnType<typeof render>): Promise<Element> {
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Cobrar a Rosa Quispe"]')!.click();
    http.expectOne('/api/clients/7/account').flush(account);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    return el.querySelector('dialog[open]')!;
  }

  it('Yape sin código de operación se cobra igual (el código es opcional)', async () => {
    const fixture = render(session);
    const dialog = await openCollect(fixture);
    button(dialog, 'Yape').click();
    fixture.detectChanges();
    expect(dialog.querySelector('#collect-code-0')).not.toBeNull();
    expect(dialog.textContent).toContain('Si el dueño no lo tiene, cobra igual');
    button(dialog, 'Cobrar S/').click();
    const req = http.expectOne('/api/cash/receipts');
    expect(req.request.body.payments).toEqual([
      { method: 'YAPE', amount: 110, tendered: null, operationCode: null },
    ]);
  });

  it('cobrar con algo más (una cama): se agrega en el mismo cobro y comprobante', async () => {
    const fixture = render(session);
    const dialog = await openCollect(fixture);
    const search = dialog.querySelector<HTMLInputElement>('#collect-search')!;
    search.value = 'cama';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    http
      .expectOne((r) => r.url === '/api/inventory/products' && r.params.get('q') === 'cama')
      .flush({
        items: [
          {
            id: 5,
            name: 'Cama acolchada',
            baseUnit: 'UNIT',
            totalStock: 4,
            controlled: false,
            chargeable: true,
            presentations: [{ id: 50, name: 'Unidad', factor: 1, active: true, price: 110 }],
          },
        ],
        total: 1,
      });
    fixture.detectChanges();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(dialog.textContent).toContain('Agregado en caja');
    expect(dialog.textContent).toContain('Nuevo');
    expect(dialog.textContent).toContain('+ 1 nuevo');
    button(dialog, 'Yape').click();
    fixture.detectChanges();
    button(dialog, 'Cobrar S/').click();
    const req = http.expectOne('/api/cash/receipts');
    expect(req.request.body).toMatchObject({
      chargeIds: [1, 2],
      items: [{ productId: 5, presentationId: 50, quantity: 1 }],
      amount: 220,
    });
  });

  it('pago dividido: al escribir un monto, el otro medio se ajusta solo', async () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    const dialog = await openCollect(fixture);
    button(dialog, 'Paga solo una parte').click();
    fixture.detectChanges();
    type(el, '#collect-amount', '80');
    fixture.detectChanges();
    button(dialog, 'Dividir el pago').click();
    fixture.detectChanges();
    // Efectivo + Yape: se escribe lo de Yape y el efectivo queda con el resto
    expect(dialog.querySelector<HTMLSelectElement>('#collect-method-1')!.value).toBe('YAPE');
    type(el, '#collect-amount-1', '30');
    fixture.detectChanges();
    expect(dialog.querySelector<HTMLInputElement>('#collect-amount-0')!.value).toBe('50');
    expect(dialog.textContent).toContain('Cubierto');
    type(el, '#collect-tendered-0', '100');
    fixture.detectChanges();
    expect(dialog.textContent).toContain('Vuelto S/ 50.00');
    button(dialog, 'Cobrar S/').click();
    const req = http.expectOne('/api/cash/receipts');
    expect(req.request.body.payments).toEqual([
      { method: 'CASH', amount: 50, tendered: 100, operationCode: null },
      { method: 'YAPE', amount: 30, tendered: null, operationCode: null },
    ]);
  });

  it('"Por cobrar": lo de hoy arriba (el último primero) y los saldos anteriores debajo', () => {
    const now = new Date();
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    const row = (id: number, name: string, since: string, last: string) => ({
      client: { id, number: id, name, phone: '' },
      balance: 50,
      charges: 1,
      since,
      last,
      pets: [],
      sources: ['CONSULTATION'],
    });
    const fixture = render(session, undefined, null, [
      row(1, 'Antiguo', '2026-01-02T15:00:00Z', '2026-01-02T15:00:00Z'),
      row(2, 'Temprano', at(5), at(5)),
      row(3, 'Recién', at(1), at(1)),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const groups = [...el.querySelectorAll('section[aria-labelledby="pending-title"] ul')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'De hoy',
      'Saldos anteriores',
    ]);
    const names = (ul: Element) => [...ul.querySelectorAll('a')].map((a) => a.textContent!.trim());
    expect(names(groups[0])).toEqual(['Recién', 'Temprano']);
    expect(names(groups[1])).toEqual(['Antiguo']);
  });

  it('venta de mostrador: Enter agrega el producto sin usar el mouse', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'], now: new Date() });
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Venta de mostrador').click();
    fixture.detectChanges();
    const search = el.querySelector<HTMLInputElement>('#sale-search')!;
    type(el, '#sale-search', '7750000000017');
    // El lector manda Enter antes de que llegue el resultado: se agrega cuando llega
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    vi.advanceTimersByTime(300);
    http
      .expectOne(
        (r) => r.url === '/api/inventory/products' && r.params.get('q') === '7750000000017',
      )
      .flush({
        items: [
          {
            id: 9,
            name: 'Pipeta gato',
            baseUnit: 'UNIT',
            totalStock: 3,
            controlled: false,
            chargeable: true,
            presentations: [
              {
                id: 90,
                name: 'Caja',
                factor: 12,
                active: true,
                price: 120,
                barcode: '7750000000099',
              },
              {
                id: 91,
                name: 'Unidad',
                factor: 1,
                active: true,
                price: 38,
                barcode: '7750000000017',
              },
            ],
          },
        ],
        total: 1,
      });
    fixture.detectChanges();
    vi.useRealTimers();
    // Con el código exacto entra la presentación correcta (Unidad), no la primera
    expect(el.querySelector('#sale-qty-0')).not.toBeNull();
    expect(el.querySelector('dialog[open]')!.textContent).toContain('Pipeta gato · Unidad');
    expect(search.value).toBe('');
    // Quedan pocos: se avisa en la línea antes de cobrar
    expect(el.querySelector('dialog[open]')!.textContent).toContain('Quedan 3');
  });

  it('cerrar caja muestra lo que se revisa en las apps, con los pagos sin código', async () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Cerrar caja').click();
    fixture.detectChanges();
    await tick();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Revisa en tus apps');
    expect(dialog.textContent).toContain('2 pagos');
    expect(dialog.textContent).toContain('1 sin código');
  });

  const closed: SessionSummary = {
    ...session,
    id: 2,
    status: 'CLOSED',
    openingAmount: 80,
    closedAt: '2026-10-27T22:00:00Z',
    countedCash: 160,
    difference: 0,
  };

  it('con la caja cerrada muestra el último cierre para imprimir y repite el monto inicial', () => {
    const fixture = render(null, undefined, closed);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Último cierre');
    const link = el.querySelector<HTMLAnchorElement>('a[href="/caja/cierres/2"]');
    expect(link?.textContent).toContain('Imprimir reporte de cierre');
    button(el, 'Igual que la última vez').click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#open-amount')!.value).toBe('80');
  });

  it('el egreso no puede ser mayor al efectivo en caja; los motivos frecuentes llenan el motivo', async () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Egreso').click();
    fixture.detectChanges();
    await tick();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Efectivo disponible en caja');
    expect(dialog.textContent).toContain('S/ 160.00');
    type(el, '#exp-amount', '200');
    button(dialog, 'Retiro del dueño').click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#exp-reason')!.value).toBe('Retiro del dueño');
    expect(dialog.textContent).toContain('No puede ser mayor al efectivo');
    button(dialog, 'Registrar egreso').click();
    http.expectNone((r) => r.url.endsWith('/expenses'));

    type(el, '#exp-amount', '50');
    fixture.detectChanges();
    button(dialog, 'Registrar egreso').click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/expenses'));
    expect(req.request.body).toEqual({ amount: 50, reason: 'Retiro del dueño' });
    req.flush(session);
    http.expectOne('/api/cash/pending').flush([]);
  });

  it('contar por billetes y monedas suma y pasa el total al efectivo contado', async () => {
    const fixture = render(session);
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Cerrar caja').click();
    fixture.detectChanges();
    await tick();
    button(el.querySelector('dialog[open]')!, 'Contar por billetes').click();
    fixture.detectChanges();
    const qty = (label: string, n: string) =>
      type(el, `input[aria-label="Cantidad de ${label}"]`, n);
    qty('S/ 100', '1');
    qty('S/ 20', '3');
    qty('50 cént.', '1');
    qty('10 cént.', '2');
    fixture.detectChanges();
    expect(el.querySelector('#count-panel')!.textContent).toContain('S/ 160.70');
    button(el.querySelector('#count-panel')!, 'Usar este total').click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#close-counted')!.value).toBe('160.7');
    expect(el.textContent).toContain('Sobran S/ 0.70');
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

  it('con facturación activa, el cobro sale con boleta; la factura pide el RUC ahí mismo y lo busca', async () => {
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
    const radio = (v: string) =>
      dialog.querySelector<HTMLButtonElement>(`[role="radio"][data-value="${v}"]`)!;
    expect(radio('BOLETA').getAttribute('aria-checked')).toBe('true');
    // La factura ya no tiene candado
    expect(radio('FACTURA').getAttribute('aria-disabled')).toBeNull();
    radio('FACTURA').click();
    fixture.detectChanges();
    // Sin datos de facturación guardados: pide el RUC aquí mismo
    http.expectOne('/api/billing/buyer/7').flush(null);
    await tick();
    fixture.detectChanges();
    expect(dialog.textContent).toContain('RUC para la factura');
    expect(dialog.textContent).toContain('Se guardará en la ficha de Rosa Quispe');

    // Cobrar sin RUC no envía nada
    button(dialog, 'Cobrar S/').click();
    http.expectNone('/api/cash/receipts');

    const ruc = dialog.querySelector<HTMLInputElement>('#buyer-doc')!;
    ruc.value = '20601847834';
    ruc.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    http
      .expectOne((r) => r.url === '/api/billing/lookup')
      .flush({
        name: 'OSYS COMPANY S.A.C.',
        address: 'Calle Melchormalo 125',
        status: 'ACTIVO',
        condition: 'HABIDO',
        source: 'APISPERU',
      });
    fixture.detectChanges();
    // Compacto: lo encontrado sale en una tarjeta; la razón social de SUNAT no se edita
    const card = dialog.querySelector('[data-testid="buyer-card"]')!;
    expect(card.textContent).toContain('OSYS COMPANY S.A.C.');
    expect(card.textContent).toContain('Calle Melchormalo 125');
    expect(dialog.querySelector('#buyer-name')).toBeNull();
    expect(dialog.querySelector('#buyer-email')).toBeNull();
    expect(button(dialog, 'Enviar el PDF por correo')).toBeTruthy();

    button(dialog, 'Exacto').click();
    fixture.detectChanges();
    button(dialog, 'Cobrar S/').click();
    const req = http.expectOne('/api/cash/receipts');
    expect(req.request.body).toMatchObject({
      document: 'FACTURA',
      buyer: {
        docType: 'RUC',
        docNumber: '20601847834',
        name: 'OSYS COMPANY S.A.C.',
        address: 'Calle Melchormalo 125',
        email: null,
        save: true,
      },
    });
    req.flush({ id: 50, code: 'NV-000003', document: { code: 'F001-00000001' } });
  });

  it('si el cliente ya tiene datos de facturación, la factura los muestra y no pide nada', async () => {
    const fixture = render(session, {
      enabled: true,
      provider: 'SIMULATED',
      production: false,
      simulated: true,
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Cobrar a Rosa Quispe"]')!.click();
    http.expectOne('/api/clients/7/account').flush(account);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    dialog.querySelector<HTMLButtonElement>('[role="radio"][data-value="FACTURA"]')!.click();
    fixture.detectChanges();
    http.expectOne('/api/billing/buyer/7').flush({
      docNumber: '20601847834',
      name: 'OSYS COMPANY S.A.C.',
      address: null,
      email: null,
    });
    await tick();
    fixture.detectChanges();
    expect(dialog.querySelector('[data-testid="buyer-summary"]')!.textContent).toContain(
      'RUC 20601847834',
    );
    button(dialog, 'Exacto').click();
    fixture.detectChanges();
    button(dialog, 'Cobrar S/').click();
    const req = http.expectOne('/api/cash/receipts');
    // El servidor usa los datos guardados
    expect(req.request.body.document).toBe('FACTURA');
    expect(req.request.body.buyer).toBeUndefined();
    req.flush({ id: 51, code: 'NV-000004', document: { code: 'F001-00000002' } });
  });
});
