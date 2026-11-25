import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { EstimatePrint } from '../../core/services/estimates.models';
import { tick } from '../../shared/testing';
import { EstimatePage } from './estimate.page';

const accepted: EstimatePrint = {
  id: 7,
  code: 'PR-00007',
  title: 'Castración canina',
  validUntil: '2099-01-01',
  notes: null,
  status: 'ACCEPTED',
  total: 350,
  taxable: 296.61,
  igv: 53.39,
  createdAt: '2026-11-06T15:00:00Z',
  decidedAt: '2026-11-06T16:00:00Z',
  decisionNote: null,
  visitId: null,
  convertedAt: null,
  pet: { id: 3, number: 3, name: 'Toby', species: 'DOG', breed: null, weightKg: null },
  client: { id: 2, name: 'Rosa Quispe', phone: '987654321', docType: null, docNumber: null },
  createdBy: { id: 1, fullName: 'Dra. Ruiz', licenseNumber: null },
  decidedBy: { id: 1, fullName: 'Dra. Ruiz' },
  items: [],
  clinic: { name: 'Huellitas', ruc: null, address: null, phone: null, logoUrl: null },
};

describe('EstimatePage (cargar un presupuesto aceptado)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      imports: [EstimatePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 9,
      fullName: 'Carmen',
      email: 'c@uywa.pe',
      role: 'RECEPTION',
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(EstimatePage);
    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    http.expectOne('/api/estimates/7').flush(accepted);
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Cargar a la atención'))!
      .click();
    fixture.detectChanges();
    return { fixture, el };
  }

  afterEach(() => http.verify());

  it('sin atención abierta no abre una por su cuenta: manda la mascota a la cola de hoy', async () => {
    const { fixture, el } = await render();
    http
      .expectOne((r) => r.url === '/api/visits' && r.params.get('petId') === '3')
      .flush({ items: [], total: 0, page: 1, pageSize: 20 });
    fixture.detectChanges();
    expect(el.textContent).toContain('Toby aún no está en atención');
    const send = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Mandar a la cola de hoy'),
    )!;
    send.click();
    const req = http.expectOne('/api/queue');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      petId: 3,
      urgent: false,
      reason: 'PR-00007 · Castración canina',
    });
    req.flush({ id: 1 });
    http.expectNone((r) => r.url.includes('/convert'));
  });

  it('con la atención que abrió el veterinario, carga el presupuesto en ella', async () => {
    const { fixture, el } = await render();
    http
      .expectOne((r) => r.url === '/api/visits')
      .flush({
        items: [
          {
            id: 40,
            openedAt: '2026-11-07T14:00:00Z',
            reason: 'PR-00007 · Castración canina',
            attendedBy: { id: 1, fullName: 'Dra. Ruiz' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Cargar S/ 350.00'))!
      .click();
    const req = http.expectOne('/api/estimates/7/convert');
    expect(req.request.body).toMatchObject({ visitId: 40 });
    req.flush({ ...accepted, status: 'CONVERTED', visitId: 40 });
  });
});
