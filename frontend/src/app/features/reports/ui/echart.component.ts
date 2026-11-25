import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

/** Opciones de ECharts (se tipan sueltas para no cargar ECharts en el paquete principal) */
export type ChartOption = Record<string, unknown>;

interface ChartInstance {
  setOption(option: ChartOption, opts?: { notMerge?: boolean }): void;
  resize(): void;
  dispose(): void;
  on(event: string, handler: (params: { dataIndex: number }) => void): void;
}

const FONT = 'Figtree, ui-sans-serif, system-ui, sans-serif';

/** Estilo común: letras del sistema, ejes suaves, detalle oscuro y sin animación si se pidió */
function withTheme(option: ChartOption, reduced: boolean): ChartOption {
  return {
    animation: !reduced,
    animationDuration: 300,
    animationDurationUpdate: 250,
    textStyle: { fontFamily: FONT, color: '#475569' },
    aria: { enabled: true, decal: { show: false } },
    ...option,
    tooltip: option['tooltip']
      ? {
          backgroundColor: '#0f172a',
          borderWidth: 0,
          padding: [10, 12],
          textStyle: { color: '#e2e8f0', fontFamily: FONT, fontSize: 12.5 },
          extraCssText: 'border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.25);',
          confine: true,
          ...(option['tooltip'] as object),
        }
      : undefined,
  };
}

/**
 * Gráfico de ECharts: se carga perezoso, se ajusta al ancho de su tarjeta (no al de la pantalla)
 * y se redibuja al girar la tablet. El texto de `label` lo leen los lectores de pantalla; cada
 * tarjeta trae además su resumen o tabla en texto.
 */
@Component({
  selector: 'app-echart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `<div
    #host
    class="w-full"
    [style.height.px]="height()"
    role="img"
    [attr.aria-label]="label()"
  ></div>`,
})
export class EchartComponent {
  readonly option = input.required<ChartOption>();
  readonly label = input.required<string>();
  readonly height = input(240);
  /** Toque o clic en una barra o punto */
  readonly picked = output<number>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private chart: ChartInstance | null = null;
  private readonly reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Sin ResizeObserver (pruebas, navegadores muy viejos) no se dibuja: queda el texto
      if (typeof ResizeObserver === 'undefined') return;
      const el = this.host().nativeElement;
      let observer: ResizeObserver | null = null;
      let disposed = false;
      void import('./echarts-setup').then(({ echarts }) => {
        if (disposed) return;
        this.chart = echarts.init(el, null, { renderer: 'svg' }) as unknown as ChartInstance;
        this.chart.on('click', (p) => this.picked.emit(p.dataIndex));
        this.chart.setOption(withTheme(this.option(), this.reduced), { notMerge: true });
        observer = new ResizeObserver(() => this.chart?.resize());
        observer.observe(el);
      });
      destroyRef.onDestroy(() => {
        disposed = true;
        observer?.disconnect();
        this.chart?.dispose();
      });
    });
    effect(() => {
      const option = this.option();
      this.chart?.setOption(withTheme(option, this.reduced), { notMerge: true });
    });
  }
}
