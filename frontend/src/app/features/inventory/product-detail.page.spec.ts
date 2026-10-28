import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { ProductDetail } from '../../core/services/inventory.models';
import { stubDialog, tick } from '../../shared/testing';
import { ProductDetailPage } from './product-detail.page';

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 5,
    code: 'MEL1',
    barcode: null,
    name: 'Meloxicam 1 mg',
    category: 'MEDICINE',
    baseUnit: 'TABLET',
    totalStock: 347,
    minStock: 20,
    lowStock: false,
    controlled: false,
    requiresPrescription: true,
    sunatUnit: 'NIU',
    igv: 'TAXED',
    notes: null,
    active: true,
    presentations: [
      { id: 1, name: 'Caja x 100', factor: 100, price: 150, barcode: null, active: true },
      { id: 2, name: 'Blíster x 10', factor: 10, price: 18, barcode: null, active: true },
      { id: 3, name: 'Tableta', factor: 1, price: 2, barcode: null, active: true },
    ],
    batches: [
      {
        id: 9,
        lotNumber: 'L-A',
        expiresAt: '2026-11-15',
        expiry: { days: 19, level: 'RED' },
        quantity: 347,
        initialQuantity: 400,
        unitCost: 0.9,
        supplier: 'Droguería Lima',
        documentNumber: 'F001-1',
        receivedAt: '2026-10-01T15:00:00Z',
      },
    ],
    usedIn: [],
    ...overrides,
  };
}

describe('ProductDetailPage (ficha de producto)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  function render(role: 'VET' | 'CASHIER', p: ProductDetail = product()) {
    TestBed.configureTestingModule({
      imports: [ProductDetailPage],
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
    const fixture = TestBed.createComponent(ProductDetailPage);
    fixture.componentRef.setInput('id', '5');
    fixture.detectChanges();
    http.expectOne('/api/inventory/products/5').flush(p);
    http
      .expectOne('/api/inventory/products/5/movements')
      .flush({ items: [], total: 0, page: 1, pageSize: 30 });
    fixture.detectChanges();
    return fixture;
  }

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => !b.closest('dialog') && b.textContent?.includes(text),
    );

  afterEach(() => http.verify());

  it('muestra el stock legible, el semáforo del lote y el valor al costo', () => {
    const el: HTMLElement = render('VET').nativeElement;
    expect(el.textContent).toContain('3 cajas, 4 blísteres y 7 tabletas');
    expect(el.textContent).toContain('Vence en 19 días');
    expect(el.textContent).toContain('S/ 312.30');
  });

  it('caja solo consulta: sin botones de compra ni salida', () => {
    const el: HTMLElement = render('CASHIER').nativeElement;
    expect(button(el, 'Registrar compra')).toBeUndefined();
    expect(button(el, 'Registrar salida')).toBeUndefined();
  });

  it('la compra convierte a unidades mínimas y envía lote y vencimiento', async () => {
    const fixture = render('VET');
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Registrar compra')!.click();
    fixture.detectChanges();
    await tick();
    const set = (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('#pu-qty', '5');
    set('#pu-lot', 'L-Z');
    set('#pu-exp', '2027-06-30');
    set('#pu-cost', '90');
    fixture.detectChanges();
    expect(el.textContent).toContain('= 500 tabletas');
    el.querySelector<HTMLButtonElement>('button[form="purchase-form"]')!.click();
    const req = http.expectOne('/api/inventory/products/5/purchases');
    expect(req.request.body).toMatchObject({
      presentationId: 1,
      quantity: 5,
      lotNumber: 'L-Z',
      expiresAt: '2027-06-30',
      costPerPresentation: 90,
    });
    req.flush(product({ totalStock: 847 }));
    http
      .expectOne('/api/inventory/products/5/movements')
      .flush({ items: [], total: 0, page: 1, pageSize: 30 });
  });

  it('un controlado no se registra como uso sin paciente ni receta', async () => {
    const fixture = render('VET', product({ controlled: true }));
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Registrar salida')!.click();
    fixture.detectChanges();
    await tick();
    const treatment = [...el.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('Uso interno'),
    )!;
    treatment.querySelector('input')!.click();
    fixture.detectChanges();
    const set = (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('#ou-qty', '1');
    set('#ou-reason', 'Sedación');
    fixture.detectChanges();
    expect(el.querySelector('#ou-rx')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('button[form="outflow-form"]')!.click();
    http.expectNone('/api/inventory/products/5/outflows');
  });
});
