import { InventoryReportPage } from './inventory-report.page';
import { inventoryFixture } from './testing/report-fixtures';
import { mountReport, settle } from './testing/page-harness';

describe('InventoryReportPage', () => {
  async function setup() {
    const m = await mountReport(InventoryReportPage);
    m.http.expectOne('/api/reports/inventory').flush(inventoryFixture());
    await settle(m.fixture);
    return m;
  }

  it('las tarjetas llevan al inventario filtrado y avisa de los desactivados con stock', async () => {
    const { el, http } = await setup();
    const links = [...el.querySelectorAll<HTMLAnchorElement>('ul[aria-label="Totales"] a')].map(
      (a) => a.getAttribute('href'),
    );
    expect(links).toEqual([
      '/inventario',
      '/inventario?filtro=expired',
      '/inventario?filtro=exp30',
      '/reportes/inventario#sin-movimiento',
    ]);
    expect(el.textContent).toContain('Incluye 1 producto desactivado que aún tiene stock');
    expect(el.querySelector('a[href="/inventario?estado=inactivos"]')).not.toBeNull();
    http.verify();
  });

  it('qué vence, para cuántos días alcanza, por reponer y lotes con qué hacer', async () => {
    const { el, http } = await setup();
    const text = el.textContent ?? '';
    expect(text).toContain('Vacuna triple felina');
    expect(text).toContain('úsalo primero o pide cambio al proveedor');
    expect(text).toContain('160 días');
    expect(text).toContain('~6 por semana');
    expect(text).toContain('Dar de baja');
    expect(text).toContain('Usar primero');
    expect(text).toContain('El almacén se renueva cada');
    http.verify();
  });

  it('con error ofrece reintentar', async () => {
    const m = await mountReport(InventoryReportPage);
    m.http.expectOne('/api/reports/inventory').flush({}, { status: 500, statusText: 'x' });
    await settle(m.fixture);
    expect(m.el.textContent).toContain('No se pudo calcular el reporte');
    m.el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await settle(m.fixture);
    m.http.expectOne('/api/reports/inventory').flush(inventoryFixture());
    await settle(m.fixture);
    expect(m.el.textContent).toContain('S/ 1,000.00');
  });
});
