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
    tracksExpiry: true,
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

  function render(
    role: 'VET' | 'CASHIER' | 'ADMIN',
    p: ProductDetail = product(),
    moves: unknown[] = [],
  ) {
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
      .flush({ items: moves, total: moves.length, page: 1, pageSize: 30 });
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
    // El total en la unidad mínima, una sola vez
    expect(el.textContent).toContain('= 347 tabletas');
    expect(el.textContent).not.toContain('en total');
    expect(el.textContent).toContain('Vence en 19 días');
    expect(el.textContent).toContain('S/ 312.30');
  });

  it('caja solo consulta: sin botones de compra ni salida, ni lo que pagó la clínica', () => {
    const el: HTMLElement = render('CASHIER').nativeElement;
    expect(button(el, 'Registrar compra')).toBeUndefined();
    expect(button(el, 'Registrar salida')).toBeUndefined();
    expect(el.textContent).not.toContain('Valor al costo');
    expect(el.textContent).not.toContain('c/u');
  });

  it('la compra convierte a unidades mínimas y envía lote y vencimiento', async () => {
    const fixture = render('VET');
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Registrar compra')!.click();
    fixture.detectChanges();
    // El proveedor se elige de la lista de Compras
    http
      .expectOne('/api/inventory/suppliers')
      .flush([{ id: 3, name: 'Droguería Andina S.A.C.', ruc: '20131312955', active: true }]);
    fixture.detectChanges();
    await tick();
    expect(el.querySelector('label[for="pu-cost"]')?.textContent).toContain('Costo');
    const supplier = el.querySelector<HTMLSelectElement>('#pu-sup')!;
    supplier.value = supplier.options[1].value;
    supplier.dispatchEvent(new Event('change'));
    const set = (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('#pu-qty', '5');
    set('#pu-lot', 'L-Z');
    set('#pu-exp', '06/2027');
    set('#pu-cost', '90');
    fixture.detectChanges();
    expect(el.textContent).toContain('= 500 tabletas');
    // Viene con IGV (precio final): se guarda sin IGV
    expect(el.textContent).toContain('Se guarda sin IGV: S/ 76.27');
    el.querySelector<HTMLButtonElement>('button[form="purchase-form"]')!.click();
    const req = http.expectOne('/api/inventory/products/5/purchases');
    expect(req.request.body).toMatchObject({
      presentationId: 1,
      quantity: 5,
      lotNumber: 'L-Z',
      expiresAt: '2027-06-30',
      costPerPresentation: 76.2712,
      supplierId: 3,
      supplier: null,
    });
    req.flush(product({ totalStock: 847 }));
    http
      .expectOne('/api/inventory/products/5/movements')
      .flush({ items: [], total: 0, page: 1, pageSize: 30 });
  });

  it('lo que no vence (una cama) no pide lote ni fecha y lo dice claro', async () => {
    const bed = product({
      name: 'Cama ortopédica M',
      category: 'ACCESSORY',
      baseUnit: 'UNIT',
      tracksExpiry: false,
      requiresPrescription: false,
      totalStock: 5,
      presentations: [
        { id: 1, name: 'Unidad', factor: 1, price: 149, barcode: null, active: true },
      ],
      batches: [
        {
          id: 9,
          lotNumber: null,
          expiresAt: null,
          expiry: null,
          quantity: 5,
          initialQuantity: 5,
          unitCost: 78,
          supplier: 'Accesorios Lima',
          documentNumber: null,
          receivedAt: '2026-10-01T15:00:00Z',
        },
      ],
    });
    const fixture = render('VET', bed);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No vence');
    expect(el.textContent).toContain('Ingresos con stock');
    expect(el.textContent).not.toContain('Lote y vencimiento');
    button(el, 'Registrar compra')!.click();
    fixture.detectChanges();
    // Servidor anterior sin lista de proveedores: el proveedor se escribe como antes
    http
      .expectOne('/api/inventory/suppliers')
      .flush('No existe', { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    await tick();
    expect(el.querySelector('input#pu-sup')).not.toBeNull();
    expect(el.querySelector('#pu-lot')).toBeNull();
    expect(el.querySelector('#pu-exp')).toBeNull();
    expect(el.textContent).toContain('Este producto no vence.');
    const qty = el.querySelector<HTMLInputElement>('#pu-qty')!;
    qty.value = '2';
    qty.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('button[form="purchase-form"]')!.click();
    const req = http.expectOne('/api/inventory/products/5/purchases');
    expect(req.request.body).toMatchObject({ quantity: 2, lotNumber: null, expiresAt: null });
    req.flush(bed);
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
      l.textContent?.includes('Usado en la clínica'),
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

  it('kardex: la venta dice el comprobante y el cliente, no repite el producto', () => {
    const el: HTMLElement = render('VET', product(), [
      {
        id: 1,
        type: 'OUT',
        quantity: -10,
        balanceAfter: 337,
        reason: 'Venta: Meloxicam 1 mg',
        prescriptionRef: null,
        createdAt: '2026-11-22T21:42:00Z',
        batch: { id: 9, lotNumber: 'L-A' },
        user: { fullName: 'Jorge Quispe' },
        vet: null,
        pet: null,
        refType: 'charge',
        sale: { client: 'Alonso Ríos Chávez', document: 'B001-00000060' },
      },
    ]).nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Venta · B001-00000060 · Alonso Ríos Chávez');
    expect(text).not.toContain('Venta: Meloxicam');
  });

  it('salida muestra cuánto hay; el conteo, la diferencia antes de guardar', () => {
    const fixture = render('ADMIN');
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Registrar salida')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-available]')!.textContent).toContain(
      '3 cajas, 4 blísteres y 7 tabletas (347 tabletas)',
    );
    const batch = el.querySelector<HTMLSelectElement>('#ou-batch')!;
    batch.value = batch.options[1].value;
    batch.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('[data-available]')!.textContent).toContain('en Lote L-A');
    el.querySelector<HTMLButtonElement>('dialog[open] .btn-secondary')!.click();
    fixture.detectChanges();
    button(el, 'Conteo físico')!.click();
    fixture.detectChanges();
    const counted = el.querySelector<HTMLInputElement>('#cnt-0')!;
    expect(el.textContent).not.toContain('Diferencia');
    counted.value = '342';
    counted.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('Diferencia: −5 tabletas (se registra el ajuste)');
  });

  it('compra rápida con factura: avisa que se registre en Compras (Excel del contador)', async () => {
    const fixture = render('VET');
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Registrar compra')!.click();
    fixture.detectChanges();
    http.expectOne('/api/inventory/suppliers').flush([]);
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('#pu-doc-hint')).toBeNull();
    const doc = el.querySelector<HTMLInputElement>('#pu-doc')!;
    doc.value = 'F001-123';
    doc.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('#pu-doc-hint')!.textContent).toContain('Excel del contador');
  });
});
