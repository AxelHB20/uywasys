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
            tracksExpiry: true,
            active: true,
            presentations: [
              { id: 1, name: 'Caja x 100', factor: 100, price: 150, barcode: null, active: true },
              { id: 3, name: 'Tableta', factor: 1, price: 2, barcode: null, active: true },
            ],
            nextExpiry: { date: '2026-11-15', days: 19, level: 'RED', lotNumber: 'L-A' },
          },
          {
            id: 6,
            code: null,
            name: 'Cama ortopédica M',
            category: 'ACCESSORY',
            baseUnit: 'UNIT',
            totalStock: 5,
            minStock: 2,
            lowStock: false,
            controlled: false,
            requiresPrescription: false,
            tracksExpiry: false,
            active: true,
            presentations: [
              { id: 7, name: 'Unidad', factor: 1, price: 149, barcode: null, active: true },
            ],
            nextExpiry: null,
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('1 caja y 20 tabletas');
    // El total en la unidad mínima debajo de las cajas; la cama no lo repite
    expect(text).toContain('120 tabletas');
    expect(text).not.toContain('5 unidades5 unidades');
    expect(text).not.toContain('Con receta');
    expect(text).toContain('Vence en 19 días');
    expect(text).toContain('No vence');
    expect(text).toContain('Psicotrópico (DIGEMID)');
    expect(text).toContain('S/ 2.00Tableta');
    expect(text).toContain('Con stock bajo');
    expect(text).not.toContain('Nuevo producto');
    // Recepción no ve el filtro de inactivos
    expect(fixture.nativeElement.querySelector('#inv-status')).toBeNull();
    // Cada tarjeta filtra lo suyo y solo esa se marca
    const cards = [
      ...fixture.nativeElement.querySelectorAll('[aria-pressed]'),
    ] as HTMLButtonElement[];
    expect(cards.map((c) => c.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
    ]);
  });
});
