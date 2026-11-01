import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Shortage } from '../../core/services/inventory.models';
import { stubDialog, tick } from '../../shared/testing';
import { ShortagesPanelComponent } from './shortages-panel.component';

const shortage: Shortage = {
  id: 5,
  product: { id: 9, name: 'Champú clorhexidina', baseUnit: 'ML' },
  quantity: 30,
  createdAt: '2026-10-28T18:39:00Z',
  charge: { id: 3, description: 'Baño medicado', visitId: 12, pet: { id: 2, name: 'Toby' } },
  resolvedAt: null,
  resolution: null,
};

describe('ShortagesPanelComponent (faltantes)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  async function render(canResolve: boolean, items: Shortage[] = [shortage]) {
    TestBed.configureTestingModule({
      imports: [ShortagesPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ShortagesPanelComponent);
    fixture.componentRef.setInput('canResolve', canResolve);
    fixture.detectChanges();
    http.expectOne('/api/inventory/shortages').flush(items);
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('sin faltantes no ocupa espacio', async () => {
    const el: HTMLElement = (await render(true, [])).nativeElement;
    expect(el.querySelector('#faltantes')).toBeNull();
  });

  it('muestra qué faltó, en qué atención y cuándo; el veterinario no lo resuelve', async () => {
    const el: HTMLElement = (await render(false)).nativeElement;
    const text = el.querySelector('#faltantes')!.textContent!;
    expect(text).toContain('Champú clorhexidina');
    expect(text).toContain('Faltaron 30 ml');
    expect(text).toContain('Baño medicado');
    expect(text).toContain('Toby');
    expect(text).toContain('28/10/2026 · 13:39');
    expect(el.querySelector('[aria-label^="Resolver"]')).toBeNull();
  });

  it('el administrador lo resuelve anotando qué se hizo', async () => {
    const fixture = await render(true);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>(
      '[aria-label="Resolver faltante de Champú clorhexidina"]',
    )!.click();
    fixture.detectChanges();
    await tick();
    const confirm = () =>
      [...el.querySelectorAll<HTMLButtonElement>('dialog[open] button')]
        .find((b) => b.textContent?.includes('Marcar como resuelto'))!
        .click();
    confirm();
    fixture.detectChanges();
    http.expectNone('/api/inventory/shortages/5/resolve');
    expect(el.textContent).toContain('Escribe entre 3 y 200 caracteres');

    const input = el.querySelector<HTMLInputElement>('#shortage-note')!;
    input.value = 'Se registró la compra F001-123';
    input.dispatchEvent(new Event('input'));
    confirm();
    const req = http.expectOne('/api/inventory/shortages/5/resolve');
    expect(req.request.body).toEqual({ resolution: 'Se registró la compra F001-123' });
    req.flush({ id: 5 });
    await tick();
    http.expectOne('/api/inventory/shortages').flush([]);
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('#faltantes')).toBeNull();
  });
});
