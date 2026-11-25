import { reportRange } from '../../core/services/reports.models';
import { limaToday } from '../../shared/utils/dates';
import { ControlReportPage } from './control-report.page';
import { controlFixture } from './testing/report-fixtures';
import { mountReport, settle } from './testing/page-harness';

describe('ControlReportPage', () => {
  it('descuentos, anulaciones, cierres, mermas, personas y cambios de precio', async () => {
    const { el, fixture, http } = await mountReport(ControlReportPage);
    const r = reportRange('last30', limaToday());
    http
      .expectOne((q) => q.url === '/api/reports/control' && q.params.get('from') === r.from)
      .flush(controlFixture());
    await settle(fixture);
    const text = el.textContent ?? '';
    expect(text).toContain('S/ 30.00');
    expect(text).toContain('−S/ 7.00');
    expect(text).toContain('2 de 10 cierres con diferencia');
    expect(text).toContain('Carmen dio el 100 % de los descuentos');
    expect(text).toContain('Cliente frecuente');
    expect(text).toContain('Ningún descuento pasó el tope. El más alto fue de 8 %');
    expect(text).toContain('Cargo quitado: Hemograma');
    expect(text).toContain('“Vuelto mal dado”');
    expect(text).toContain('Bajas (vencido, roto, perdido)');
    expect(text).toContain('Jorge Quispe Rojas');
    expect(text).toContain('S/ 50.00 → S/ 60.00');
    expect(el.querySelector('a[href="/caja/cierres/1"]')).not.toBeNull();
    // Descuentos que suben son malos: la variación sale en rojo
    expect(el.querySelector('app-delta span')?.className).toContain('rose');
    http.verify();
  });

  it('con Hoy y sin cierres lo dice con una frase', async () => {
    const today = limaToday();
    const { el, fixture, http } = await mountReport(ControlReportPage, '/?periodo=hoy');
    http
      .expectOne((q) => q.url === '/api/reports/control' && q.params.get('from') === today)
      .flush(
        controlFixture({
          grain: 'hour',
          kpis: { ...controlFixture().kpis, cashSessions: 0, cashWithDifference: 0, cashNet: 0 },
        }),
      );
    await settle(fixture);
    expect(el.textContent).toContain('Sin cierres en el período');
    expect(el.textContent).toContain('la tendencia aparece desde 7 días');
    http.verify();
  });
});
