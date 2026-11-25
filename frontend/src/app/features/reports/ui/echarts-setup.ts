/**
 * ECharts 6 (Apache, gratis) armado solo con lo que usa Reportes: este archivo se carga recién al
 * abrir un gráfico, así que no pesa en el resto del sistema.
 */
import {
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  ScatterChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  MarkAreaComponent,
  MarkLineComponent,
  AriaComponent,
  SVGRenderer,
]);

export { echarts };
