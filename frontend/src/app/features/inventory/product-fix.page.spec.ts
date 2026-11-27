import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ProductFixPage } from './product-fix.page';
import { readSuggestions } from './stock-suggestions';

describe('ProductFixPage (corregir productos)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ProductFixPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('pone Trae = 1, cambia Unidad por Frasco, deja de ser insumo y pasa el 3 a Cargar stock', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductFixPage);
    fixture.detectChanges();
    http.expectOne('/api/inventory/product-fixes').flush({
      items: [
        {
          id: 7,
          name: 'Shampoo Alerdog',
          category: 'HYGIENE',
          baseUnit: 'UNIT',
          totalStock: 0,
          canChangeUnit: true,
          presentation: { id: 70, name: 'Unidad', factor: 3 },
          supplyWithPrice: true,
        },
        {
          id: 8,
          name: 'Hemovitab',
          category: 'MEDICINE',
          baseUnit: 'BOTTLE',
          totalStock: 5,
          canChangeUnit: false,
          presentation: { id: 80, name: 'Frasco', factor: 192 },
          supplyWithPrice: false,
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('«Unidad» dice que trae 3 unidades');
    expect(text).toContain('El 3 pasa a Cargar stock');
    expect(text).toContain('Ya tiene stock');
    expect(el.querySelector('#fix-unit-8')).toBeNull();
    const unit = el.querySelector<HTMLSelectElement>('#fix-unit-7')!;
    unit.value = 'BOTTLE';
    unit.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.btn-primary')!.click();
    const req = http.expectOne('/api/inventory/product-fixes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.items).toEqual([
      { productId: 7, presentationId: 70, baseUnit: 'BOTTLE', sellable: true },
      { productId: 8, presentationId: 80 },
    ]);
    req.flush({ fixed: 2, suggestions: [{ productId: 7, presentationId: 70, quantity: 3 }] });
    await fixture.whenStable();
    expect(readSuggestions()).toEqual([{ productId: 7, presentationId: 70, quantity: 3 }]);
    expect(navigate).toHaveBeenCalledWith('/inventario/cargar-stock');
  });
});
