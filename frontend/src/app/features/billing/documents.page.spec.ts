import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { DocumentSummary } from '../../core/services/billing.models';
import { tick } from '../../shared/testing';
import { DocumentsPage } from './documents.page';

/** Del mes en curso: "Cambiar a factura" solo vale dentro del mes de la boleta */
const thisMonth = new Date().toISOString().slice(0, 8) + '01';
const doc = (over: Partial<DocumentSummary>): DocumentSummary => ({
  id: 1,
  type: 'BOLETA',
  code: 'B001-00000001',
  issueDate: thisMonth,
  customerDocType: '1',
  customerDocNumber: '45678912',
  customerName: 'Rosa Peña',
  total: 50,
  status: 'ACCEPTED',
  provider: 'NUBEFACT',
  attempts: 1,
  nextAttemptAt: null,
  lastError: null,
  sunatDescription: null,
  receiptId: 4,
  related: null,
  annulledBy: null,
  pdfUrl: 'https://pse/pdf/1',
  xmlUrl: null,
  cdrUrl: null,
  replacedAt: null,
  ...over,
});

describe('DocumentsPage (comprobantes)', () => {
  let http: HttpTestingController;
  // jsdom no implementa <dialog>
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  async function render(role: 'ADMIN' | 'CASHIER', extra: DocumentSummary[] = []) {
    TestBed.configureTestingModule({
      imports: [DocumentsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'a@uywa.pe',
      role,
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(DocumentsPage);
    fixture.detectChanges();
    http
      .expectOne('/api/billing/status')
      .flush({ enabled: true, provider: 'NUBEFACT', production: true, simulated: false });
    const list = http.expectOne((r) => r.url === '/api/billing/documents');
    // Abre en "Este mes"
    expect(list.request.params.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    list.flush({
      items: [
        doc({ annulledBy: { code: 'BC01-00000001', date: '2026-10-29' } }),
        doc({ id: 4, code: 'B001-00000004', total: 80 }),
        doc({
          id: 2,
          code: 'B001-00000002',
          status: 'ERROR',
          attempts: 3,
          lastError: 'El PSE no respondió: ECONNREFUSED',
          nextAttemptAt: '2026-10-28T23:00:00Z',
          pdfUrl: null,
        }),
        doc({
          id: 3,
          type: 'CREDIT_NOTE',
          code: 'BC01-00000001',
          related: 'B001-00000001',
          status: 'REJECTED',
          sunatDescription: 'El comprobante no existe',
        }),
        ...extra,
      ],
      total: 4,
      page: 1,
      pageSize: 50,
      problems: 2,
      summary: {
        boletas: { count: 3, amount: 180 },
        facturas: { count: 0, amount: 0 },
        creditNotes: { count: 1, amount: 50 },
        annulled: 1,
        net: 130,
      },
    });
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('muestra el resumen, el estado ante SUNAT, las anuladas y lo que anula cada nota', async () => {
    const el: HTMLElement = (await render('CASHIER')).nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('2 comprobantes con problemas');
    expect(text).toContain('S/ 130.00'); // ventas netas
    expect(text).toContain('1 comprobante anulado');
    expect(text).toContain('Aceptado por SUNAT');
    expect(text).toContain('Anulado');
    expect(text).toContain('Con BC01-00000001');
    expect(text).toContain('El PSE no respondió: ECONNREFUSED');
    expect(text).toContain('El comprobante no existe');
    expect(text).toContain('Anula B001-00000001');
    expect(text).toContain('−S/ 50.00');
    // La caja ve todo, pero reintentar y el Excel son del administrador
    expect(text).not.toContain('Reintentar');
    expect(text).not.toContain('Excel para el contador');
    expect(text).toContain(
      'Corrige los rechazados; si es un error de envío, avisa al administrador',
    );
    // Simulado o no, el verde es solo para "Aceptado por SUNAT"; el filtro de tipo no son pestañas
    expect(el.querySelector('[role="tab"]')).toBeNull();
    expect(el.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Todos');
  });

  it('rechazado por SUNAT: la caja lo corrige con el DNI y se emite otro comprobante', async () => {
    const fixture = await render('CASHIER', [
      doc({
        id: 7,
        code: 'B001-00000007',
        status: 'REJECTED',
        sunatDescription: 'El DNI no es válido',
        customerDocNumber: '45678913',
        pdfUrl: null,
      }),
      doc({
        id: 8,
        code: 'B001-00000008',
        status: 'REJECTED',
        replacedAt: '2026-11-20T15:00:00Z',
        pdfUrl: null,
      }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    // El ya corregido no se corrige otra vez
    expect(el.querySelector('[aria-label="Corregir y emitir de nuevo B001-00000008"]')).toBeNull();
    expect(text).toContain('Rechazado · corregido');
    expect(text).toContain('Se emitió otro comprobante para este cobro');
    el.querySelector<HTMLButtonElement>(
      '[aria-label="Corregir y emitir de nuevo B001-00000007"]',
    )!.click();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('El DNI no es válido');
    const input = dialog.querySelector<HTMLInputElement>('#buyer-doc')!;
    expect(input.value).toBe('45678913');
    input.value = '45678912';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    http.match((r) => r.url === '/api/billing/lookup').forEach((r) => r.flush(null));
    fixture.detectChanges();
    Array.from(dialog.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Emitir de nuevo'))!
      .click();
    const req = http.expectOne('/api/billing/documents/7/reissue');
    expect(req.request.body.buyer).toMatchObject({ docType: 'DNI', docNumber: '45678912' });
    req.flush({ id: 9, code: 'B001-00000009' });
    await tick();
    http
      .expectOne((r) => r.url === '/api/billing/documents')
      .flush({ items: [], total: 0, page: 1, pageSize: 50, problems: 0, summary: null });
  });

  it('⋯: "Cambiar a factura" solo en el mes de la boleta; "Anular cobro…" solo el administrador', async () => {
    const fixture = await render('ADMIN', [
      doc({ id: 6, code: 'B001-00000006', issueDate: '2025-01-15', pdfUrl: null }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-controls="doc-menu-6"]')!.click();
    fixture.detectChanges();
    let menu = el.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain('Solo dentro del mes de la boleta');
    expect(menu.querySelector('a[href="/caja/tickets/4"]')?.textContent).toContain('Anular cobro');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    // La del mes: el PDF del PSE y el cambio a factura
    el.querySelector<HTMLButtonElement>('[aria-controls="doc-menu-4"]')!.click();
    fixture.detectChanges();
    menu = el.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain('PDF del PSE');
    expect(menu.querySelector('button')?.textContent).toContain('Cambiar a factura');
  });

  it('el administrador reintenta un envío y descarga el Excel del periodo', async () => {
    const fixture = await render('ADMIN');
    const el: HTMLElement = fixture.nativeElement;
    const retry = [...el.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === 'Reintentar',
    );
    expect(retry).toHaveLength(1);
    retry[0].click();
    http.expectOne({ method: 'POST', url: '/api/billing/documents/2/retry' }).flush(doc({ id: 2 }));

    // Tras actualizar el token: todos los que no se pudieron enviar, de una vez
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Reintentar todos'))!
      .click();
    http.expectOne({ method: 'POST', url: '/api/billing/documents/retry-all' }).flush({ count: 3 });

    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Excel para el contador'))!
      .click();
    fixture.detectChanges();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Descargar Excel'))!
      .click();
    const req = http.expectOne((r) => r.url === '/api/billing/report');
    expect(req.request.params.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    req.flush(new Blob(['x']));
    expect(create).toHaveBeenCalled();
  });

  it('tocar la nota de crédito de una anulada la busca en todo el historial', async () => {
    const fixture = await render('CASHIER');
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>(
      '[aria-label="Ver la nota de crédito BC01-00000001"]',
    )!.click();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 350)); // la búsqueda espera a que se deje de escribir
    const req = http.expectOne((r) => r.url === '/api/billing/documents');
    expect(req.request.params.get('q')).toBe('BC01-00000001');
    expect(req.request.params.has('from')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 50, problems: 0, summary: null });
  });

  it('una boleta vigente se cambia por factura: pide el RUC y emite nota de crédito + factura', async () => {
    const fixture = await render('CASHIER');
    const el: HTMLElement = fixture.nativeElement;
    // La anulada no tiene "Cambiar a factura" (su ⋯ solo trae el PDF); la vigente sí
    el.querySelector<HTMLButtonElement>('[aria-controls="doc-menu-1"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')!.textContent).not.toContain('Cambiar a factura');
    el.querySelector<HTMLButtonElement>('[aria-controls="doc-menu-4"]')!.click();
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((b) => b.textContent?.includes('Cambiar a factura'))!
      .click();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Se anula B001-00000004');
    const emit = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Emitir factura'),
    )!;
    emit.click();
    http.expectNone((r) => r.url.includes('/factura'));
    const set = (id: string, value: string) => {
      const input = dialog.querySelector<HTMLInputElement>(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('#buyer-doc', '20601847834');
    await new Promise((r) => setTimeout(r, 300));
    http.expectOne((r) => r.url === '/api/billing/lookup').flush(null);
    fixture.detectChanges();
    expect(dialog.textContent).toContain('No aparece en SUNAT');
    set('#buyer-name', 'OSYS COMPANY S.A.C.');
    emit.click();
    const req = http.expectOne('/api/billing/documents/4/factura');
    expect(req.request.body.buyer).toMatchObject({
      docType: 'RUC',
      docNumber: '20601847834',
      name: 'OSYS COMPANY S.A.C.',
      save: false,
    });
    req.flush({ id: 9, code: 'F001-00000003' });
    fixture.detectChanges();
    await tick();
    // Recarga la lista
    http
      .expectOne((r) => r.url === '/api/billing/documents')
      .flush({
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        problems: 0,
        summary: null,
      });
  });
});
