import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Firma en pantalla con el dedo, lápiz o mouse (pointer events). Entrega un PNG en data URL
 * cada vez que termina un trazo, o null si se borra.
 */
@Component({
  selector: 'app-signature-pad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <canvas
        #canvas
        class="block h-48 w-full touch-none rounded-xl bg-white ring-1 sm:h-56"
        [class]="invalid() ? 'ring-2 ring-rose-400' : 'ring-slate-300'"
        [attr.aria-label]="label()"
        role="img"
        (pointerdown)="start($event)"
        (pointermove)="move($event)"
        (pointerup)="end($event)"
        (pointercancel)="end($event)"
        (pointerleave)="end($event)"
      ></canvas>
      <div
        class="pointer-events-none absolute inset-x-6 bottom-10 border-b border-dashed border-slate-300"
        aria-hidden="true"
      ></div>
      @if (empty()) {
        <p
          class="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400"
          aria-hidden="true"
        >
          Firme aquí con el dedo o el mouse
        </p>
      }
      @if (!empty()) {
        <button
          type="button"
          class="absolute top-2 right-2 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:text-slate-900"
          (click)="clear()"
        >
          Borrar
        </button>
      }
    </div>
  `,
})
export class SignaturePadComponent implements AfterViewInit, OnDestroy {
  readonly label = input('Espacio para firmar');
  readonly invalid = input(false);
  readonly changed = output<string | null>();

  protected readonly empty = signal(true);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;
  private last: { x: number; y: number } | null = null;
  private resize?: ResizeObserver;
  /** Trazos en coordenadas del lienzo al ancho `width`, para redibujar al cambiar de tamaño */
  private strokes: { x: number; y: number }[][] = [];
  private width = 0;
  private height = 0;

  ngAfterViewInit(): void {
    const canvas = this.canvas().nativeElement;
    this.setup(canvas);
    if (typeof ResizeObserver !== 'undefined') {
      // Al rotar el celular o cambiar el ancho (p. ej. aparece la barra de desplazamiento), el
      // lienzo se ajusta y la firma se vuelve a dibujar a la nueva escala: no se pierde.
      this.resize = new ResizeObserver(() => {
        if (
          canvas.clientWidth &&
          (canvas.clientWidth !== this.width || canvas.clientHeight !== this.height)
        )
          this.redraw(canvas);
      });
      this.resize.observe(canvas);
    }
  }

  ngOnDestroy(): void {
    this.resize?.disconnect();
  }

  clear(): void {
    const canvas = this.canvas().nativeElement;
    this.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    this.strokes = [];
    this.empty.set(true);
    this.changed.emit(null);
  }

  protected start(event: PointerEvent): void {
    if (!this.ctx) return;
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.drawing = true;
    this.last = this.point(event);
    this.strokes.push([this.last]);
    this.dot(this.last);
  }

  protected move(event: PointerEvent): void {
    if (!this.drawing || !this.ctx || !this.last) return;
    event.preventDefault();
    const p = this.point(event);
    this.line(this.last, p);
    this.strokes.at(-1)?.push(p);
    this.last = p;
    this.empty.set(false);
  }

  protected end(event: PointerEvent): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.last = null;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (!this.empty()) this.changed.emit(this.canvas().nativeElement.toDataURL('image/png'));
  }

  private redraw(canvas: HTMLCanvasElement): void {
    const sx = this.width ? canvas.clientWidth / this.width : 1;
    const sy = this.height ? canvas.clientHeight / this.height : 1;
    this.setup(canvas);
    this.strokes = this.strokes.map((stroke) => stroke.map((p) => ({ x: p.x * sx, y: p.y * sy })));
    for (const stroke of this.strokes) {
      this.dot(stroke[0]);
      for (let i = 1; i < stroke.length; i++) this.line(stroke[i - 1], stroke[i]);
    }
    if (!this.empty()) this.changed.emit(canvas.toDataURL('image/png'));
  }

  private dot(p: { x: number; y: number }): void {
    if (!this.ctx) return;
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private line(a: { x: number; y: number }, b: { x: number; y: number }): void {
    if (!this.ctx) return;
    this.ctx.beginPath();
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
    this.ctx.stroke();
  }

  private setup(canvas: HTMLCanvasElement): void {
    this.width = canvas.clientWidth;
    this.height = canvas.clientHeight;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;
    this.ctx.scale(ratio, ratio);
    this.ctx.lineWidth = 2.2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#0f172a';
    this.ctx.fillStyle = '#0f172a';
  }

  private point(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
}
