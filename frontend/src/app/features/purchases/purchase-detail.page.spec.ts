import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { PurchaseDetail } from '../../core/services/purchases.models';
import { PurchaseDetailPage } from './purchase-detail.page';

function detail(over: Partial<PurchaseDetail> = {}): PurchaseDetail {
  return {
    id: 12,
    number: 12,
    code: 'CO-00012',
    supplier: { id: 3, name: 'Droguería Andina S.A.C.', ruc: '20131312955' },
    docType: 'FACTURA',
    docNumber: 'F001-00456',
    issuedAt: '2026-11-10',
    createdAt: '2026-11-10T15:00:00Z',
    status: 'RECEIVED',
    lines: 1,
    subtotal: 200,
    igv: 36,
    total: 236,
    hasFile: false,
    pricesIncludeIgv: false,
    notes: null,
    createdBy: { id: 2, fullName: 'Dr. Luis' },
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    file: null,
    canVoid: true,
    lineItems: [
      {
        id: 1,
        product: { id: 7, name: 'Amoxicilina 500 mg', baseUnit: 'TABLET', controlled: false },
        presentation: { id: 70, name: 'Caja x 100', factor: 100 },
        description: 'Amoxicilina 500 mg · Caja x 100',
        quantity: 5,
        unitPrice: 40,
        taxable: 200,
        igv: 36,
        total: 236,
        batch: {
          id: 9,
          lotNumber: 'A23B',
          expiresAt: '2028-03-31',
          initialQuantity: 500,
          quantity: 500,
          unitCost: 0.4,
        },
      },
    ],
    ...over,
  };
}

describe('PurchaseDetailPage', () => {
  let http: HttpTestingController;

  function render(role: 'ADMIN' | 'VET', p: PurchaseDetail = detail()) {
    TestBed.configureTestingModule({
      imports: [PurchaseDetailPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    // jsdom no implementa <dialog>
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role,
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(PurchaseDetailPage);
    fixture.componentRef.setInput('id', '12');
    fixture.detectChanges();
    http.expectOne('/api/inventory/purchases/12').flush(p);
    fixture.detectChanges();
    return fixture;
  }
  const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
  /** Botones de la página (los de los modales cerrados no cuentan) */
  const button = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => !b.closest('dialog') && b.textContent?.trim() === label,
    );
  const inDialog = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) =>
      b.textContent?.includes(label),
    );

  afterEach(() => http.verify());

  it('muestra la ficha como en el papel: líneas, lote, totales y quién la registró', async () => {
    const fixture = render('VET');
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const t = text(el);
    expect(t).toContain('Compra CO-00012');
    expect(t).toContain('Factura F001-00456');
    expect(t).toContain('RUC 20131312955');
    expect(t).toContain('Dr. Luis');
    expect(t).toContain('A23B');
    expect(t).toContain('31/03/2028');
    expect(t).toContain('S/ 236.00');
    // Quien no la registró (y no es admin) no ve "Anular"
    expect(button(el, 'Anular')).toBeUndefined();
    expect(button(el, 'Corregir comprobante')).toBeDefined();
  });

  it('el administrador la anula con motivo y queda marcada', async () => {
    const fixture = render('ADMIN');
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Anular')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    inDialog(el, 'Anular compra')!.click();
    fixture.detectChanges();
    http.expectNone('/api/inventory/purchases/12/void');
    expect(text(el)).toContain('Escribe el motivo');
    const reason = el.querySelector<HTMLTextAreaElement>('#pd-void')!;
    reason.value = 'Se registró dos veces';
    reason.dispatchEvent(new Event('input'));
    inDialog(el, 'Anular compra')!.click();
    const req = http.expectOne('/api/inventory/purchases/12/void');
    expect(req.request.body).toEqual({ reason: 'Se registró dos veces' });
    req.flush(
      detail({
        status: 'VOIDED',
        canVoid: false,
        voidedAt: '2026-11-12T16:00:00Z',
        voidedBy: { id: 1, fullName: 'Ana' },
        voidReason: 'Se registró dos veces',
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text(el)).toContain('Anulada');
    expect(text(el)).toContain('«Se registró dos veces»');
    expect(button(el, 'Corregir comprobante')).toBeUndefined();
  });

  it('si ya se usó parte, explica cómo corregir en vez de anular', async () => {
    const used = detail({ canVoid: false });
    used.lineItems[0].batch.quantity = 480;
    const fixture = render('ADMIN', used);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(button(el, 'Anular')).toBeUndefined();
    expect(text(el)).toContain('ajuste por conteo');
    expect(text(el)).toContain('Quedan 480 tabletas de 500');
  });
});
