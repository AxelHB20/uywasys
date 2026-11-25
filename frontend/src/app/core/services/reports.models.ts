import { Role } from '../auth/auth.models';
import { PaymentMethod } from './cash.models';
import { money } from '../../shared/utils/stock';
import {
  BASE_UNIT_LABELS,
  BaseUnit,
  CareServiceCategory,
  ProductCategory,
  SERVICE_CATEGORY_LABELS,
} from './inventory.models';

export type SaleKind = 'SERVICE' | 'PRODUCT';

export interface SalesKpis {
  /** Cargos no anulados con IGV, cobrados o por cobrar */
  sold: number;
  pending: number;
  /** Pagos menos devoluciones: lo mismo que suma la caja */
  collected: number;
  receipts: number;
  averageTicket: number;
  visits: number;
  /** Registrados en el período (vengan o no) */
  newClients: number;
  /** Atendidos por primera vez en el período */
  firstTime: number;
}

/** Un grupo del gráfico que manda el servidor: una hora, un día, una semana o un mes */
export interface SalesSeriesPoint {
  key: string;
  from: string;
  to: string;
  services: number;
  products: number;
  collected: number;
  visits: number;
  receipts: number;
  averageTicket: number;
}

export type Species = 'DOG' | 'CAT' | 'RABBIT' | 'GUINEA_PIG' | 'BIRD' | 'REPTILE' | 'OTHER';
export type Transport = 'PICKUP' | 'DROPOFF' | 'ROUND_TRIP' | 'NONE';

export interface SalesItem {
  kind: SaleKind;
  id: number | null;
  name: string;
  category: string | null;
  quantity: number;
  unit: BaseUnit | null;
  amount: number;
}

export interface SalesCategory {
  kind: SaleKind;
  category: string | null;
  amount: number;
  lines: number;
}

export interface SalesProfessional {
  user: { id: number; fullName: string; role: Role } | null;
  visits: number;
  services: number;
  products: number;
  amount: number;
}

export interface SalesMethod {
  method: PaymentMethod;
  amount: number;
  payments: number;
}

export interface SalesReport {
  from: string;
  to: string;
  previous: { from: string; to: string };
  kpis: SalesKpis;
  previousKpis: SalesKpis;
  grain: Grain;
  series: SalesSeriesPoint[];
  previousSeries: { key: string; sold: number }[];
  categories: SalesCategory[];
  items: SalesItem[];
  professionals: SalesProfessional[];
  methods: SalesMethod[];
  heatmap: { dow: number; hour: number; amount: number }[];
  species: { species: Species | null; amount: number; pets: number }[];
  documents: { type: 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE'; count: number; amount: number }[];
  topClients: {
    client: { id: number; name: string };
    amount: number;
    visits: number;
    pets: number;
  }[];
  clients: {
    total: number;
    newOnes: number;
    /** Vinieron 2 días o más (contando antes del período) */
    repeat: number;
    series: { key: string; returning: number; newOnes: number }[];
  };
  receivables: {
    total: number;
    clients: number;
    aging: { upTo7: number; upTo30: number; older: number };
    top: {
      client: { id: number; name: string };
      amount: number;
      charges: number;
      oldestAt: string;
    }[];
  };
  transport: {
    amount: number;
    count: number;
    byType: { transport: Transport; count: number }[];
    pendingHome: number;
  };
  months: { month: string; sold: number; previous: number }[];
  overdueBoosters: number;
}

// ── Período ──

export type ReportPreset =
  'today' | 'last7' | 'last30' | 'month' | 'lastMonth' | 'last12' | 'year' | 'lastYear';
export type ReportPeriod = ReportPreset | 'custom';

export const REPORT_PRESET_LABELS: Record<ReportPreset, string> = {
  today: 'Hoy',
  last7: '7 días',
  last30: '30 días',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
  last12: '12 meses',
  year: 'Este año',
  lastYear: 'Año pasado',
};
/** Nombre completo para lectores de pantalla y títulos */
export const REPORT_PRESET_TITLES: Record<ReportPreset, string> = {
  today: 'Hoy',
  last7: 'Últimos 7 días',
  last30: 'Últimos 30 días',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
  last12: 'Últimos 12 meses',
  year: 'Este año',
  lastYear: 'Año pasado',
};
export const REPORT_PRESETS = Object.keys(REPORT_PRESET_LABELS) as ReportPreset[];

/** Hasta 2 años por reporte (igual que el servidor: 731 días con el bisiesto) */
export const MAX_REPORT_DAYS = 731;

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) =>
  iso(new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS));
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS) + 1;

/** Suma meses sin pasarse del último día del mes de llegada */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const last = new Date(Date.UTC(Math.floor(total / 12), (total % 12) + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(Math.floor(total / 12), total % 12, Math.min(d, last), 12)));
}

export function reportRange(preset: ReportPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const first = addMonths(`${today.slice(0, 7)}-01`, -1);
      return { from: first, to: addDays(`${today.slice(0, 7)}-01`, -1) };
    }
    case 'last12':
      return { from: addDays(addMonths(today, -12), 1), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'lastYear': {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
}

/** Qué falla del rango elegido a mano y cómo arreglarlo con un toque */
export type RangeIssue =
  | { kind: 'reversed' }
  | {
      kind: 'tooLong';
      /** "3 años y 7 meses" */
      length: string;
      /** Los últimos 2 años que terminan en la fecha final */
      lastTwoYears: { from: string; to: string };
      /** 2 años desde la fecha inicial (sin pasar de hoy) */
      fromStart: { from: string; to: string };
    };

export function rangeIssue(from: string, to: string, today: string): RangeIssue | null {
  if (!from || !to) return null;
  if (from > to) return { kind: 'reversed' };
  if (daysBetween(from, to) <= MAX_REPORT_DAYS) return null;
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) -
    Number(from.slice(5, 7)) -
    (Number(to.slice(8)) < Number(from.slice(8)) ? 1 : 0);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const length = [
    y ? `${y} ${y === 1 ? 'año' : 'años'}` : '',
    m ? `${m} ${m === 1 ? 'mes' : 'meses'}` : '',
  ]
    .filter(Boolean)
    .join(' y ');
  const end = addDays(from, MAX_REPORT_DAYS - 1);
  return {
    kind: 'tooLong',
    length,
    lastTwoYears: { from: addDays(to, -(MAX_REPORT_DAYS - 1)), to },
    fromStart: { from, to: end > today ? today : end },
  };
}

/** Error del rango elegido a mano, o null si se puede consultar */
export function rangeError(from: string, to: string): string | null {
  const issue = rangeIssue(from, to, '9999-12-31');
  if (!issue) return null;
  return issue.kind === 'reversed'
    ? 'La fecha inicial va antes que la final.'
    : 'El período puede ser de hasta 2 años.';
}

const shortDate = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
/** 24 nov 2026 */
export function shortDay(day: string): string {
  return shortDate
    .format(new Date(`${day}T12:00:00Z`))
    .replace(/\./g, '')
    .replace(/ de /g, ' ');
}
/** 26 oct – 24 nov 2026 (el año una sola vez si es el mismo) */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDay(from);
  const a = shortDay(from);
  const b = shortDay(to);
  return from.slice(0, 4) === to.slice(0, 4) ? `${a.replace(/ \d{4}$/, '')} – ${b}` : `${a} – ${b}`;
}

// ── Comparación con el período anterior ──

export interface Delta {
  /** Variación en %, redondeada; null si antes no hubo nada con qué comparar */
  percent: number | null;
  trend: 'up' | 'down' | 'flat';
}

export function delta(now: number, before: number): Delta {
  if (!before) return { percent: null, trend: now > 0 ? 'up' : 'flat' };
  const percent = Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
  return { percent, trend: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat' };
}

// ── Agrupación del gráfico: la decide el servidor según el largo del período ──

/** Por hora (un día), por día (hasta 31), por semana (hasta 92) o por mes */
export type Grain = 'hour' | 'day' | 'week' | 'month';

export const GRAIN_LABELS: Record<Grain, string> = {
  hour: 'por hora',
  day: 'por día',
  week: 'por semana',
  month: 'por mes',
};

export interface SalesBucket {
  key: string;
  /** Etiqueta corta del eje ("8 h", "3 nov", "3 nov", "nov") */
  label: string;
  /** Para el detalle y la tabla ("De 8 a 9 h", "Lunes 3 de noviembre", "3 – 9 nov", "Noviembre 2026") */
  title: string;
  services: number;
  products: number;
  collected: number;
  total: number;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', ...opts });
  return (day: string) => f.format(new Date(`${day}T12:00:00Z`)).replace('.', '');
};
const dayMonth = fmt({ day: 'numeric', month: 'short' });
const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const monthName = fmt({ month: 'short' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const monthShortYear = fmt({ month: 'short', year: '2-digit' });

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Etiquetas de un grupo según cómo se agrupó */
export function bucketLabels(
  grain: Grain,
  b: { key: string; from: string; to: string },
  manyYears = false,
): { label: string; title: string } {
  switch (grain) {
    case 'hour': {
      const h = Number(b.key);
      return { label: `${h} h`, title: `De ${h} a ${h + 1} h` };
    }
    case 'day':
      return { label: dayMonth(b.from), title: capitalize(longDay(b.from)) };
    case 'week':
      return {
        label: dayMonth(b.from),
        title: b.from === b.to ? dayMonth(b.from) : `${dayMonth(b.from)} – ${dayMonth(b.to)}`,
      };
    default:
      return {
        label: manyYears ? monthShortYear(b.from).replace(' ', ' ’') : monthName(b.from),
        title: capitalize(monthYear(b.from)),
      };
  }
}

export function bucketize(r: Pick<SalesReport, 'grain' | 'series' | 'from' | 'to'>): SalesBucket[] {
  const manyYears = r.from.slice(0, 4) !== r.to.slice(0, 4);
  return r.series.map((s) => ({
    key: s.key,
    ...bucketLabels(r.grain, s, manyYears),
    services: s.services,
    products: s.products,
    collected: s.collected,
    total: round2(s.services + s.products),
  }));
}

/** Escala del eje: un máximo "redondo" y sus marcas (0, 500, 1 000…) */
export function niceScale(max: number, ticks = 4): { max: number; step: number; ticks: number[] } {
  if (max <= 0) return { max: 100, step: 25, ticks: [0, 25, 50, 75, 100] };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  return {
    max: top,
    step,
    ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => round2(i * step)),
  };
}

/** S/ 1,2 mil · S/ 850 · S/ 1,29 M — para ejes, el centro de la dona y el mosaico */
/** Para los indicadores: desde S/ 1,000 sin céntimos (S/ 37,859); lo menor, con céntimos */
export function kpiMoney(value: number): string {
  return Math.abs(value) >= 1000 ? money(Math.round(value)).replace(/\.00$/, '') : money(value);
}

export function compactMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return `S/ ${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(value / 1_000_000)} M`;
  if (Math.abs(value) >= 1000)
    return `S/ ${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
  return `S/ ${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 }).format(value)}`;
}

// ── Etiquetas ──

export function categoryLabel(kind: SaleKind, category: string | null): string {
  if (!category) return kind === 'SERVICE' ? 'Otros servicios' : 'Otros productos';
  if (kind === 'SERVICE')
    return SERVICE_CATEGORY_LABELS[category as CareServiceCategory] ?? category;
  return PRODUCT_CATEGORY_PLURAL[category as ProductCategory] ?? category;
}

const PRODUCT_CATEGORY_PLURAL: Record<ProductCategory, string> = {
  MEDICINE: 'Medicamentos',
  VACCINE: 'Vacunas (producto)',
  ANTIPARASITIC: 'Antiparasitarios',
  FOOD: 'Alimentos',
  ACCESSORY: 'Accesorios',
  HYGIENE: 'Higiene',
  SUPPLY: 'Insumos',
};

/** "3 veces" · "12 unidades" · "250 ml" */
export function quantityLabel(item: Pick<SalesItem, 'kind' | 'quantity' | 'unit'>): string {
  const n = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(item.quantity);
  if (item.kind === 'SERVICE') return `${n} ${item.quantity === 1 ? 'vez' : 'veces'}`;
  const [one, many] = BASE_UNIT_LABELS[item.unit ?? 'UNIT'];
  return `${n} ${item.quantity === 1 ? one : many}`;
}

/** Colores de las series (validados para daltonismo y contraste ≥ 3:1 sobre blanco) */
export const SERIES_COLORS: Record<SaleKind, string> = {
  SERVICE: '#4446c8',
  PRODUCT: '#d97706',
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── Margen (paso 2) ──

export interface MarginRow {
  kind: SaleKind;
  id: number | null;
  name: string;
  category: string | null;
  quantity: number;
  unit: BaseUnit | null;
  /** Venta sin IGV */
  revenue: number;
  /** null = falta el costo de compra de algún lote */
  cost: number | null;
  margin: number | null;
  marginPercent: number | null;
}

export interface MarginTotals {
  revenue: number;
  revenueWithCost: number;
  cost: number;
  margin: number;
  marginPercent: number | null;
  revenueWithoutCost: number;
  rowsWithoutCost: number;
}

export interface MarginReport {
  from: string;
  to: string;
  products: MarginRow[];
  services: MarginRow[];
  totals: { products: MarginTotals; services: MarginTotals; all: MarginTotals };
  previous: { from: string; to: string };
  previousTotals: { revenue: number; margin: number; marginPercent: number | null };
  grain: Grain;
  series: {
    key: string;
    from: string;
    to: string;
    revenue: number;
    margin: number;
    marginPercent: number | null;
  }[];
  /** Descuentos del período (con IGV) */
  discounts: number;
}

export type MarginSort = 'revenue' | 'cost' | 'margin' | 'marginPercent' | 'name';

/** Orden de la tabla de margen: lo que no tiene costo va siempre al final */
export function sortMargin(rows: MarginRow[], by: MarginSort, desc = true): MarginRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (by === 'name') return a.name.localeCompare(b.name, 'es') * dir;
    const x = a[by];
    const y = b[by];
    if (x === null && y === null) return b.revenue - a.revenue;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * dir;
  });
}

// ── Inventario valorizado (paso 2) ──

export type ExpiryLevel = 'EXPIRED' | 'RED' | 'YELLOW' | 'GREEN';

export interface InventoryReport {
  day: string;
  idleDays: number;
  totals: {
    value: number;
    products: number;
    batchesWithoutCost: number;
    lowStock: number;
    expired: number;
    expiring30: number;
    expiring60: number;
    idle: number;
  };
  categories: { category: ProductCategory; value: number; products: number }[];
  products: {
    id: number;
    name: string;
    category: ProductCategory;
    unit: BaseUnit;
    stock: number;
    value: number;
    stockWithoutCost: number;
    lowStock: boolean;
    /** Desactivado con stock: igual cuenta */
    active: boolean;
  }[];
  risk: {
    batchId: number;
    product: { id: number; name: string; unit: BaseUnit };
    lotNumber: string | null;
    expiresAt: string;
    days: number;
    level: ExpiryLevel;
    quantity: number;
    value: number | null;
  }[];
  idle: {
    id: number;
    name: string;
    unit: BaseUnit;
    stock: number;
    value: number;
    lastOutAt: string | null;
  }[];
  flows: { month: string; purchases: number; outflows: number; value: number }[];
  coverage: { category: ProductCategory; value: number; days: number | null }[];
  lowStockProducts: {
    id: number;
    name: string;
    unit: BaseUnit;
    stock: number;
    minStock: number;
    weeklyOut: number;
  }[];
  inactiveWithStock: number;
}

/** "12 unidades" · "400 ml" */
export function stockLabel(quantity: number, unit: BaseUnit): string {
  const n = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(quantity);
  const [one, many] = BASE_UNIT_LABELS[unit] ?? ['unidad', 'unidades'];
  return `${n} ${quantity === 1 ? one : many}`;
}

/** "Vencido hace 3 días" · "Vence hoy" · "Vence en 10 días" */
export function expiryLabel(days: number): string {
  if (days < 0) return `Venció hace ${-days} ${days === -1 ? 'día' : 'días'}`;
  if (days === 0) return 'Vence hoy';
  return `Vence en ${days} ${days === 1 ? 'día' : 'días'}`;
}

// ── Inicio: el mes en curso (paso 3) ──

export interface MonthSummary {
  from: string;
  to: string;
  /** Mes anterior del 1 al mismo día */
  previous: { from: string; to: string };
  kpis: SalesKpis;
  previousKpis: SalesKpis;
  days: { day: string; collected: number }[];
  previousDays: { day: string; collected: number }[];
  /** Cobrado por día de las últimas 3 semanas hasta hoy */
  recent?: { day: string; collected: number }[];
}

export interface DailyBar {
  day: string;
  /** Cobrado ese día */
  value: number;
  /** El mismo día de la semana anterior */
  previous: number;
  today: boolean;
}

/** Los últimos 14 días con el mismo día de la semana anterior al lado */
export function recentBars(m: MonthSummary, days = 14): DailyBar[] {
  const list = m.recent ?? [];
  const out: DailyBar[] = [];
  for (let i = Math.max(7, list.length - days); i < list.length; i++)
    out.push({
      day: list[i].day,
      value: list[i].collected,
      previous: list[i - 7]?.collected ?? 0,
      today: i === list.length - 1,
    });
  return out;
}

export interface TrendPoint {
  /** Día del mes (1, 2, 3…) */
  day: number;
  /** Acumulado de este mes hasta ese día; null después de hoy */
  current: number | null;
  /** Acumulado del mes anterior hasta ese día; null si el mes anterior no tuvo ese día */
  previous: number | null;
}

/** Lo cobrado acumulado día a día, este mes contra el anterior, alineado por día del mes */
export function cumulativeTrend(month: MonthSummary): TrendPoint[] {
  const length = Math.max(month.days.length, month.previousDays.length);
  const sum = (list: { collected: number }[]) => {
    let total = 0;
    return list.map((d) => (total = Math.round((total + d.collected) * 100) / 100));
  };
  const current = sum(month.days);
  const previous = sum(month.previousDays);
  return Array.from({ length }, (_, i) => ({
    day: i + 1,
    current: current[i] ?? null,
    previous: previous[i] ?? null,
  }));
}

// ── Control del dueño ──

export interface ControlKpis {
  discounts: number;
  discountCount: number;
  discountPercent: number | null;
  voided: number;
  voidCount: number;
  cashNet: number;
  cashSessions: number;
  cashWithDifference: number;
  waste: number;
}

type UserRef = { id: number; fullName: string; role: Role };

export interface ControlReport {
  from: string;
  to: string;
  previous: { from: string; to: string };
  kpis: ControlKpis;
  previousKpis: ControlKpis;
  grain: Grain;
  series: { key: string; from: string; to: string; discounts: number; voided: number }[];
  maxDiscountPercent: number;
  maxApplied: number | null;
  discountsByUser: {
    user: UserRef | null;
    amount: number;
    count: number;
    percent: number | null;
  }[];
  discountsByReason: { reason: string; amount: number; count: number }[];
  discountClients: { client: { id: number; name: string }; amount: number; count: number }[];
  voids: {
    count: number;
    items: {
      kind: 'charge' | 'receipt';
      title: string;
      amount: number;
      reason: string | null;
      user: string | null;
      at: string;
    }[];
  };
  closings: {
    points: { id: number; at: string; difference: number }[];
    buckets: { key: string; surplus: number; shortage: number }[];
    items: {
      id: number;
      at: string;
      difference: number;
      note: string | null;
      user: string | null;
    }[];
  };
  waste: {
    byType: { type: 'WASTE' | 'COUNT_ADJUST'; amount: number; count: number }[];
    items: {
      product: string;
      lot: string | null;
      quantity: number;
      unit: BaseUnit;
      value: number | null;
      reason: string | null;
      type: 'WASTE' | 'COUNT_ADJUST';
      at: string;
      user: string | null;
    }[];
  };
  people: {
    user: UserRef;
    receipts: number;
    collected: number;
    discounts: number;
    discountPercent: number | null;
    voids: number;
    cashDifference: number | null;
  }[];
  priceChanges: {
    count: number;
    items: {
      action: string;
      name: string;
      before: number | null;
      after: number | null;
      user: string | null;
      at: string;
    }[];
  };
}

export const SPECIES_PLURAL: Record<Species, string> = {
  DOG: 'Perros',
  CAT: 'Gatos',
  RABBIT: 'Conejos',
  GUINEA_PIG: 'Cuyes',
  BIRD: 'Aves',
  REPTILE: 'Reptiles',
  OTHER: 'Otros',
};

export const TRANSPORT_LABELS: Record<Transport, string> = {
  ROUND_TRIP: 'Recojo y entrega',
  PICKUP: 'Solo recojo',
  DROPOFF: 'Solo entrega',
  NONE: 'Sin movilidad',
};

/** "Cliente frecuente" a partir de "cliente frecuente" (el servidor agrupa sin mayúsculas) */
export function reasonLabel(reason: string): string {
  return reason ? capitalize(reason) : 'Sin motivo';
}

/** Nombre corto del mes: "nov" o "nov ’25" si el rango cruza años */
export function monthLabel(month: string, withYear = false): string {
  const label = monthName(`${month}-01`);
  return withYear ? `${label} ’${month.slice(2, 4)}` : label;
}
