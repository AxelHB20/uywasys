import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { ReceiptTicket } from '../../core/services/cash.models';
import { stubDialog, tick } from '../../shared/testing';
import { TicketPage } from './ticket.page';

const ticket: ReceiptTicket = {
  id: 44,
  number: 2,
  code: 'NV-000002',
  status: 'ACTIVE',
  createdAt: '2026-10-28T17:26:00Z',
  voidedAt: null,
  voidReason: null,
  legend: 'Nota de venta interna — no es comprobante de pago',
  document: null,
  clinic: {
    name: 'Veterinaria Demo',
    ruc: '20123456789',
    address: 'Av. Lima 123',
    phone: null,
    logoUrl: null,
    openingHours: [1, 2, 3, 4, 5, 6, 7].map((day) =>
      day === 7 ? { day, open: null, close: null } : { day, open: '09:00', close: '19:00' },
    ),
  },
  client: {
    id: 7,
    number: 12,
    name: 'Rosa Quispe',
    docType: 'DNI',
    docNumber: '45678912',
    walkIn: false,
  },
  cashier: 'Ana',
  register: 'Caja principal',
  lines: [
    {
      chargeId: 1,
      description: 'Consulta general',
      quantity: 1,
      unitPrice: 50,
      discount: 0,
      total: 50,
      paid: 50,
    },
    {
      chargeId: 2,
      description: 'Vacunación',
      quantity: 1,
      unitPrice: 60,
      discount: 0,
      total: 60,
      paid: 30,
    },
  ],
  totals: {
    taxed: 93.22,
    exempt: 0,
    unaffected: 0,
    igv: 16.78,
    lines: 110,
    paid: 80,
    change: 20,
    balance: 30,
  },
  payments: [{ method: 'CASH', label: 'Efectivo', amount: 80, tendered: 100, operationCode: null }],
};

describe('TicketPage', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  function render(role: 'ADMIN' | 'CASHIER', data: ReceiptTicket = ticket) {
    TestBed.configureTestingModule({
      imports: [TicketPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'a@uywa.pe',
      role,
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(TicketPage);
    fixture.componentRef.setInput('id', '44');
    fixture.detectChanges();
    http.expectOne('/api/cash/receipts/44').flush(data);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('muestra el ticket con IGV, vuelto, saldo y la leyenda de nota interna', () => {
    const el: HTMLElement = render('CASHIER').nativeElement;
    const text = el.querySelector('.print-area')!.textContent!;
    for (const part of [
      'NV-000002',
      'RUC 20123456789',
      'DNI',
      '45678912',
      'IGV 18 %',
      'S/ 16.78',
      'Vuelto',
      'S/ 20.00',
      'Saldo pendiente',
      'S/ 30.00',
      'no es comprobante de pago',
      'Atendemos: Lun a Sáb 09:00–19:00 · Dom cerrado',
    ])
      expect(text).toContain(part);
    const buttons = [...el.querySelectorAll('button')].filter((b) => !b.closest('dialog'));
    expect(buttons.map((b) => b.textContent?.trim())).not.toContain('Anular cobro');
  });

  it('sin logo, el nombre de la clínica encabeza el ticket', () => {
    const el: HTMLElement = render('CASHIER').nativeElement;
    expect(el.querySelector('.print-area img')).toBeNull();
    expect(el.querySelector('.print-area header')!.textContent).toContain('Veterinaria Demo');
  });

  it('con logo lo pone arriba del nombre, y si la imagen falla queda solo el texto', () => {
    const fixture = render('CASHIER', {
      ...ticket,
      clinic: { ...ticket.clinic, logoUrl: '/api/clinic/logo?v=1' },
    });
    const el: HTMLElement = fixture.nativeElement;
    const img = el.querySelector<HTMLImageElement>('.print-area header img')!;
    expect(img.getAttribute('src')).toBe('/api/clinic/logo?v=1');
    expect(img.alt).toBe('Logo de Veterinaria Demo');
    expect(img.nextElementSibling!.textContent).toContain('Veterinaria Demo');

    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(el.querySelector('.print-area img')).toBeNull();
    expect(el.querySelector('.print-area header')!.textContent).toContain('Veterinaria Demo');
  });

  it('al imprimir la hoja mide 80 mm de ancho y el largo del ticket, y luego se quita la regla', () => {
    const el: HTMLElement = render('CASHIER').nativeElement;
    let pageRule = '';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      pageRule = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('');
    });
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Imprimir')!.click();
    expect(print).toHaveBeenCalledOnce();
    expect(pageRule).toMatch(/@page \{ size: 80mm \d+mm; margin: 3mm; \}/);
    const after = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(after).not.toContain('@page { size: 80mm');
    print.mockRestore();
  });

  it('el administrador anula el cobro con motivo', async () => {
    const fixture = render('ADMIN');
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Anular cobro')!
      .click();
    fixture.detectChanges();
    await tick();
    const input = el.querySelector<HTMLInputElement>('#t-reason')!;
    input.value = 'Cliente equivocado';
    input.dispatchEvent(new Event('input'));
    [...el.querySelectorAll('dialog[open] button')]
      .find((b) => b.textContent?.includes('Anular cobro'))!
      .dispatchEvent(new Event('click'));
    const req = http.expectOne('/api/cash/receipts/44/void');
    expect(req.request.body).toEqual({ reason: 'Cliente equivocado' });
    req.flush({ ...ticket, status: 'VOID', voidReason: 'Cliente equivocado' });
    fixture.detectChanges();
    expect(el.textContent).toContain('ANULADO');
  });

  it('al anular un cobro con productos de caja pregunta si los devolvió', async () => {
    const fixture = render('ADMIN', {
      ...ticket,
      lines: [
        ...ticket.lines,
        {
          chargeId: 9,
          description: 'Cama acolchada · Unidad',
          quantity: 1,
          unitPrice: 110,
          discount: 0,
          total: 110,
          paid: 110,
          returnable: true,
        },
      ],
    });
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Anular cobro')!
      .click();
    fixture.detectChanges();
    await tick();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('¿Devolvió los productos?');
    expect(dialog.textContent).toContain('Cama acolchada · Unidad');
    const input = el.querySelector<HTMLInputElement>('#t-reason')!;
    input.value = 'Devolvió la cama';
    input.dispatchEvent(new Event('input'));
    const yes = [...dialog.querySelectorAll<HTMLInputElement>('input[type=radio]')][0];
    yes.click();
    fixture.detectChanges();
    [...dialog.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Anular cobro'))!
      .dispatchEvent(new Event('click'));
    const req = http.expectOne('/api/cash/receipts/44/void');
    expect(req.request.body).toEqual({ reason: 'Devolvió la cama', returnProducts: true });
  });

  it('con boleta electrónica imprime su representación: título, cliente, importe en letras y QR', async () => {
    const fixture = render('CASHIER', {
      ...ticket,
      document: {
        id: 9,
        type: 'BOLETA',
        code: 'B001-00000012',
        status: 'ACCEPTED',
        issueDate: '2026-10-28',
        legalName: 'Veterinaria Demo S.A.C.',
        customer: { docType: '1', docNumber: '45678912', name: 'Rosa Quispe', address: null },
        totals: { taxed: 67.8, exempt: 0, unaffected: 0, igv: 12.2, total: 80 },
        lines: [
          { description: 'Consulta general', quantity: 1, unitPrice: 50, total: 50 },
          { description: 'Vacunación (pago a cuenta)', quantity: 1, unitPrice: 30, total: 30 },
        ],
        amountInWords: 'SON: OCHENTA CON 00/100 SOLES',
        hash: 'aBc123HASH',
        qrText: '20123456789|03|B001|12|12.20|80.00|2026-10-28|1|45678912|aBc123HASH|',
        pdfUrl: null,
        simulated: true,
        creditNote: null,
      },
    });
    const el: HTMLElement = fixture.nativeElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('.print-area img[alt="Código QR del comprobante"]')).not.toBeNull();
    });
    const text = el.querySelector('.print-area')!.textContent!;
    for (const part of [
      'Boleta de venta electrónica',
      'B001-00000012',
      'VETERINARIA DEMO S.A.C.'.toLowerCase(),
      'Importe total',
      'S/ 80.00',
      'SON: OCHENTA CON 00/100 SOLES',
      'Representación impresa de la boleta de venta electrónica',
      'Resumen: aBc123HASH',
      'Cobro interno NV-000002',
      'Vacunación (pago a cuenta)',
      'sin valor tributario',
    ])
      expect(text.toLowerCase()).toContain(part.toLowerCase());
    // La leyenda de nota interna ya no aplica
    expect(text).not.toContain('no es comprobante de pago');
  });
});
