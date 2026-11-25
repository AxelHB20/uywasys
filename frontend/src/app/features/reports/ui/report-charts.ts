/**
 * Opciones de los gráficos de Reportes (ECharts). Funciones puras: reciben los datos ya listos y
 * devuelven la configuración, así se prueban sin dibujar nada.
 */
import { SERIES_COLORS, compactMoney } from '../../../core/services/reports.models';
import { money } from '../../../shared/utils/stock';
import { ChartOption } from './echart.component';

export const COLORS = {
  service: SERIES_COLORS.SERVICE,
  product: SERIES_COLORS.PRODUCT,
  previous: '#94a3b8',
  green: '#059669',
  greenSoft: '#34d399',
  red: '#e11d48',
  violet: '#8b5cf6',
  cyan: '#0891b2',
  slate: '#64748b',
  /** Línea de porcentaje sobre barras de color: tinta oscura, para no confundirse con ellas */
  ink: '#1e293b',
  grid: '#eef0f5',
};
/** Para repartos (dona): añil, violeta, cian, ámbar, gris — distinguibles con daltonismo */
export const PALETTE = [
  COLORS.service,
  COLORS.violet,
  COLORS.cyan,
  COLORS.product,
  COLORS.slate,
  '#db2777',
];

const axisLabel = { color: '#64748b', fontSize: 11, hideOverlap: true };
const yMoney = {
  type: 'value',
  axisLabel: { ...axisLabel, formatter: (v: number) => compactMoney(v) },
  splitLine: { lineStyle: { color: COLORS.grid } },
  splitNumber: 4,
};
const grid = (left = 8) => ({ left, right: 8, top: 12, bottom: 4 });
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const dot = (color: string) =>
  `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>`;
/** Marca de línea (raya con punto) para la serie de línea del detalle */
const lineMark = (color: string) =>
  `<span style="display:inline-block;position:relative;width:14px;height:8px;margin-right:6px;vertical-align:middle"><i style="position:absolute;left:0;right:0;top:3px;height:2px;background:${color === '#1e293b' ? '#e2e8f0' : color}"></i><i style="position:absolute;left:4px;top:0;width:6px;height:6px;border-radius:50%;background:#0f172a;border:1.5px solid ${color === '#1e293b' ? '#e2e8f0' : color}"></i></span>`;
const row = (label: string, value: string, color?: string, line = false) =>
  `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:3px"><span>${color ? (line ? lineMark(color) : dot(color)) : ''}${esc(label)}</span><b style="color:#fff">${value}</b></div>`;

export interface TimePoint {
  label: string;
  title: string;
  services: number;
  products: number;
  previous: number | null;
}

/** Ventas en el tiempo: servicios y productos apilados, y el período anterior punteado */
export function salesOverTime(points: TimePoint[], partialLast: boolean): ChartOption {
  const last = points.length - 1;
  const faded = (i: number) => (partialLast && i === last ? 0.45 : 1);
  return {
    grid: grid(),
    xAxis: {
      type: 'category',
      data: points.map((p) => p.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel,
    },
    yAxis: yMoney,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(68,70,200,.06)' } },
      formatter: (items: { dataIndex: number }[]) => {
        const p = points[items[0].dataIndex];
        const total = p.services + p.products;
        let html = `<b style="color:#fff;font-size:13px">${esc(p.title)}</b>`;
        html += row('Servicios', money(p.services), COLORS.service);
        html += row('Productos', money(p.products), COLORS.product);
        html += `<div style="border-top:1px solid #334155;margin-top:8px;padding-top:6px">${row('Total', money(total))}</div>`;
        if (p.previous !== null)
          html += row('Período anterior', money(p.previous), COLORS.previous);
        if (partialLast && items[0].dataIndex === last)
          html += '<div style="margin-top:4px;color:#fcd34d">En curso</div>';
        return html;
      },
    },
    series: [
      {
        name: 'Servicios',
        type: 'bar',
        stack: 'sold',
        barMaxWidth: 28,
        data: points.map((p, i) => ({ value: p.services, itemStyle: { opacity: faded(i) } })),
        itemStyle: { color: COLORS.service },
      },
      {
        name: 'Productos',
        type: 'bar',
        stack: 'sold',
        barMaxWidth: 28,
        data: points.map((p, i) => ({ value: p.products, itemStyle: { opacity: faded(i) } })),
        itemStyle: { color: COLORS.product, borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'Período anterior',
        type: 'line',
        data: points.map((p) => p.previous),
        symbol: 'none',
        smooth: 0.2,
        lineStyle: { color: COLORS.previous, type: 'dashed', width: 1.6 },
        z: 3,
      },
    ],
  };
}

/** Dona de reparto (medios de pago, especie, motivos). El total va en el centro, fuera del gráfico. */
export function donut(
  parts: { name: string; value: number; color: string }[],
  unit: 'money' | 'count' = 'money',
): ChartOption {
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<b style="color:#fff">${esc(p.name)}</b>${row(unit === 'money' ? money(p.value) : String(p.value), `${p.percent} %`)}`,
    },
    series: [
      {
        type: 'pie',
        radius: ['64%', '88%'],
        avoidLabelOverlap: true,
        padAngle: 1.5,
        itemStyle: { borderRadius: 3 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 4 },
        data: parts.map((p) => ({ name: p.name, value: p.value, itemStyle: { color: p.color } })),
      },
    ],
  };
}

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Mapa de calor día × hora. `step` agrupa horas (2 en el celular para que quepa). */
export function heatmap(
  cells: { dow: number; hour: number; amount: number }[],
  step = 1,
): ChartOption {
  const hours = cells.map((c) => c.hour);
  const first = Math.min(8, ...hours);
  const lastHour = Math.max(20, ...hours);
  const slots: number[] = [];
  for (let h = first - (first % step); h <= lastHour; h += step) slots.push(h);
  const sums = new Map<string, number>();
  for (const c of cells) {
    const slot = c.hour - (c.hour % step);
    const k = `${c.dow}-${slot}`;
    sums.set(k, (sums.get(k) ?? 0) + c.amount);
  }
  const data: [number, number, number][] = [];
  slots.forEach((h, x) =>
    DOW.forEach((_, y) =>
      data.push([x, y, Math.round((sums.get(`${y + 1}-${h}`) ?? 0) * 100) / 100]),
    ),
  );
  const max = Math.max(1, ...data.map((d) => d[2]));
  return {
    grid: { left: 4, right: 4, top: 4, bottom: 4 },
    xAxis: {
      type: 'category',
      data: slots.map(String),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel,
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: DOW,
      inverse: true,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { ...axisLabel, hideOverlap: false },
    },
    visualMap: {
      show: false,
      min: 0,
      max,
      inRange: { color: ['#f0f1fe', '#c9ccfb', '#7c80f0', '#3637a3'] },
    },
    tooltip: {
      formatter: (p: { value: [number, number, number] }) => {
        const [x, y, v] = p.value;
        const h = slots[x];
        return `<b style="color:#fff">${DOW[y]} de ${h} a ${h + step} h</b>${row('Vendido', money(v))}`;
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 6 },
        emphasis: { itemStyle: { borderColor: '#0f172a', borderWidth: 1 } },
      },
    ],
  };
}

export interface BarSeries {
  name: string;
  data: (number | null)[];
  color: string;
  stack?: string;
}

/** Barras (apiladas o lado a lado) con una línea opcional en un segundo eje */
export function bars(
  labels: string[],
  series: BarSeries[],
  opts: {
    format?: (v: number) => string;
    axis?: (v: number) => string;
    line?: {
      name: string;
      data: (number | null)[];
      color: string;
      format: (v: number) => string;
      max?: number;
    };
    titles?: string[];
    highlight?: number;
  } = {},
): ChartOption {
  const format = opts.format ?? money;
  const yAxis: object[] = [
    {
      type: 'value',
      axisLabel: { ...axisLabel, formatter: opts.axis ?? ((v: number) => compactMoney(v)) },
      splitLine: { lineStyle: { color: COLORS.grid } },
      splitNumber: 4,
    },
  ];
  if (opts.line)
    yAxis.push({
      type: 'value',
      max: opts.line.max,
      min: 0,
      axisLabel: { ...axisLabel, color: opts.line.color, formatter: opts.line.format },
      splitLine: { show: false },
    });
  return {
    grid: grid(),
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: {
        ...axisLabel,
        fontWeight: (_: string, i: number) => (i === opts.highlight ? 600 : 400),
      },
    },
    yAxis,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(68,70,200,.06)' } },
      formatter: (items: { dataIndex: number }[]) => {
        const i = items[0].dataIndex;
        let html = `<b style="color:#fff">${esc(opts.titles?.[i] ?? labels[i])}</b>`;
        for (const s of series)
          html += row(s.name, s.data[i] === null ? '—' : format(s.data[i] as number), s.color);
        if (opts.line) {
          const v = opts.line.data[i];
          html += row(
            opts.line.name,
            v === null ? '—' : opts.line.format(v),
            opts.line.color,
            true,
          );
        }
        return html;
      },
    },
    series: [
      ...series.map((s, k) => ({
        name: s.name,
        type: 'bar',
        stack: s.stack,
        barMaxWidth: series.length > 1 && !s.stack ? 18 : 30,
        barGap: '20%',
        data: s.data,
        itemStyle: {
          color: s.color,
          borderRadius: !s.stack || k === series.length - 1 ? [4, 4, 0, 0] : 0,
        },
      })),
      ...(opts.line
        ? [
            {
              name: opts.line.name,
              type: 'line',
              yAxisIndex: 1,
              data: opts.line.data,
              symbol: 'circle',
              symbolSize: 7,
              itemStyle: { color: '#fff', borderColor: opts.line.color, borderWidth: 2 },
              lineStyle: { color: opts.line.color, width: 2.2 },
              z: 3,
            },
          ]
        : []),
    ],
  };
}

/** Dos líneas: este período (con área) y el año anterior punteado */
export function twoLines(
  labels: string[],
  now: number[],
  before: number[],
  titles: string[],
): ChartOption {
  return {
    grid: grid(),
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel,
    },
    yAxis: yMoney,
    tooltip: {
      trigger: 'axis',
      formatter: (items: { dataIndex: number }[]) => {
        const i = items[0].dataIndex;
        return `<b style="color:#fff">${esc(titles[i])}</b>${row('Vendido', money(now[i]), COLORS.service)}${row('Un año antes', money(before[i]), COLORS.previous)}`;
      },
    },
    series: [
      {
        name: 'Un año antes',
        type: 'line',
        data: before,
        symbol: 'none',
        lineStyle: { color: COLORS.previous, type: 'dashed', width: 1.8 },
      },
      {
        name: 'Vendido',
        type: 'line',
        data: now,
        symbol: 'none',
        lineStyle: { color: COLORS.service, width: 2.4 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(68,70,200,.22)' },
              { offset: 1, color: 'rgba(68,70,200,0)' },
            ],
          },
        },
        endLabel: { show: false },
      },
    ],
  };
}

export interface BubblePoint {
  name: string;
  revenue: number;
  percent: number;
  times: number;
  product: boolean;
}

/**
 * Mapa de rentabilidad: a la derecha vende más, arriba deja más. Los cuadrantes se parten en la
 * mediana de la venta y en 50 % de margen. Llevan nombre hasta `labeled` puntos que no estén pegados a
 * otro ya nombrado (primero los de margen bajo, que son los que hay que revisar); el resto se ve al tocar.
 */
function pickLabels(points: BubblePoint[], max: number): Set<string> {
  const near = (a: BubblePoint, b: BubblePoint) =>
    Math.abs(Math.log10(Math.max(a.revenue, 1)) - Math.log10(Math.max(b.revenue, 1))) < 0.6 &&
    Math.abs(a.percent - b.percent) < 14;
  const order = [
    ...points.filter((p) => p.percent < 50).sort((a, b) => b.revenue - a.revenue),
    ...points.filter((p) => p.percent >= 50).sort((a, b) => b.revenue - a.revenue),
  ];
  const chosen: BubblePoint[] = [];
  for (const p of order) {
    if (chosen.length >= max) break;
    if (!chosen.some((c) => near(c, p))) chosen.push(p);
  }
  return new Set(chosen.map((p) => p.name));
}

export function profitMap(points: BubblePoint[], labeled: number): ChartOption {
  const sorted = [...points].sort((a, b) => a.revenue - b.revenue);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].revenue : 0;
  const top = pickLabels(points, labeled);
  const maxTimes = Math.max(1, ...points.map((p) => p.times));
  return {
    grid: { left: 8, right: 16, top: 30, bottom: 4 },
    xAxis: {
      type: 'log',
      name: '',
      axisLabel: { ...axisLabel, formatter: (v: number) => compactMoney(v) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      max: 100,
      min: (v: { min: number }) => Math.min(0, Math.floor(v.min / 10) * 10),
      axisLabel: { ...axisLabel, formatter: '{value} %' },
      splitLine: { lineStyle: { color: COLORS.grid } },
    },
    tooltip: {
      formatter: (p: { data: { raw: BubblePoint } }) => {
        const r = p.data.raw;
        return `<b style="color:#fff">${esc(r.name)}</b>${row('Venta sin IGV', money(r.revenue))}${row('Margen', `${r.percent} %`)}${row('Veces', String(r.times))}`;
      },
    },
    series: [
      {
        type: 'scatter',
        data: points.map((p) => ({
          value: [Math.max(p.revenue, 1), p.percent],
          raw: p,
          symbolSize: 8 + Math.sqrt(p.times / maxTimes) * 26,
          itemStyle: {
            color: p.product ? 'rgba(217,119,6,.25)' : 'rgba(68,70,200,.22)',
            borderColor: p.product ? COLORS.product : COLORS.service,
            borderWidth: 1.5,
          },
          label: {
            show: top.has(p.name),
            formatter: p.name,
            position: p.percent > 88 ? 'bottom' : 'top',
            width: 130,
            overflow: 'truncate',
            color: '#334155',
            fontSize: 11,
            textBorderColor: '#fff',
            textBorderWidth: 3,
          },
        })),
        labelLayout: { hideOverlap: true },
        markArea: {
          silent: true,
          data: [
            [
              {
                name: 'Joyas',
                coord: ['min', 50],
                itemStyle: { color: 'rgba(241,245,249,.7)' },
                label: { show: false },
              },
              { coord: [median, 100] },
            ],
            [
              {
                name: 'Estrellas',
                coord: [median, 50],
                itemStyle: { color: 'rgba(236,253,245,.8)' },
                label: { show: false },
              },
              { coord: ['max', 100] },
            ],
            [
              {
                name: 'Poco aporte',
                coord: ['min', 'min'],
                itemStyle: { color: 'rgba(255,241,242,.6)' },
                label: { show: false },
              },
              { coord: [median, 50] },
            ],
            [
              {
                name: 'Revisa el precio',
                coord: [median, 'min'],
                itemStyle: { color: 'rgba(255,247,237,.8)' },
                label: { show: false },
              },
              { coord: ['max', 50] },
            ],
          ],
        },
      },
    ],
  };
}

/** Mosaico “Dónde está tu dinero”: si un cuadro no alcanza, su texto se oculta y sale al tocar */
export function moneyTreemap(items: { name: string; value: number }[]): ChartOption {
  const total = items.reduce((t, it) => t + it.value, 0) || 1;
  const shades = ['#3637a3', '#4446c8', '#5a5ee0', '#7c80f0', '#a3a8fb', '#c9ccfb', '#e2e4fd'];
  return {
    tooltip: {
      formatter: (p: { name: string; value: number }) =>
        `<b style="color:#fff">${esc(p.name)}</b>${row('Valor a costo', money(p.value))}`,
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        itemStyle: { borderColor: '#fff', borderWidth: 3, gapWidth: 3, borderRadius: 10 },
        label: {
          show: true,
          position: 'insideTopLeft',
          padding: [8, 10],
          overflow: 'truncate',
          formatter: (p: { name: string; value: number }) =>
            `{n|${p.name}}\n{v|${compactMoney(p.value)}}`,
          rich: {
            n: { fontSize: 12.5, fontWeight: 600, lineHeight: 18 },
            v: { fontSize: 14, fontWeight: 600, lineHeight: 20 },
          },
        },
        upperLabel: { show: false },
        data: items.map((it, i) => ({
          name: it.name,
          value: it.value,
          itemStyle: { color: shades[Math.min(i, shades.length - 1)] },
          // Un cuadro chico no muestra texto cortado: se ve al tocarlo
          label: { show: it.value / total >= 0.08, color: i < 4 ? '#fff' : '#24255f' },
        })),
      },
    ],
  };
}

/** Cierres de caja: un punto por cierre (cuadró) o una barra verde (sobró) / roja (faltó). La escala sigue a la mayor diferencia. */
export function closingsChart(
  labels: string[],
  titles: string[],
  surplus: number[],
  shortage: number[],
): ChartOption {
  const max = Math.max(5, ...surplus, ...shortage.map((v) => -v));
  const top = Math.ceil((max * 1.2) / 5) * 5;
  return {
    grid: grid(),
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel,
    },
    yAxis: {
      type: 'value',
      min: -top,
      max: top,
      splitNumber: 2,
      axisLabel: { ...axisLabel, formatter: (v: number) => (v > 0 ? `+${v}` : String(v)) },
      splitLine: { lineStyle: { color: COLORS.grid } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(68,70,200,.06)' } },
      formatter: (items: { dataIndex: number }[]) => {
        const i = items[0].dataIndex;
        let html = `<b style="color:#fff">${esc(titles[i])}</b>`;
        if (!surplus[i] && !shortage[i]) return html + row('Cuadró exacto', '✓');
        if (surplus[i]) html += row('Sobró', money(surplus[i]), COLORS.green);
        if (shortage[i]) html += row('Faltó', money(-shortage[i]), COLORS.red);
        return html;
      },
    },
    series: [
      {
        name: 'Sobró',
        type: 'bar',
        stack: 'd',
        data: surplus,
        barMaxWidth: 18,
        itemStyle: { color: COLORS.green, borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'Faltó',
        type: 'bar',
        stack: 'd',
        data: shortage,
        barMaxWidth: 18,
        itemStyle: { color: COLORS.red, borderRadius: [0, 0, 4, 4] },
      },
      {
        name: 'Cuadró',
        type: 'scatter',
        data: surplus.map((s, i) => (s || shortage[i] ? null : 0)),
        symbolSize: 6,
        itemStyle: { color: COLORS.previous },
        tooltip: { show: false },
      },
    ],
  };
}
