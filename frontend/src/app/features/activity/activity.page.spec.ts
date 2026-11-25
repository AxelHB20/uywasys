import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ActivityItem,
  ActivityReview,
  activityIp,
  activityTitle,
  describeActivity,
} from '../../core/services/activity.models';
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
  let review: ActivityReview = { from: '2026-10-15', to: '2026-10-21', total: 0, kinds: [] };

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
      { id: 4, fullName: 'Técnico', active: true, support: true },
    ]);
    http.expectOne('/api/activity/review').flush(review);
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
    // La cuenta de soporte no aparece en el filtro de persona
    expect(text).not.toContain('Técnico');
    expect(text).toContain('Nada para revisar en los últimos 7 días');
    // Dos días distintos en hora de Lima
    expect(el.querySelectorAll('ol.card').length).toBe(2);
    expect(el.querySelector('a[href="/caja/tickets/44"]')).not.toBeNull();
  });

  it('los filtros viajan a la API: área, Revisar y una tarjeta de "Para revisar" (7 días)', async () => {
    review = {
      from: '2026-10-15',
      to: '2026-10-21',
      total: 3,
      kinds: [
        { kind: 'closings', count: 2 },
        { kind: 'voids', count: 1 },
      ],
    };
    const fixture = render();
    const empty = { items: [], total: 0, page: 1, pageSize: 50 };
    http.expectOne((r) => r.url === '/api/activity').flush(empty);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Todavía no hay actividad registrada');
    expect(el.textContent).toContain('2 cierres con diferencia');
    expect(el.textContent).toContain('1 anulación');

    const button = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent!.replace(/\s+/g, ' ').trim().startsWith(text),
      )!;
    button('Caja').click();
    fixture.detectChanges();
    await tick();
    let req = http.expectOne((r) => r.url === '/api/activity');
    expect(req.request.params.get('area')).toBe('cash');
    expect(req.request.params.has('important')).toBe(false);
    req.flush(empty);

    button('Revisar').click();
    fixture.detectChanges();
    await tick();
    req = http.expectOne((r) => r.url === '/api/activity');
    expect(req.request.params.get('important')).toBe('true');
    expect(req.request.params.has('area')).toBe(false);
    req.flush(empty);

    button('2 cierres con diferencia').click();
    fixture.detectChanges();
    await tick();
    req = http.expectOne((r) => r.url === '/api/activity');
    expect(req.request.params.get('kind')).toBe('closings');
    expect(req.request.params.has('from')).toBe(true);
    expect(req.request.params.has('page')).toBe(false);
    req.flush(empty);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Nada con esos filtros');
    review = { from: '2026-10-15', to: '2026-10-21', total: 0, kinds: [] };
  });

  it('junta 3 o más iguales seguidas en una fila que se abre', async () => {
    const fixture = render();
    const login = (id: string, at: string) =>
      item({ id, at, action: 'auth.login', entity: 'user', entityId: '2', ip: '190.1.1.1' });
    http
      .expectOne((r) => r.url === '/api/activity')
      .flush({
        items: [
          login('13', '2026-10-21T14:30:00Z'),
          login('12', '2026-10-21T14:20:00Z'),
          login('11', '2026-10-21T14:10:00Z'),
        ],
        total: 3,
        page: 1,
        pageSize: 50,
      });
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Inició sesión · 3 veces');
    const toggle = el.querySelector<HTMLButtonElement>('[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.textContent).toContain('conexión 190.1.1.1');
  });

  it('la conexión se muestra limpia y no se muestra si es interna', () => {
    const at = { action: 'auth.login' };
    expect(activityIp({ ...at, ip: '::ffff:190.43.12.8' })).toBe('190.43.12.8');
    expect(activityIp({ ...at, ip: '::ffff:172.20.0.4' })).toBeNull();
    expect(activityIp({ ...at, ip: '192.168.1.20' })).toBeNull();
    expect(activityIp({ action: 'client.create', ip: '190.43.12.8' })).toBeNull();
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
    expect(describeActivity({ outcome: 'DISCHARGED', days: 2 })).toEqual([
      'Salida: Alta',
      'Días internado: 2',
    ]);
    expect(activityTitle({ action: 'hospitalization.discharge', user: null })).toBe(
      'Dio de alta a una mascota internada',
    );
  });
});
