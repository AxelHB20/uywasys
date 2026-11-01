import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionService } from '../../core/auth/session.service';
import { CareService } from '../../core/services/inventory.models';
import { stubDialog } from '../../shared/testing';
import { CareServicesPage } from './care-services.page';

const castration: CareService = {
  id: 1,
  name: 'Castración felina',
  category: 'SURGERY',
  price: 180,
  igv: 'TAXED',
  durationMin: 90,
  active: true,
  sizePrices: [],
  supplies: [
    { productId: 7, name: 'Ketamina 50 mg/ml', baseUnit: 'ML', quantity: 2, controlled: true },
  ],
};
const consult: CareService = {
  id: 2,
  name: 'Consulta general',
  category: 'CONSULTATION',
  price: 50,
  igv: 'TAXED',
  durationMin: 30,
  active: true,
  sizePrices: [],
  supplies: [],
};

describe('CareServicesPage', () => {
  let http: HttpTestingController;
  const isAdmin = signal(true);

  beforeAll(stubDialog);

  beforeEach(() => {
    isAdmin.set(true);
    TestBed.configureTestingModule({
      imports: [CareServicesPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { isAdmin } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(CareServicesPage);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne((r) => r.url === '/api/care-services').flush([castration, consult]);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('agrupa por categoría y muestra precio, duración e insumos', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    const headings = [...el.querySelectorAll('h2')].map((h) => h.textContent?.trim() ?? '');
    expect(headings[0]).toContain('Consultas');
    expect(headings[1]).toContain('Cirugías y procedimientos');
    expect(el.textContent).toContain('S/ 180.00');
    expect(el.textContent).toContain('1 h 30 min');
    expect(el.textContent).toContain('Ketamina 50 mg/ml · 2 ml');
  });

  it('el personal que no es administrador solo consulta', async () => {
    isAdmin.set(false);
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    const buttons = [...el.querySelectorAll('button')].filter((b) => !b.closest('dialog'));
    expect(buttons.some((b) => b.textContent?.includes('Nuevo servicio'))).toBe(false);
    expect(el.querySelector('[aria-label^="Editar"]')).toBeNull();
  });

  it('valida y crea un servicio con un insumo', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Nuevo servicio'))!
      .click();
    fixture.detectChanges();

    const submit = () =>
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('Crear servicio'))!
        .click();
    submit();
    fixture.detectChanges();
    expect(el.textContent).toContain('Escribe el nombre');
    expect(el.textContent).toContain('Elige la categoría');

    const set = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('#svc-name', 'Vacuna triple felina');
    set('#svc-price', '65');
    [...el.querySelectorAll('label')]
      .find((l) => l.textContent?.trim() === 'Vacunación')!
      .querySelector('input')!
      .click();

    set('#sup-search', 'jer');
    await new Promise((resolve) => setTimeout(resolve, 300));
    http
      .expectOne((r) => r.url === '/api/inventory/products')
      .flush({
        items: [{ id: 9, name: 'Jeringa 3 ml', code: null, baseUnit: 'UNIT' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Jeringa 3 ml'))!
      .click();
    fixture.detectChanges();
    set('#sup-qty-0', '1');
    fixture.detectChanges();

    submit();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/care-services');
    expect(req.request.body).toEqual({
      name: 'Vacuna triple felina',
      category: 'VACCINATION',
      price: 65,
      igv: 'TAXED',
      durationMin: null,
      supplies: [{ productId: 9, quantity: 1 }],
      sizePrices: [],
    });
    req.flush({ ...consult, id: 3, name: 'Vacuna triple felina', category: 'VACCINATION' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Vacuna triple felina');
  });
});
