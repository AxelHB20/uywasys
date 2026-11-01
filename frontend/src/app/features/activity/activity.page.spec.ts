import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivityItem, describeActivity } from '../../core/services/activity.models';
import { tick } from '../../shared/testing';
import { ActivityPage } from './activity.page';

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  id: '1',
  at: '2026-10-20T20:00:00Z',
  action: 'client.create',
  entity: 'client',
  entityId: '3',
  data: null,
  ip: null,
  important: false,
  user: { id: 2, fullName: 'Rosa' },
  ...over,
});

describe('ActivityPage (bitácora)', () => {
  let http: HttpTestingController;

  function render() {
    TestBed.configureTestingModule({
      imports: [ActivityPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ActivityPage);
    fixture.detectChanges();
    http.expectOne('/api/users').flush([
      { id: 2, fullName: 'Rosa', active: true },
      { id: 3, fullName: 'Luis', active: false },
    ]);
    return fixture;
  }

  afterEach(() => http.verify());

  it('muestra cada acción en palabras, con autor, detalle legible y la marca Revisar', async () => {
    const fixture = render();
    http
      .expectOne((r) => r.url === '/api/activity')
      .flush({
        items: [
          item({
            id: '9',
            at: '2026-10-21T14:05:00Z',
            action: 'cash.receipt_void',
            entity: 'receipt',
            entityId: '44',
            important: true,
            data: { code: 'NV-000002', total: 80, reason: 'Cobro duplicado' },
          }),
          item({
            id: '8',
            at: '2026-10-21T13:00:00Z',
            action: 'auth.login_failed',
            user: null,
            ip: '190.1.2.3',
            entity: 'user',
            entityId: null,
          }),
          item({ id: '7' }),
        ],
        total: 3,
        page: 1,
        pageSize: 50,
      });
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!;
    expect(text).toContain('Anuló un cobro');
    expect(text).toContain('Revisar');
    expect(text).toContain('Comprobante: NV-000002');
    expect(text).toContain('Total: S/ 80.00');
    expect(text).toContain('Motivo: Cobro duplicado');
    expect(text).toContain('Correo desconocido');
    expect(text).toContain('conexión 190.1.2.3');
    expect(text).toContain('Luis (inactivo)');
    // Dos días distintos en hora de Lima
    expect(el.querySelectorAll('h2').length).toBe(2);
    expect(el.querySelector('a[href="/caja/tickets/44"]')).not.toBeNull();
  });

  it('los filtros viajan a la API y vuelven a la primera página', async () => {
    const fixture = render();
    http
      .expectOne((r) => r.url === '/api/activity')
      .flush({ items: [], total: 0, page: 1, pageSize: 50 });
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Todavía no hay actividad registrada');

    const area = el.querySelector<HTMLSelectElement>('#act-area')!;
    area.value = area.options[2].value; // Caja
    area.dispatchEvent(new Event('change'));
    const important = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    important.click();
    fixture.detectChanges();
    await tick();
    const req = http.expectOne((r) => r.url === '/api/activity' && r.params.has('important'));
    expect(req.request.params.get('area')).toBe('cash');
    expect(req.request.params.get('important')).toBe('true');
    expect(req.request.params.has('page')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Nada con esos filtros');
    http.match(() => true).forEach((r) => r.flush({ items: [], total: 0, page: 1, pageSize: 50 }));
  });
});

describe('describeActivity', () => {
  it('cambios de precio y de usuario como antes → ahora, sin ids técnicos', () => {
    expect(describeActivity({ presentation: 'Tableta', before: 2, after: 2.5 })).toEqual([
      'Precio: S/ 2.00 → S/ 2.50',
      'Presentación: Tableta',
    ]);
    expect(
      describeActivity({
        role: { antes: 'RECEPTION', ahora: 'CASHIER' },
        active: { antes: true, ahora: false },
      }),
    ).toEqual(['Rol: Recepción → Caja', 'Activo: Sí → No']);
    expect(
      describeActivity({
        code: 'NV-1',
        clientId: 7,
        paid: 50,
        payments: [{ method: 'YAPE', amount: 50 }],
      }),
    ).toEqual(['Comprobante: NV-1', 'Pagado: S/ 50.00', 'Pagos: Yape S/ 50.00']);
    expect(describeActivity(null)).toEqual([]);
  });
});
