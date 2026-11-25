import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { Supplier } from '../../core/services/purchases.models';
import { SuppliersPage } from './suppliers.page';

function supplier(over: Partial<Supplier>): Supplier {
  return {
    id: 3,
    name: 'Droguería Andina S.A.C.',
    ruc: '20131312955',
    contact: 'Luis Rojas',
    phone: '987654321',
    email: null,
    notes: null,
    active: true,
    purchases: 4,
    lastPurchaseAt: '2026-11-10',
    ...over,
  };
}

describe('SuppliersPage (Proveedores)', () => {
  let http: HttpTestingController;

  function render(role: 'ADMIN' | 'VET', list: Supplier[]) {
    TestBed.configureTestingModule({
      imports: [SuppliersPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role,
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(SuppliersPage);
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/inventory/suppliers');
    expect(req.request.params.get('all')).toBe('true');
    req.flush(list);
    fixture.detectChanges();
    return fixture;
  }
  const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');

  afterEach(() => http.verify());

  it('el administrador ve lo comprado en el año y puede unir repetidos; los inactivos van aparte', async () => {
    const fixture = render('ADMIN', [
      supplier({ yearTotal: 4580.2 }),
      supplier({
        id: 4,
        name: 'Drog. Andina',
        ruc: null,
        phone: null,
        purchases: 0,
        active: false,
        yearTotal: 0,
      }),
    ]);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const t = text(el.querySelector('ul[aria-label="Proveedores"]')!);
    expect(t).toContain('Droguería Andina S.A.C.');
    expect(t).toContain('RUC 20131312955');
    expect(t).toContain('S/ 4,580.20');
    expect(t).toContain('4 compras');
    expect(t).not.toContain('Drog. Andina');
    expect(text(el)).toContain('Mostrar inactivos (1)');
    // El celular abre WhatsApp
    expect(el.querySelector('a[href="https://wa.me/51987654321"]')).not.toBeNull();
    const unir = [...el.querySelectorAll('ul[aria-label="Proveedores"] button')].filter(
      (b) => b.textContent?.trim() === 'Unir',
    );
    expect(unir.length).toBe(1);
  });

  it('el veterinario no ve montos ni unir; agrega un proveedor validando el RUC', async () => {
    const fixture = render('VET', [supplier({})]);
    const el: HTMLElement = fixture.nativeElement;
    expect(text(el)).not.toContain('En el año');
    expect(
      [...el.querySelectorAll('ul[aria-label="Proveedores"] button')].some(
        (b) => b.textContent?.trim() === 'Unir',
      ),
    ).toBe(false);

    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Nuevo proveedor'))!
      .click();
    fixture.detectChanges();
    await fixture.whenStable();
    const set = (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('#sup-name', 'Agrovet del Centro E.I.R.L.');
    set('#sup-ruc', '20123456780');
    el.querySelector<HTMLFormElement>('#supplier-form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    http.expectNone('/api/inventory/suppliers');
    expect(text(el)).toContain('El RUC no es válido');

    set('#sup-ruc', '20131312955');
    set('#sup-phone', '01 456 7890');
    el.querySelector<HTMLFormElement>('#supplier-form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/inventory/suppliers');
    expect(req.request.body).toMatchObject({
      name: 'Agrovet del Centro E.I.R.L.',
      ruc: '20131312955',
      phone: '014567890',
    });
    req.flush(supplier({ id: 9, name: 'Agrovet del Centro E.I.R.L.' }));
    // Se vuelve a pedir la lista
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/inventory/suppliers').flush([]);
  });
});
