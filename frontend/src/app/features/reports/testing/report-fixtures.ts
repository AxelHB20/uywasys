import {
  ControlReport,
  InventoryReport,
  MarginReport,
  MarginRow,
  SalesKpis,
  SalesReport,
} from '../../../core/services/reports.models';

export const zeroKpis: SalesKpis = {
  sold: 0,
  pending: 0,
  collected: 0,
  receipts: 0,
  averageTicket: 0,
  visits: 0,
  newClients: 0,
  firstTime: 0,
};

/** Reporte de ventas de 2 días con un poco de todo */
export function salesFixture(over: Partial<SalesReport> = {}): SalesReport {
  return {
    from: '2026-10-30',
    to: '2026-10-31',
    previous: { from: '2026-10-28', to: '2026-10-29' },
    kpis: {
      sold: 1100,
      pending: 100,
      collected: 1000,
      receipts: 10,
      averageTicket: 100,
      visits: 8,
      newClients: 2,
      firstTime: 2,
    },
    previousKpis: {
      ...zeroKpis,
      sold: 1000,
      collected: 1250,
      receipts: 10,
      averageTicket: 125,
      visits: 8,
    },
    grain: 'day',
    series: [
      {
        key: '2026-10-30',
        from: '2026-10-30',
        to: '2026-10-30',
        services: 600,
        products: 200,
        collected: 700,
        visits: 5,
        receipts: 6,
        averageTicket: 116.67,
      },
      {
        key: '2026-10-31',
        from: '2026-10-31',
        to: '2026-10-31',
        services: 200,
        products: 100,
        collected: 300,
        visits: 3,
        receipts: 4,
        averageTicket: 75,
      },
    ],
    previousSeries: [
      { key: '2026-10-28', sold: 500 },
      { key: '2026-10-29', sold: 500 },
    ],
    categories: [
      { kind: 'SERVICE', category: 'CONSULTATION', amount: 800, lines: 8 },
      { kind: 'PRODUCT', category: 'ANTIPARASITIC', amount: 300, lines: 4 },
    ],
    items: [
      {
        kind: 'SERVICE',
        id: 1,
        name: 'Consulta general',
        category: 'CONSULTATION',
        quantity: 8,
        unit: null,
        amount: 800,
      },
      {
        kind: 'PRODUCT',
        id: 2,
        name: 'Pipeta antipulgas',
        category: 'ANTIPARASITIC',
        quantity: 4,
        unit: 'UNIT',
        amount: 300,
      },
    ],
    professionals: [
      {
        user: { id: 7, fullName: 'Dra. Lucía Ruiz Paredes', role: 'VET' },
        visits: 6,
        services: 700,
        products: 100,
        amount: 800,
      },
      { user: null, visits: 0, services: 0, products: 300, amount: 300 },
    ],
    methods: [
      { method: 'CASH', amount: 600, payments: 6 },
      { method: 'YAPE', amount: 400, payments: 4 },
    ],
    heatmap: [
      { dow: 6, hour: 10, amount: 700 },
      { dow: 5, hour: 16, amount: 400 },
    ],
    species: [
      { species: 'DOG', amount: 800, pets: 4 },
      { species: null, amount: 300, pets: 0 },
    ],
    documents: [
      { type: 'BOLETA', count: 9, amount: 900 },
      { type: 'FACTURA', count: 1, amount: 100 },
      { type: 'CREDIT_NOTE', count: 0, amount: 0 },
    ],
    topClients: [{ client: { id: 3, name: 'Rosa Quispe' }, amount: 300, visits: 2, pets: 1 }],
    clients: {
      total: 5,
      newOnes: 2,
      repeat: 3,
      series: [
        { key: '2026-10-30', returning: 2, newOnes: 1 },
        { key: '2026-10-31', returning: 1, newOnes: 1 },
      ],
    },
    receivables: {
      total: 100,
      clients: 1,
      aging: { upTo7: 60, upTo30: 0, older: 40 },
      top: [
        {
          client: { id: 3, name: 'Rosa Quispe' },
          amount: 100,
          charges: 2,
          oldestAt: '2026-09-01T15:00:00Z',
        },
      ],
    },
    transport: {
      amount: 45,
      count: 3,
      byType: [{ transport: 'ROUND_TRIP', count: 3 }],
      pendingHome: 1,
    },
    months: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      sold: i === 9 ? 1100 : 500,
      previous: 400,
    })),
    overdueBoosters: 4,
    ...over,
  };
}

const row = (o: Partial<MarginRow>): MarginRow => ({
  kind: 'SERVICE',
  id: 1,
  name: 'Consulta general',
  category: 'CONSULTATION',
  quantity: 10,
  unit: null,
  revenue: 500,
  cost: 0,
  margin: 500,
  marginPercent: 100,
  ...o,
});

export function marginFixture(over: Partial<MarginReport> = {}): MarginReport {
  const services = [
    row({}),
    row({
      id: 2,
      name: 'Fluidoterapia',
      category: 'TREATMENT',
      quantity: 2,
      revenue: 80,
      cost: 90,
      margin: -10,
      marginPercent: -12.5,
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      row({
        id: 10 + i,
        name: `Servicio ${i + 1}`,
        revenue: 10 + i,
        cost: 1,
        margin: 9 + i,
        marginPercent: 90,
      }),
    ),
  ];
  const products = [
    row({
      kind: 'PRODUCT',
      id: 5,
      name: 'Alimento 3 kg',
      category: 'FOOD',
      unit: 'UNIT',
      quantity: 4,
      revenue: 200,
      cost: 180,
      margin: 20,
      marginPercent: 10,
    }),
    row({
      kind: 'PRODUCT',
      id: 6,
      name: 'Collar',
      category: 'ACCESSORY',
      unit: 'UNIT',
      quantity: 1,
      revenue: 30,
      cost: null,
      margin: null,
      marginPercent: null,
    }),
  ];
  const t = (revenue: number, cost: number, rowsWithoutCost = 0, revenueWithoutCost = 0) => ({
    revenue,
    revenueWithCost: revenue - revenueWithoutCost,
    cost,
    margin: revenue - revenueWithoutCost - cost,
    marginPercent:
      Math.round(((revenue - revenueWithoutCost - cost) / (revenue - revenueWithoutCost)) * 1000) /
      10,
    rowsWithoutCost,
    revenueWithoutCost,
  });
  return {
    from: '2026-10-01',
    to: '2026-10-31',
    services,
    products,
    totals: { services: t(702, 99), products: t(230, 180, 1, 30), all: t(932, 279, 1, 30) },
    previous: { from: '2026-09-01', to: '2026-09-30' },
    previousTotals: { revenue: 800, margin: 500, marginPercent: 70 },
    grain: 'day',
    series: [
      {
        key: '2026-10-01',
        from: '2026-10-01',
        to: '2026-10-01',
        revenue: 400,
        margin: 300,
        marginPercent: 75,
      },
      {
        key: '2026-10-02',
        from: '2026-10-02',
        to: '2026-10-02',
        revenue: 532,
        margin: 323,
        marginPercent: 64.6,
      },
    ],
    discounts: 11.8,
    ...over,
  };
}

export function inventoryFixture(over: Partial<InventoryReport> = {}): InventoryReport {
  return {
    day: '2026-11-24',
    idleDays: 60,
    totals: {
      value: 1000,
      products: 3,
      batchesWithoutCost: 0,
      lowStock: 1,
      expired: 48,
      expiring30: 120,
      expiring60: 0,
      idle: 200,
    },
    categories: [
      { category: 'ANTIPARASITIC', value: 600, products: 1 },
      { category: 'VACCINE', value: 400, products: 2 },
    ],
    products: [
      {
        id: 1,
        name: 'Antipulgas masticable',
        category: 'ANTIPARASITIC',
        unit: 'TABLET',
        stock: 60,
        value: 600,
        stockWithoutCost: 0,
        lowStock: false,
        active: true,
      },
      {
        id: 2,
        name: 'Vacuna antirrábica',
        category: 'VACCINE',
        unit: 'UNIT',
        stock: 20,
        value: 300,
        stockWithoutCost: 0,
        lowStock: false,
        active: true,
      },
      {
        id: 3,
        name: 'Guantes',
        category: 'VACCINE',
        unit: 'UNIT',
        stock: 5,
        value: 100,
        stockWithoutCost: 0,
        lowStock: false,
        active: false,
      },
    ],
    risk: [
      {
        batchId: 9,
        product: { id: 2, name: 'Vacuna antirrábica', unit: 'UNIT' },
        lotNumber: 'AR-1',
        expiresAt: '2026-11-14',
        days: -10,
        quantity: 4,
        value: 48,
        level: 'EXPIRED',
      },
      {
        batchId: 10,
        product: { id: 2, name: 'Vacuna triple felina', unit: 'UNIT' },
        lotNumber: 'TF-2',
        expiresAt: '2026-12-08',
        days: 14,
        quantity: 10,
        value: 120,
        level: 'RED',
      },
    ],
    idle: [
      { id: 2, name: 'Vacuna antirrábica', unit: 'UNIT', stock: 20, value: 200, lastOutAt: null },
    ],
    flows: Array.from({ length: 6 }, (_, i) => ({
      month: `2026-${String(i + 6).padStart(2, '0')}`,
      purchases: 300,
      outflows: 200,
      value: 500 + i * 100,
    })),
    coverage: [
      { category: 'VACCINE', value: 400, days: 160 },
      { category: 'ANTIPARASITIC', value: 600, days: 40 },
    ],
    lowStockProducts: [
      {
        id: 1,
        name: 'Antipulgas masticable',
        unit: 'TABLET',
        stock: 8,
        minStock: 10,
        weeklyOut: 6,
      },
    ],
    inactiveWithStock: 1,
    ...over,
  };
}

export function controlFixture(over: Partial<ControlReport> = {}): ControlReport {
  const k = {
    discounts: 30,
    discountCount: 3,
    discountPercent: 2.5,
    voided: 120,
    voidCount: 2,
    cashNet: -7,
    cashSessions: 10,
    cashWithDifference: 2,
    waste: 52.25,
  };
  return {
    from: '2026-10-26',
    to: '2026-11-24',
    previous: { from: '2026-09-26', to: '2026-10-25' },
    kpis: k,
    previousKpis: { ...k, discounts: 20, voided: 200, waste: 10 },
    grain: 'day',
    series: [
      { key: '2026-11-23', from: '2026-11-23', to: '2026-11-23', discounts: 10, voided: 0 },
      { key: '2026-11-24', from: '2026-11-24', to: '2026-11-24', discounts: 20, voided: 120 },
    ],
    maxDiscountPercent: 10,
    maxApplied: 8,
    discountsByUser: [
      {
        user: { id: 4, fullName: 'Carmen Huamán Soto', role: 'RECEPTION' },
        amount: 30,
        count: 3,
        percent: 2.5,
      },
    ],
    discountsByReason: [{ reason: 'cliente frecuente', amount: 30, count: 3 }],
    discountClients: [{ client: { id: 3, name: 'Rosa Quispe' }, amount: 12, count: 2 }],
    voids: {
      count: 2,
      items: [
        {
          kind: 'receipt',
          title: 'Cobro N.° 58',
          amount: 80,
          reason: 'Pidió factura',
          user: 'Jorge Quispe',
          at: '2026-11-24T15:00:00Z',
        },
        {
          kind: 'charge',
          title: 'Hemograma',
          amount: 40,
          reason: 'No se hizo',
          user: 'Dra. Lucía Ruiz',
          at: '2026-11-23T15:00:00Z',
        },
      ],
    },
    closings: {
      points: [
        { id: 1, at: '2026-11-22T23:00:00Z', difference: -12 },
        { id: 2, at: '2026-11-23T23:00:00Z', difference: 5 },
      ],
      buckets: [],
      items: [
        {
          id: 1,
          at: '2026-11-22T23:00:00Z',
          difference: -12,
          note: 'Vuelto mal dado',
          user: 'Jorge Quispe',
        },
        { id: 2, at: '2026-11-23T23:00:00Z', difference: 5, note: null, user: 'Carmen Huamán' },
      ],
    },
    waste: {
      byType: [
        { type: 'WASTE', amount: 48, count: 1 },
        { type: 'COUNT_ADJUST', amount: 4.25, count: 1 },
      ],
      items: [
        {
          product: 'Vacuna antirrábica',
          lot: 'AR-1',
          quantity: 4,
          unit: 'UNIT',
          value: 48,
          reason: 'Vencida',
          type: 'WASTE',
          at: '2026-11-24T14:00:00Z',
          user: 'Andrea',
        },
      ],
    },
    people: [
      {
        user: { id: 5, fullName: 'Jorge Quispe Rojas', role: 'CASHIER' },
        receipts: 40,
        collected: 2310,
        discounts: 0,
        discountPercent: null,
        voids: 1,
        cashDifference: -12,
      },
    ],
    priceChanges: {
      count: 1,
      items: [
        {
          action: 'service.price_change',
          name: 'Consulta general',
          before: 50,
          after: 60,
          user: 'Andrea Salazar',
          at: '2026-11-02T13:30:00Z',
        },
      ],
    },
    ...over,
  };
}
