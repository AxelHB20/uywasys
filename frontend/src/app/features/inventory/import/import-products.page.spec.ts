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
};
const preview = {
  rows: [
    {
      row: 2,
      key: 'code:AMX',
      product,
      presentation: { name: 'Caja', factor: 100, price: 80 },
      stock: { quantity: 2, lotNumber: 'L1', expiresAt: '2027-12-31', cost: 50 },
      status: 'ok',
      errors: [],
    },
    {
      row: 3,
      key: 'name:ketamina',
      product: { ...product, code: null, name: 'Ketamina', controlled: true },
      presentation: { name: 'Frasco', factor: 0, price: null },
      stock: null,
      status: 'error',
      errors: ['La equivalencia debe ser un número mayor a 0'],
    },
  ],
  summary: { rows: 2, ok: 1, exists: 0, errors: 1, products: 1, presentations: 1, batches: 1 },
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
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();

    click('Todas').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('100 tabletas');
    expect(el.textContent).toContain('Lote L1');

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
