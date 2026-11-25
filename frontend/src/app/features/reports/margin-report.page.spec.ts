import { reportRange } from '../../core/services/reports.models';
import { limaToday } from '../../shared/utils/dates';
import { MarginReportPage } from './margin-report.page';
import { marginFixture } from './testing/report-fixtures';
import { buttonByText, mountReport, settle } from './testing/page-harness';

describe('MarginReportPage', () => {
  async function setup() {
    const m = await mountReport(MarginReportPage);
    const r = reportRange('last30', limaToday());
    m.http
      .expectOne((q) => q.url === '/api/reports/margin' && q.params.get('from') === r.from)
      .flush(marginFixture());
    await settle(m.fixture);
    return m;
  }

  it('totales, resumen, precios a revisar y lo que no tiene costo', async () => {
    const { el, http } = await setup();
    const text = el.textContent ?? '';
    expect(text).toContain('Margen bruto');
    // Leyenda visible: barras en soles y línea de % (colores distintos)
    expect(el.querySelector('[aria-label="Leyenda"]')?.textContent).toContain('% de margen');
    expect(text).toContain('S/ 623.00');
    expect(text).toContain('Fluidoterapia se vende a pérdida');
    expect(text).toContain('Los descuentos te restaron S/ 11.80');
    // Revisa estos precios: la pérdida primero, con precio y costo por unidad
    const review = [...el.querySelectorAll('a[href="/servicios"], a[href^="/inventario/"]')].map(
      (a) => a.textContent ?? '',
    );
    expect(review[0]).toContain('Fluidoterapia');
    expect(review[0]).toContain('Sale a S/ 40.00 sin IGV · cuesta S/ 45.00');
    expect(review.some((t) => t.includes('Alimento 3 kg'))).toBe(true);
    expect(text).toContain('Collar');
    http.verify();
  });

  it('el detalle se busca, se ordena y muestra 8 con “Ver los N restantes”', async () => {
    const { el, fixture, http } = await setup();
    const rows = () => el.querySelectorAll('table tbody tr');
    expect(rows().length).toBe(8);
    buttonByText(el, 'Ver los 3 restantes')!.click();
    await settle(fixture);
    expect(rows().length).toBe(11);
    const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'fluido';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(rows().length).toBe(1);
    // Ordenar por nombre y luego en sentido contrario
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    const nameHeader = el.querySelector<HTMLButtonElement>('th button')!;
    nameHeader.click();
    await settle(fixture);
    expect(el.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending');
    expect(rows()[0].textContent).toContain('Consulta general');
    // Pestaña productos
    buttonByText(el, 'Productos')!.click();
    await settle(fixture);
    expect(rows()[0].textContent).toMatch(/Alimento 3 kg|Collar/);
    http.verify();
  });
});
