import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { CareService } from '../../core/services/inventory.models';
import { estimateMessage } from '../../core/services/estimates.models';
import { money } from '../../shared/utils/stock';
import { tick } from '../../shared/testing';
import { NewEstimatePage } from './new-estimate.page';

const surgery: CareService = {
  id: 11,
  name: 'Castración canina',
  category: 'SURGERY',
  price: 400,
  igv: 'TAXED',
  durationMin: 60,
  active: true,
  supplies: [],
} as unknown as CareService;

describe('NewEstimatePage (presupuesto)', () => {
  let http: HttpTestingController;

  it('suma líneas con descuento y emite el presupuesto', async () => {
    TestBed.configureTestingModule({
      imports: [NewEstimatePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NewEstimatePage);
    fixture.componentRef.setInput('petId', '3');
    fixture.componentRef.setInput('mascota', 'Toby');
    fixture.componentRef.setInput('cliente', 'Rosa Quispe');
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/care-services').flush([surgery]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Toby');

    const type = (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('#est-title', 'Castración');
    type('#est-search', 'castra');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http
      .expectOne((r) => r.url === '/api/inventory/products')
      .flush({ items: [], total: 0, page: 1, pageSize: 20 });
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('#est-results button')]
      .find((b) => b.textContent?.includes('Castración canina'))!
      .click();
    fixture.detectChanges();
    type('#est-disc-0', '40');
    fixture.detectChanges();
    expect(el.textContent).toContain('S/ 360.00');

    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Emitir presupuesto'))!
      .click();
    const req = http.expectOne({ method: 'POST', url: '/api/estimates' });
    expect(req.request.body).toEqual({
      petId: 3,
      title: 'Castración',
      validDays: 15,
      notes: null,
      items: [
        {
          careServiceId: 11,
          productId: undefined,
          presentationId: undefined,
          quantity: 1,
          discount: 40,
        },
      ],
    });
    req.flush({ id: 7, code: 'PR-00001' });
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/presupuestos', 7], { replaceUrl: true });
    http.verify();
  });

  it('arma el mensaje de WhatsApp con las líneas y la vigencia', () => {
    const text = estimateMessage(
      {
        code: 'PR-00001',
        title: 'Castración',
        validUntil: '2026-11-13',
        total: 460,
        pet: { name: 'Toby' },
        items: [
          { description: 'Castración canina', total: 400 },
          { description: 'Hemograma', total: 60 },
        ],
      } as never,
      'Vet Sol',
      money,
    );
    expect(text).toContain('presupuesto PR-00001 de Vet Sol para Toby: Castración');
    expect(text).toContain('• Hemograma: S/ 60.00');
    expect(text).toContain('Total: S/ 460.00 (incluye IGV). Válido hasta el 13/11/2026.');
  });
});
