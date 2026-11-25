import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { PurchasePage, PurchaseSummary } from '../../core/services/purchases.models';
import { PurchasesPage } from './purchases.page';

function row(over: Partial<PurchaseSummary>): PurchaseSummary {
  return {
    id: 1,
    number: 1,
    code: 'CO-00001',
    supplier: { id: 3, name: 'Droguería Andina S.A.C.', ruc: '20131312955' },
    docType: 'FACTURA',
    docNumber: 'F001-00123',
    issuedAt: '2026-11-10',
    createdAt: '2026-11-10T15:00:00Z',
    status: 'RECEIVED',
    lines: 3,
    subtotal: 300,
    igv: 54,
    total: 354,
    hasFile: false,
    ...over,
  };
}

describe('PurchasesPage (Compras)', () => {
  let http: HttpTestingController;

  function render(role: 'ADMIN' | 'VET') {
    TestBed.configureTestingModule({
      imports: [PurchasesPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role,
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(PurchasesPage);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/inventory/suppliers').flush([]);
    return fixture;
  }
  const list = () => http.expectOne((r) => r.url === '/api/inventory/purchases');
  const page = (p: Partial<PurchasePage>): PurchasePage => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    ...p,
  });
  const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');

  afterEach(() => http.verify());

  it('lista las fichas recientes con su total; el administrador ve el resumen y el Excel', async () => {
    const fixture = render('ADMIN');
    const req = list();
    // Por defecto, los últimos 90 días (a inicio de mes "Este mes" saldría vacío)
    expect(req.request.params.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(req.request.params.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    req.flush(
      page({
        items: [
          row({ hasFile: true }),
          row({ id: 2, code: 'CO-00002', docNumber: 'F001-9', status: 'VOIDED', total: 50 }),
        ],
        total: 2,
        summary: { count: 1, subtotal: 300, igv: 54, total: 354 },
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const rows = [...el.querySelectorAll<HTMLAnchorElement>('ul[aria-label="Compras"] a')];
    expect(rows[0].getAttribute('href')).toBe('/inventario/compras/1');
    expect(text(rows[0])).toContain('Factura F001-00123');
    expect(text(rows[0])).toContain('Droguería Andina S.A.C.');
    expect(text(rows[0])).toContain('S/ 354.00');
    expect(text(rows[1])).toContain('Anulada');
    expect(rows[1].getAttribute('aria-label')).toContain('anulada');
    expect(text(el)).toContain('1 compra · S/ 354.00');
    expect(text(el)).toContain('Excel para el contador');
  });

  it('el veterinario no ve totales del período ni el Excel; busca por número', async () => {
    const fixture = render('VET');
    list().flush(page({ items: [row({})], total: 1 }));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(text(el)).not.toContain('Excel para el contador');
    const input = el.querySelector<HTMLInputElement>('#pu-q')!;
    input.value = 'f001-123';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    fixture.detectChanges();
    const req = list();
    expect(req.request.params.get('q')).toBe('f001-123');
    req.flush(page({}));
  });

  it('si el servidor falla, ofrece reintentar', async () => {
    const fixture = render('VET');
    list().flush('error', { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar las compras.');
  });
});
