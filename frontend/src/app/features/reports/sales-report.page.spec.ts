import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { reportRange } from '../../core/services/reports.models';
import { limaToday } from '../../shared/utils/dates';
import { SalesReportPage } from './sales-report.page';
import { salesFixture, zeroKpis } from './testing/report-fixtures';

describe('SalesReportPage', () => {
  let http: HttpTestingController;
  const today = limaToday();

  async function setup(url = '/') {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(SalesReportPage);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const sales = (from: string, to: string) =>
    http.expectOne(
      (r) =>
        r.url === '/api/reports/sales' &&
        r.params.get('from') === from &&
        r.params.get('to') === to,
    );
  async function flush(fixture: { detectChanges(): void }) {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
    }
  }

  afterEach(() => http.verify());

  it('muestra los últimos 30 días: indicadores, resumen y secciones nuevas', async () => {
    const { fixture, el } = await setup();
    const r = reportRange('last30', today);
    sales(r.from, r.to).flush(salesFixture());
    await flush(fixture);
    const text = el.textContent ?? '';
    expect(text).toContain('S/ 1,100.00');
    expect(text).toContain('Vendiste 10 % más');
    // El botón del período marcado sin role="radio" (aria-pressed)
    const pressed = el.querySelector('[aria-label="Período"] [aria-pressed="true"]');
    expect(pressed?.textContent?.trim()).toBe('30 días');
    expect(text).toContain('Dra. Lucía Ruiz Paredes');
    expect(text).toContain('Ventas en caja y movilidad de consultas');
    expect(text).toContain('Boletas');
    expect(text).toContain('Perros');
    expect(text).toContain('Rosa Quispe');
    expect(text).toContain('Te deben hoy');
    expect(text).toContain('Más de 30 días');
    expect(el.querySelector('a[href="/cola"]')?.textContent).toContain('1 mascota');
    expect(el.querySelector('a[href="/vacunas"]')?.textContent).toContain('4 mascotas');
    expect(text).toContain('Vendes más los sábados de 10 a 12 h');
    // Indicadores: desde S/ 1,000 sin céntimos; clientes nuevos = primera vez; vuelven = 2 días o más
    const kpis = el.querySelector('[aria-label="Indicadores del período"]')!.textContent!;
    expect(kpis).toContain('S/ 1,100');
    expect(kpis).not.toContain('S/ 1,100.00');
    expect(kpis).toContain('Vinieron por primera vez, de 5 atendidos');
    expect(text).toContain('60 %');
    expect(text).toContain('volvió: 3 de 5 vinieron más de una vez');
  });

  it('sin datos del período anterior lo dice una vez, no en cada tarjeta', async () => {
    const { fixture, el } = await setup();
    const r = reportRange('last30', today);
    sales(r.from, r.to).flush(salesFixture({ previousKpis: zeroKpis }));
    await flush(fixture);
    expect(el.textContent).toContain('Sin ventas en el período anterior');
    expect(el.textContent).not.toContain('Sin datos antes');
  });

  it('al cambiar de período se cancela la consulta vieja y el período queda en la dirección', async () => {
    const { fixture, el } = await setup();
    const r = reportRange('last30', today);
    const old = sales(r.from, r.to);
    const hoy = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Período"] button')].find(
      (b) => b.textContent?.trim() === 'Hoy',
    )!;
    hoy.click();
    await flush(fixture);
    expect(old.cancelled).toBe(true);
    sales(today, today).flush(salesFixture({ from: today, to: today, grain: 'hour' }));
    await flush(fixture);
    expect(TestBed.inject(Router).url).toContain('periodo=hoy');
    expect(el.textContent).toContain('Ventas por hora');
  });

  it('lee fechas libres de la dirección', async () => {
    const { fixture, el } = await setup('/?desde=2026-01-01&hasta=2026-03-31');
    sales('2026-01-01', '2026-03-31').flush(salesFixture({ grain: 'week' }));
    await flush(fixture);
    expect(el.querySelector('button[aria-haspopup="dialog"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('la vista de tabla no necesita moverse de lado: 3 columnas', async () => {
    const { fixture, el } = await setup();
    const r = reportRange('last30', today);
    sales(r.from, r.to).flush(salesFixture());
    await flush(fixture);
    el.querySelector<HTMLButtonElement>('button[aria-label="Ver tabla"]')!.click();
    await flush(fixture);
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll('td').length).toBe(3);
  });

  it('sin ventas muestra una frase y una salida; con error, reintentar', async () => {
    const { fixture, el } = await setup();
    const r = reportRange('last30', today);
    sales(r.from, r.to).flush(salesFixture({ kpis: zeroKpis, previousKpis: zeroKpis }));
    await flush(fixture);
    expect(el.textContent).toContain('Aún no hay ventas en este período');

    const second = await setupError();
    expect(second.el.textContent).toContain('No se pudo calcular el reporte');
    second.el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await flush(second.fixture);
    sales(r.from, r.to).flush(salesFixture());
    await flush(second.fixture);
    expect(second.el.textContent).toContain('S/ 1,100.00');
  });

  async function setupError() {
    const fixture = TestBed.createComponent(SalesReportPage);
    await flush(fixture);
    const r = reportRange('last30', today);
    sales(r.from, r.to).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await flush(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
});
