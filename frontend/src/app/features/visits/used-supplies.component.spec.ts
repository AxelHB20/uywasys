import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UsedSuppliesComponent } from './used-supplies.component';

const gloves = {
  id: 9,
  code: null,
  name: 'Guantes de examen talla M',
  category: 'SUPPLY',
  baseUnit: 'UNIT',
  totalStock: 180,
  minStock: 0,
  lowStock: false,
  controlled: false,
  requiresPrescription: false,
  chargeable: false,
  tracksExpiry: true,
  active: true,
  presentations: [{ id: 91, name: 'Caja x 100', factor: 100, price: 35, active: true }],
  nextExpiry: null,
};

describe('UsedSuppliesComponent', () => {
  it('anota un insumo usado sin cobrar: sale del inventario para esta mascota', async () => {
    TestBed.configureTestingModule({
      imports: [UsedSuppliesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    // jsdom no implementa <dialog>
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UsedSuppliesComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('petId', 33);
    fixture.componentRef.setInput('petName', 'Mía');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector<HTMLInputElement>('#us-search')!;
    input.value = 'guantes';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    http
      .expectOne((r) => r.url === '/api/inventory/products' && r.params.get('q') === 'guantes')
      .flush({
        items: [gloves, { ...gloves, id: 10, name: 'Ketamina', controlled: true }],
        total: 2,
      });
    fixture.detectChanges();
    // Los controlados no salen aquí (tienen su propio registro)
    expect(el.textContent).not.toContain('Ketamina');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Guantes'))!.click();
    fixture.detectChanges();
    const qty = el.querySelector<HTMLInputElement>('#us-qty')!;
    qty.value = '2';
    qty.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[form="used-supplies-form"]')!.click();
    const req = http.expectOne('/api/inventory/products/9/outflows');
    expect(req.request.body).toEqual({
      type: 'TREATMENT',
      quantity: 2,
      presentationId: null,
      batchId: null,
      reason: 'Usado en la atención de Mía',
      petId: 33,
      prescriptionRef: null,
    });
    req.flush({});
    fixture.detectChanges();
    expect(el.textContent).toContain('Anotado en esta atención');
    expect(el.textContent).toContain('2 unidades de Guantes de examen talla M');
  });
});
