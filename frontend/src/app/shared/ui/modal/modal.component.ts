import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Modal accesible basado en <dialog> nativo: atrapa el foco, se cierra con Esc
 * y devuelve el foco al botón que lo abrió.
 * Uso: <app-modal [open]="abierto()" title="..." (closed)="abierto.set(false)"> contenido + <div modal-actions> </app-modal>
 */
@Component({
  selector: 'app-modal',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      (cancel)="$event.preventDefault(); closed.emit()"
      (click)="onBackdrop($event)"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="description() ? descriptionId : null"
      [class.lg:max-w-4xl]="size() === 'lg'"
      [class.lg:max-w-[60rem]]="size() === 'pos'"
      class="m-auto w-[calc(100%-2rem)] max-w-lg overflow-visible rounded-2xl bg-white p-0 text-slate-700 shadow-2xl shadow-anil-950/20
             backdrop:bg-anil-950/45 backdrop:backdrop-blur-[2px]"
    >
      <div class="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
        <div class="min-w-0 flex-1">
          <h2 [id]="titleId" class="font-display text-lg font-semibold text-slate-900">
            {{ title() }}
          </h2>
          @if (description()) {
            <p [id]="descriptionId" class="mt-1 text-sm text-slate-600">{{ description() }}</p>
          }
        </div>
        <button
          type="button"
          (click)="closed.emit()"
          class="btn btn-ghost -mr-2 -mt-1 size-11 px-0"
          aria-label="Cerrar"
        >
          <app-icon name="x" class="size-5" />
        </button>
      </div>
      <!-- 'pos' (caja): el contenido arma sus zonas (lista + panel) y lleva su propio botón -->
      <div
        [class]="
          size() === 'pos'
            ? 'h-[min(44rem,calc(100dvh-9rem))] overflow-hidden rounded-b-2xl'
            : 'max-h-[70dvh] overflow-y-auto px-6 py-5'
        "
      >
        <ng-content />
      </div>
      <div
        class="flex flex-col-reverse gap-2 border-t border-slate-100 px-6 py-4 sm:flex-row sm:justify-end"
        [class.hidden]="size() === 'pos'"
      >
        <ng-content select="[modal-actions]" />
      </div>
    </dialog>
  `,
})
export class ModalComponent {
  private static nextId = 0;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly open = input(false);
  readonly title = input.required<string>();
  readonly description = input('');
  /** Si es false, hacer clic fuera no cierra (útil en formularios). */
  readonly dismissible = input(true);
  /** 'lg': ancho en laptop/tablet horizontal para formularios en dos columnas (cobro, venta) */
  readonly size = input<'md' | 'lg' | 'pos'>('md');
  readonly closed = output<void>();

  protected readonly titleId = `modal-title-${ModalComponent.nextId}`;
  protected readonly descriptionId = `modal-desc-${ModalComponent.nextId++}`;

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open() && !dialog.open) dialog.showModal();
      if (!this.open() && dialog.open) dialog.close();
    });
  }

  protected onBackdrop(event: MouseEvent): void {
    if (this.dismissible() && event.target === this.dialog().nativeElement) this.closed.emit();
  }
}
