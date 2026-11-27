import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { ProductSummary } from '../../core/services/inventory.models';
import { PurchaseFormPage, lineAmounts } from './purchase-form.page';

const amoxi: ProductSummary = {
  id: 7,
  code: 'AMX',
  name: 'Amoxicilina 500 mg',
  category: 'MEDICINE',
  baseUnit: 'TABLET',
  totalStock: 40,
  minStock: 100,
  lowStock: true,
  controlled: false,
  requiresPrescription: true,
  tracksExpiry: true,
  igv: 'TAXED',
  active: true,
  presentations: [
    { id: 70, name: 'Caja x 100', factor: 100, price: 118, barcode: '775001', active: true },
    { id: 71, name: 'Tableta', factor: 1, price: 1.5, barcode: null, active: true },
  ],
  nextExpiry: null,
};

describe('lineAmounts (igual que el servidor)', () => {
  it('sin IGV suma el 18 %; con IGV lo separa; lo exonerado no lleva IGV', () => {
    expect(lineAmounts(5, 40, false, 'TAXED')).toEqual({ taxable: 200, igv: 36, total: 236 });
    expect(lineAmounts(2, 59, true, 'TAXED')).toEqual({ taxable: 100, igv: 18, total: 118 });
    expect(lineAmounts(3, 10.5, true, 'EXEMPT')).toEqual({ taxable: 31.5, igv: 0, total: 31.5 });
  });
});

describe('PurchaseFormPage (Recibir compra)', () => {
  let http: HttpTestingController;
  const DRAFT = 'uywa:compra-borrador:1';

  function render(draft?: unknown) {
    localStorage.clear();
    if (draft) localStorage.setItem(DRAFT, JSON.stringify(draft));
    TestBed.configureTestingModule({
      imports: [PurchaseFormPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role: 'VET',
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(PurchaseFormPage);
    fixture.detectChanges();
    http
      .expectOne('/api/inventory/suppliers')
      .flush([{ id: 3, name: 'Droguería Andina S.A.C.', ruc: '20131312955', active: true }]);
    http.expectOne('/api/inventory/shortages').flush([]);
    fixture.detectChanges();
    return fixture;
  }

  const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
  const set = (el: HTMLElement, sel: string, value: string, event = 'input') => {
    const input = el.querySelector<HTMLInputElement>(sel)!;
    input.value = value;
    input.dispatchEvent(new Event(event));
  };

  async function addAmoxi(fixture: ReturnType<typeof render>) {
    const el: HTMLElement = fixture.nativeElement;
    set(el, '#pl-search', '775001');
    await new Promise((r) => setTimeout(r, 250));
    const req = http.expectOne((r) => r.url === '/api/inventory/products');
    expect(req.request.params.get('q')).toBe('775001');
    req.flush({ items: [amoxi], total: 1, page: 1, pageSize: 20 });
    fixture.detectChanges();
    // El lector de código de barras termina con Enter: entra el producto de ese código
    el.querySelector('#pl-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    http.expectOne('/api/inventory/products/7/last-cost').flush({
      unitCost: 0.32,
      supplier: 'Droguería Andina S.A.C.',
      receivedAt: '2026-10-01T15:00:00Z',
    });
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('pasa la ficha: busca por código, calcula totales, margen y última compra, y guarda todo junto', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    // Un solo proveedor: ya queda elegido
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector<HTMLSelectElement>('#pf-supplier')!.selectedIndex).toBe(1);
    set(el, '#pf-number', 'F001-00456');
    await addAmoxi(fixture);

    expect(text(el)).toContain('Amoxicilina 500 mg');
    // La presentación más grande va primero (las compras suelen venir en cajas)
    expect(el.querySelector<HTMLSelectElement>('#pl-pres-0')!.selectedIndex).toBe(0);
    set(el, '#pl-qty-0', '5');
    set(el, '#pl-lot-0', 'a23b');
    set(el, '#pl-exp-0', '03/2028');
    set(el, '#pl-price-0', '40');
    fixture.detectChanges();
    await fixture.whenStable();

    const t = text(el);
    expect(t).toContain('Entran 500 tabletas');
    expect(t).toContain('Última compra: S/ 32.00');
    expect(t).toContain('sube 25 %');
    // Vende a 118 con IGV (100 sin IGV) y la caja cuesta 40 sin IGV: margen 60 %
    expect(t).toContain('Vendes a S/ 118.00 · margen 60 %');
    expect(t).toContain('S/ 236.00');

    set(el, '#pf-paper', '236');
    fixture.detectChanges();
    expect(text(el)).toContain('Cuadra con la ficha');
    set(el, '#pf-paper', '250');
    fixture.detectChanges();
    expect(text(el)).toContain('No cuadra');

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLFormElement>('#purchase-form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    const req = http.expectOne('/api/inventory/purchases');
    expect(req.request.body).toEqual({
      supplierId: 3,
      docType: 'FACTURA',
      docNumber: 'F001-00456',
      issuedAt: expect.any(String),
      notes: null,
      pricesIncludeIgv: false,
      settleShortages: false,
      lines: [
        {
          productId: 7,
          presentationId: 70,
          quantity: 5,
          unitPrice: 40,
          lotNumber: 'a23b',
          expiresAt: '2028-03-31',
        },
      ],
    });
    req.flush({ id: 12, code: 'CO-00012', lines: 1, settledShortages: 0 });
    await new Promise((r) => setTimeout(r));
    expect(navigate).toHaveBeenCalledWith(['/inventario/compras', 12], { replaceUrl: true });
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it('no guarda sin vencimiento (el lote de un medicamento es opcional) y lo marca en la línea', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    set(el, '#pf-number', 'F001-1');
    await addAmoxi(fixture);
    set(el, '#pl-qty-0', '1');
    set(el, '#pl-price-0', '40');
    el.querySelector<HTMLFormElement>('#purchase-form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectNone('/api/inventory/purchases');
    expect(text(el)).not.toContain('Falta el lote');
    expect(text(el)).toContain('Falta el vencimiento');
  });

  it('una boleta propone precios con IGV', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const type = el.querySelector<HTMLSelectElement>('#pf-type')!;
    type.value = type.options[1].value;
    type.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const checked = el.querySelector('[role="radiogroup"] [aria-checked="true"]');
    expect(checked?.textContent?.trim()).toBe('Con IGV');
  });

  it('recupera el borrador que quedó sin guardar y se puede descartar', () => {
    const fixture = render({
      savedAt: '2026-11-12T15:30:00Z',
      header: {
        supplierId: 3,
        docType: 'FACTURA',
        docNumber: 'F001-777',
        issuedAt: '2026-11-12',
        pricesIncludeIgv: false,
        notes: '',
        paperTotal: null,
      },
      lines: [
        {
          product: {
            id: 7,
            name: 'Amoxicilina 500 mg',
            baseUnit: 'TABLET',
            tracksExpiry: true,
            controlled: false,
            igv: 'TAXED',
            presentations: amoxi.presentations,
          },
          presentationId: 70,
          quantity: 2,
          lotNumber: 'L1',
          expiresAt: '2028-01-31',
          unitPrice: 40,
        },
      ],
    });
    http.expectOne('/api/inventory/products/7/last-cost').flush(null);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(text(el)).toContain('Recuperamos la ficha que dejaste sin guardar');
    expect(el.querySelector<HTMLInputElement>('#pf-number')!.value).toBe('F001-777');
    expect(el.querySelector<HTMLInputElement>('#pl-qty-0')!.value).toBe('2');
    expect(text(el)).toContain('S/ 94.40');

    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Empezar de cero'))!
      .click();
    fixture.detectChanges();
    expect(el.querySelector('#pl-qty-0')).toBeNull();
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it('si la ficha ya estaba registrada, muestra el aviso del servidor', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    set(el, '#pf-number', 'F001-00456');
    await addAmoxi(fixture);
    set(el, '#pl-qty-0', '1');
    set(el, '#pl-lot-0', 'L');
    set(el, '#pl-exp-0', '03/2028');
    set(el, '#pl-price-0', '40');
    el.querySelector<HTMLFormElement>('#purchase-form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    http
      .expectOne('/api/inventory/purchases')
      .flush(
        { message: 'Esta ficha ya se registró como CO-00003 el 10/11/2026' },
        { status: 409, statusText: 'Conflict' },
      );
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('CO-00003');
  });
});
