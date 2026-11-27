import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ClinicalTemplate } from '../../core/services/clinical-templates.service';
import { tick } from '../../shared/testing';
import { TemplatesPage } from './templates.page';

const rxTemplate: ClinicalTemplate = {
  id: 2,
  kind: 'PRESCRIPTION',
  name: 'Gastroenteritis — perro',
  consultation: null,
  prescription: {
    notes: null,
    items: [
      {
        productId: 9,
        presentationId: 90,
        dispenseQuantity: 10,
        drug: 'Metronidazol 250 mg',
        dose: '1 tableta',
        route: 'Oral',
        frequency: 'Cada 12 horas',
        duration: '5 días',
        instructions: null,
      },
      {
        productId: null,
        presentationId: null,
        dispenseQuantity: null,
        drug: 'Probiótico',
        dose: '1 sobre',
        route: 'Oral',
        frequency: 'Cada 24 horas',
        duration: '7 días',
        instructions: null,
      },
    ],
  },
  usageCount: 4,
  createdBy: { id: 1, fullName: 'Dra. Ruiz' },
  updatedAt: '2026-11-10T15:00:00Z',
};

const product = {
  id: 9,
  name: 'Metronidazol 250 mg',
  active: true,
  totalStock: 120,
  baseUnit: 'TABLET',
  presentations: [{ id: 90, name: 'Tableta', active: true, price: 1.5 }],
};

describe('TemplatesPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [TemplatesPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(list: ClinicalTemplate[] = [rxTemplate]) {
    const fixture = TestBed.createComponent(TemplatesPage);
    fixture.detectChanges();
    http.expectOne('/api/clinical-templates').flush(list);
    fixture.detectChanges();
    await tick();
    const el: HTMLElement = fixture.nativeElement;
    const button = (label: string) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
    const type = (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return { fixture, el, button, type };
  }

  it('explica cómo funciona y marca qué medicamentos se cobran', async () => {
    const { fixture, el, button } = await render();
    expect(el.textContent).toContain('Cómo funciona');
    button('Recetas frecuentes').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Del inventario');
    expect(el.textContent).toContain('Externa');
    button('Ocultar').click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Cómo funciona');
  });

  it('una receta frecuente busca en el inventario y queda para entregar y cobrar', async () => {
    const { fixture, el, button, type } = await render([]);
    button('Recetas frecuentes').click();
    fixture.detectChanges();
    button('Nueva receta frecuente').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('La dosis es de referencia');

    type('#tpl-name', 'Gastroenteritis — perro');
    el.querySelector<HTMLInputElement>('#rx-drug-0')!.dispatchEvent(new Event('focus'));
    type('#rx-drug-0', 'metro');
    await new Promise((r) => setTimeout(r, 300));
    http
      .expectOne((r) => r.url === '/api/inventory/products' && r.params.get('q') === 'metro')
      .flush({ items: [product], total: 1, page: 1, pageSize: 20 });
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('#rx-options-0 button')][0].click();
    fixture.detectChanges();
    expect(el.textContent).toContain('se entrega y cobra en la clínica');

    type('#rx-dose-0', '1 tableta');
    type('#rx-freq-0', 'Cada 12 horas');
    type('#rx-dur-0', '5 días');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/clinical-templates' });
    expect(req.request.body.prescription.items[0]).toMatchObject({
      productId: 9,
      presentationId: 90,
      dispenseQuantity: 1,
      drug: 'Metronidazol 250 mg',
      route: 'Oral',
    });
    req.flush({ ...rxTemplate, id: 5 });
  });

  it('escrito a mano queda como receta externa, sin producto', async () => {
    const { fixture, el, button, type } = await render([]);
    button('Recetas frecuentes').click();
    fixture.detectChanges();
    button('Nueva receta frecuente').click();
    fixture.detectChanges();
    type('#tpl-name', 'Otitis');
    type('#rx-drug-0', 'Gotas óticas');
    await new Promise((r) => setTimeout(r, 300));
    http.expectOne((r) => r.url === '/api/inventory/products').flush({ items: [], total: 0 });
    fixture.detectChanges();
    button('como receta externa').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Receta externa: el dueño la compra en farmacia');
    type('#rx-dose-0', '3 gotas');
    type('#rx-freq-0', 'Cada 12 horas');
    type('#rx-dur-0', '7 días');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/clinical-templates' });
    expect(req.request.body.prescription.items[0]).toMatchObject({
      productId: null,
      presentationId: null,
      dispenseQuantity: null,
    });
    req.flush({ ...rxTemplate, id: 6 });
  });

  it('una plantilla de consulta vacía no se envía y dice qué falta; cancelar pide confirmar', async () => {
    const { fixture, el, button, type } = await render([]);
    button('Nueva plantilla').click();
    fixture.detectChanges();
    type('#tpl-name', 'Control sano');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    http.expectNone('/api/clinical-templates');
    expect(el.textContent).toContain('Escribe al menos un campo de la consulta');

    button('Cancelar').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('¿Descartar los cambios?');
    button('Descartar').click();
    fixture.detectChanges();
    expect(el.querySelector('dialog[open]')).toBeNull();
  });

  it('al editar, avisa si un medicamento ya no está en el inventario', async () => {
    const { fixture, el, button } = await render();
    button('Recetas frecuentes').click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>(
      `[aria-label="Abrir plantilla ${rxTemplate.name}"]`,
    )!.click();
    http.expectOne('/api/inventory/products/9').flush('', { status: 404, statusText: 'No' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Ya no está en el inventario');
  });
});
