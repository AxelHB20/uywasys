import {
  addMonths,
  bucketLabels,
  bucketize,
  compactMoney,
  cumulativeTrend,
  daysBetween,
  delta,
  expiryLabel,
  niceScale,
  rangeIssue,
  rangeLabel,
  reasonLabel,
  quantityLabel,
  rangeError,
  reportRange,
  sortMargin,
  stockLabel,
} from './reports.models';

describe('reports.models', () => {
  it('períodos rápidos: hoy, 7 días, este mes, el pasado y el año', () => {
    expect(reportRange('today', '2026-11-01')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(reportRange('last7', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(reportRange('last30', '2026-11-01')).toEqual({ from: '2026-10-03', to: '2026-11-01' });
    expect(reportRange('month', '2026-11-18')).toEqual({ from: '2026-11-01', to: '2026-11-18' });
    expect(reportRange('lastMonth', '2026-03-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(reportRange('year', '2026-11-01')).toEqual({ from: '2026-01-01', to: '2026-11-01' });
    expect(reportRange('last12', '2026-11-24')).toEqual({ from: '2025-11-25', to: '2026-11-24' });
    expect(reportRange('lastYear', '2026-11-24')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(365);
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('la variación contra el período anterior', () => {
    expect(delta(110, 100)).toEqual({ percent: 10, trend: 'up' });
    expect(delta(75, 100)).toEqual({ percent: -25, trend: 'down' });
    expect(delta(100, 100)).toEqual({ percent: 0, trend: 'flat' });
    expect(delta(50, 0)).toEqual({ percent: null, trend: 'up' });
    expect(delta(0, 0)).toEqual({ percent: null, trend: 'flat' });
  });

  it('etiquetas de cada grupo según cómo agrupó el servidor', () => {
    const b = (key: string, from: string, to = from) => ({ key, from, to });
    expect(bucketLabels('hour', b('08', '2026-11-24'))).toEqual({
      label: '8 h',
      title: 'De 8 a 9 h',
    });
    expect(bucketLabels('day', b('2026-11-24', '2026-11-24')).title).toBe(
      'Martes, 24 de noviembre',
    );
    expect(bucketLabels('week', b('2026-11-16', '2026-11-16', '2026-11-22')).title).toBe(
      '16 nov – 22 nov',
    );
    expect(bucketLabels('month', b('2026-11', '2026-11-01', '2026-11-30')).title).toBe(
      'Noviembre de 2026',
    );
    const r = bucketize({
      grain: 'day',
      from: '2026-11-23',
      to: '2026-11-24',
      series: [
        {
          key: '2026-11-23',
          from: '2026-11-23',
          to: '2026-11-23',
          services: 10.1,
          products: 5.2,
          collected: 3,
          visits: 1,
          receipts: 1,
          averageTicket: 3,
        },
        {
          key: '2026-11-24',
          from: '2026-11-24',
          to: '2026-11-24',
          services: 0,
          products: 0,
          collected: 0,
          visits: 0,
          receipts: 0,
          averageTicket: 0,
        },
      ],
    });
    expect(r[0]).toMatchObject({ label: '23 nov', total: 15.3, collected: 3 });
  });

  it('cifras cortas para ejes y el centro de la dona', () => {
    expect(compactMoney(850)).toBe('S/ 850');
    expect(compactMoney(1_250)).toContain('mil');
    expect(compactMoney(1_287_115)).toMatch(/^S\/ 1[.,]29 M$/);
    expect(reasonLabel('cliente frecuente')).toBe('Cliente frecuente');
    expect(reasonLabel('')).toBe('Sin motivo');
  });

  it('una escala redonda para el eje', () => {
    expect(niceScale(930)).toEqual({ max: 1000, step: 250, ticks: [0, 250, 500, 750, 1000] });
    expect(niceScale(14_200).max).toBe(15_000);
    expect(niceScale(0).ticks).toEqual([0, 25, 50, 75, 100]);
  });

  it('cantidades con su unidad', () => {
    expect(quantityLabel({ kind: 'SERVICE', quantity: 1, unit: null })).toBe('1 vez');
    expect(quantityLabel({ kind: 'SERVICE', quantity: 12, unit: null })).toBe('12 veces');
    expect(quantityLabel({ kind: 'PRODUCT', quantity: 3, unit: 'TABLET' })).toBe('3 tabletas');
    expect(quantityLabel({ kind: 'PRODUCT', quantity: 250, unit: 'ML' })).toBe('250 ml');
  });
});

describe('reports.models · margen e inventario', () => {
  const row = (name: string, revenue: number, margin: number | null) => ({
    kind: 'PRODUCT' as const,
    id: 1,
    name,
    category: null,
    quantity: 1,
    unit: null,
    revenue,
    cost: margin === null ? null : revenue - margin,
    margin,
    marginPercent: margin === null ? null : Math.round((margin / revenue) * 1000) / 10,
  });

  it('ordena por margen y deja al final lo que no tiene costo', () => {
    const rows = [row('A', 100, 10), row('B', 50, null), row('C', 80, 40)];
    expect(sortMargin(rows, 'margin').map((r) => r.name)).toEqual(['C', 'A', 'B']);
    expect(sortMargin(rows, 'margin', false).map((r) => r.name)).toEqual(['A', 'C', 'B']);
    expect(sortMargin(rows, 'marginPercent').map((r) => r.name)).toEqual(['C', 'A', 'B']);
    expect(sortMargin(rows, 'name', false).map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('textos de vencimiento y stock', () => {
    expect(expiryLabel(-1)).toBe('Venció hace 1 día');
    expect(expiryLabel(0)).toBe('Vence hoy');
    expect(expiryLabel(24)).toBe('Vence en 24 días');
    expect(stockLabel(1, 'UNIT')).toBe('1 unidad');
    expect(stockLabel(400, 'ML')).toBe('400 ml');
  });

  it('el rango elegido a mano: hasta 2 años, y cómo arreglarlo', () => {
    expect(rangeError('2026-11-02', '2026-11-01')).toContain('antes');
    expect(rangeError('2024-11-24', '2026-11-24')).toBeNull();
    expect(rangeError('2024-11-23', '2026-11-24')).toContain('2 años');
    expect(rangeIssue('2026-11-02', '2026-11-01', '2026-11-24')).toEqual({ kind: 'reversed' });
    expect(rangeIssue('2023-05-01', '2026-11-24', '2026-11-24')).toEqual({
      kind: 'tooLong',
      length: '3 años y 6 meses',
      lastTwoYears: { from: '2024-11-24', to: '2026-11-24' },
      fromStart: { from: '2023-05-01', to: '2025-04-30' },
    });
    expect(rangeLabel('2026-10-26', '2026-11-24')).toBe('26 oct – 24 nov 2026');
    expect(rangeLabel('2024-11-24', '2026-11-24')).toBe('24 nov 2024 – 24 nov 2026');
  });

  it('acumula día a día y alinea por día del mes', () => {
    const points = cumulativeTrend({
      from: '2026-03-01',
      to: '2026-03-02',
      previous: { from: '2026-02-01', to: '2026-02-02' },
      kpis: {} as never,
      previousKpis: {} as never,
      days: [
        { day: '2026-03-01', collected: 100 },
        { day: '2026-03-02', collected: 50.5 },
      ],
      previousDays: [
        { day: '2026-02-01', collected: 80 },
        { day: '2026-02-02', collected: 0 },
        { day: '2026-02-03', collected: 20 },
      ],
    });
    expect(points).toEqual([
      { day: 1, current: 100, previous: 80 },
      { day: 2, current: 150.5, previous: 80 },
      { day: 3, current: null, previous: 100 },
    ]);
  });
});
