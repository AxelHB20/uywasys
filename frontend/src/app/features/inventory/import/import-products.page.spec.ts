import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ImportProductsPage } from './import-products.page';

const product = {
  code: 'AMX',
  name: 'Amoxicilina 500 mg',
  category: 'MEDICINE',
  baseUnit: 'TABLET',
  controlled: false,
  igv: 'TAXED',
};
const preview = {
  rows: [
    {
      row: 2,
      key: 'code:AMX',
      product,
      presentation: { name: 'Caja', factor: 100, price: 80, barcode: '7751234' },
      extraLot: false,
      stock: {
        quantity: 2,
        lotNumber: 'L1',
        expiresAt: '2027-12-31',
        cost: 50,
        supplier: 'Droguería Andina',
      },
      status: 'ok',
      errors: [],
      warnings: [],
    },
    {
      row: 4,
      key: 'code:AMX',
      product,
      presentation: { name: 'Caja', factor: 100, price: null, barcode: null },
      extraLot: true,
      stock: { quantity: 1, lotNumber: null, expiresAt: '2026-12-01', cost: null, supplier: null },
      status: 'ok',
      errors: [],
      warnings: ['Sin costo: el margen de este lote saldrá incompleto'],
    },
    {
      row: 3,
      key: 'name:ketamina',
      product: { ...product, code: null, name: 'Ketamina', controlled: true },
      presentation: { name: 'Frasco', factor: 0, price: null, barcode: null },
      extraLot: false,
      stock: null,
      status: 'error',
      errors: ['La equivalencia debe ser un número mayor a 0'],
      warnings: [],
    },
  ],
  summary: {
    rows: 3,
    ok: 2,
    exists: 0,
    errors: 1,
    warnings: 1,
    products: 1,
    presentations: 1,
    batches: 2,
  },
};

describe('ImportProductsPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ImportProductsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('revisa el archivo, muestra los errores por fila e importa sin pedir consentimiento', () => {
    const fixture = TestBed.createComponent(ImportProductsPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const click = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(text),
      )!;

    click('Ya tengo mi archivo').click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#import-file')!;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array(10)], 'stock.xlsx')],
    });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    click('Revisar archivo').click();
    http.expectOne('/api/inventory/import/preview').flush(preview);
    fixture.detectChanges();

    expect(el.textContent).toContain('La equivalencia debe ser un número mayor a 0');
    // Los avisos también salen para revisar, sin impedir importar
    expect(el.textContent).toContain('Para revisar (2)');
    expect(el.textContent).toContain('Lista, con aviso');
    expect(el.textContent).toContain('Sin costo: el margen');
    expect(el.textContent).toContain('Otro lote de esta presentación');
    expect(el.textContent).toContain('Sin lote');
    const heads = [...el.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    expect(heads).toEqual(['Fila', 'Producto', 'Presentación', 'Stock inicial', 'Estado']);
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();

    click('Todas').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('100 tabletas');
    expect(el.textContent).toContain('Lote L1');
    expect(el.textContent).toContain('Cód. barras 7751234');
    expect(el.textContent).toContain('Droguería Andina');

    const importButton = click('Importar 1 producto');
    expect(importButton.disabled).toBe(false);
    importButton.click();
    http
      .expectOne('/api/inventory/import')
      .flush({ products: 1, presentations: 1, batches: 1, skipped: 0, errors: 1 });
    fixture.detectChanges();
    expect(el.textContent).toContain('1 productos');
    expect(el.querySelector('a[href="/inventario"]')).not.toBeNull();
  });
});
