import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { InventoryPage } from './inventory.page';

describe('InventoryPage (lista)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InventoryPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'a@uywa.pe',
      role: 'RECEPTION',
      mustChangePassword: false,
    } as never);
  });

  afterEach(() => http.verify());

  it('lista productos con stock legible, semáforo y alertas; recepción no crea productos', async () => {
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    http
      .expectOne('/api/inventory/alerts')
      .flush({ expired: 1, red: 2, yellow: 3, lowStock: 4, batches: [], low: [] });
    http
      .expectOne((r) => r.url === '/api/inventory/products')
      .flush({
        items: [
          {
            id: 5,
            code: null,
            name: 'Meloxicam 1 mg',
            category: 'MEDICINE',
            baseUnit: 'TABLET',
            totalStock: 120,
            minStock: 20,
            lowStock: false,
            controlled: true,
            requiresPrescription: true,
            active: true,
            presentations: [
              { id: 1, name: 'Caja x 100', factor: 100, price: 150, barcode: null, active: true },
              { id: 3, name: 'Tableta', factor: 1, price: 2, barcode: null, active: true },
            ],
            nextExpiry: { date: '2026-11-15', days: 19, level: 'RED', lotNumber: 'L-A' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('1 caja y 20 tabletas');
    expect(text).toContain('Vence en 19 días');
    expect(text).toContain('Controlado');
    expect(text).toContain('S/ 2.00 · Tableta');
    expect(text).toContain('Con stock bajo');
    expect(text).not.toContain('Nuevo producto');
  });
});
