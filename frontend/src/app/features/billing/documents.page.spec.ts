import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { DocumentSummary } from '../../core/services/billing.models';
import { tick } from '../../shared/testing';
import { DocumentsPage } from './documents.page';

const doc = (over: Partial<DocumentSummary>): DocumentSummary => ({
  id: 1,
  type: 'BOLETA',
  code: 'B001-00000001',
  issueDate: '2026-10-28',
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
  pdfUrl: 'https://pse/pdf/1',
  xmlUrl: null,
  cdrUrl: null,
  ...over,
});

describe('DocumentsPage (comprobantes)', () => {
  let http: HttpTestingController;

  async function render(role: 'ADMIN' | 'CASHIER') {
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
    http
      .expectOne((r) => r.url === '/api/billing/documents')
      .flush({
        items: [
          doc({}),
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
        ],
        total: 3,
        page: 1,
        pageSize: 50,
        problems: 2,
      });
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('muestra el estado ante SUNAT, el motivo de cada problema y lo que anula cada nota', async () => {
    const el: HTMLElement = (await render('CASHIER')).nativeElement;
    const text = el.textContent!;
    expect(text).toContain('2 comprobantes con problemas');
    expect(text).toContain('Aceptado por SUNAT');
    expect(text).toContain('El PSE no respondió: ECONNREFUSED');
    expect(text).toContain('El comprobante no existe');
    expect(text).toContain('anula B001-00000001');
    expect(text).toContain('−S/ 50.00');
    // La caja ve todo, pero reintentar y el Excel son del administrador
    expect(text).not.toContain('Reintentar');
    expect(text).not.toContain('Excel para el contador');
  });

  it('el administrador reintenta un envío y descarga el Excel del periodo', async () => {
    const fixture = await render('ADMIN');
    const el: HTMLElement = fixture.nativeElement;
    const retry = [...el.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('Reintentar'),
    );
    expect(retry).toHaveLength(1);
    retry[0].click();
    http.expectOne({ method: 'POST', url: '/api/billing/documents/2/retry' }).flush(doc({ id: 2 }));

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
});
