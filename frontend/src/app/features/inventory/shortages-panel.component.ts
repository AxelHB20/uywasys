import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Shortage } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

/**
 * Insumos que se usaron sin stock registrado (el servicio nunca se bloquea por stock).
 * Aquí se ven y el administrador los da por resueltos después de registrar la compra
 * o el conteo. Si no hay ninguno, no se muestra nada.
 */
@Component({
  selector: 'app-shortages-panel',
  imports: [ReactiveFormsModule, RouterLink, FechaPipe, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <section
        id="faltantes"
        class="card scroll-mt-24 overflow-hidden"
        aria-labelledby="shortages-title"
      >
        <div class="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span
            class="grid size-10 shrink-0 place-items-center rounded-xl bg-maiz-100 text-amber-800"
          >
            <app-icon name="alert" class="size-5" />
          </span>
          <div class="min-w-0">
            <h2 id="shortages-title" class="font-semibold text-slate-900">
              Usados sin stock registrado
              <span class="ml-1 text-slate-500 tabular-nums">{{ items().length }}</span>
            </h2>
            <p class="mt-0.5 text-sm text-pretty text-slate-600">
              Se cobraron insumos que el sistema no tenía. Registra la compra o haz un conteo físico
              y luego márcalo como resuelto.
            </p>
          </div>
        </div>
        <ul class="divide-y divide-slate-100">
          @for (s of items(); track s.id) {
            <li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <div class="min-w-0 flex-1">
                <a
                  [routerLink]="['/inventario', s.product.id]"
                  class="font-medium text-slate-900 hover:text-anil-700"
                  >{{ s.product.name }}</a
                >
                <p class="text-sm text-slate-600">
                  Faltaron <span class="font-medium tabular-nums">{{ qty(s) }}</span> en
                  @if (s.charge.visitId) {
                    <a
                      [routerLink]="['/atenciones', s.charge.visitId]"
                      class="text-anil-700 hover:underline"
                      >{{ s.charge.description }}</a
                    >
                  } @else {
                    {{ s.charge.description }}
                  }
                  @if (s.charge.pet) {
                    · {{ s.charge.pet.name }}
                  }
                  · <span class="tabular-nums">{{ s.createdAt | fecha: 'datetime' }}</span>
                </p>
              </div>
              @if (canResolve()) {
                <button
                  type="button"
                  class="btn btn-secondary h-9"
                  [attr.aria-label]="'Resolver faltante de ' + s.product.name"
                  (click)="ask(s)"
                >
                  Resolver
                </button>
              }
            </li>
          }
        </ul>
      </section>
    }

    <app-modal
      [open]="!!resolving()"
      title="Resolver faltante"
      [description]="
        resolving() ? resolving()!.product.name + ' · faltaron ' + qty(resolving()!) : ''
      "
      [dismissible]="!saving()"
      (closed)="close()"
    >
      <label for="shortage-note" class="field-label"
        >¿Qué se hizo? <span class="text-rose-600" aria-hidden="true">*</span></label
      >
      <input
        id="shortage-note"
        [formControl]="note"
        class="field-input"
        maxlength="200"
        placeholder="Ej.: se registró la compra F001-123"
        [attr.aria-invalid]="note.invalid && note.touched"
      />
      @if (note.invalid && note.touched) {
        <p class="field-error">Escribe entre 3 y 200 caracteres</p>
      }
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="close()">Volver</button>
        <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="confirm()">
          Marcar como resuelto
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class ShortagesPanelComponent {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Solo el administrador puede darlos por resueltos */
  readonly canResolve = input(false);
  /** Al llegar desde la campana (?filtro=faltantes) se baja hasta el panel */
  readonly focus = input(false);

  protected readonly list = rxResource({ stream: () => this.inventory.shortages() });
  protected readonly items = computed(() => (this.list.hasValue() ? this.list.value() : []));
  protected readonly resolving = signal<Shortage | null>(null);
  protected readonly saving = signal(false);
  protected readonly note = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    effect(() => {
      if (this.focus() && this.items().length)
        queueMicrotask(() =>
          (this.host.nativeElement as HTMLElement)
            .querySelector('#faltantes')
            ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
        );
    });
  }

  protected qty(s: Shortage): string {
    return `${formatQty(s.quantity)} ${unitLabel(s.product.baseUnit, s.quantity)}`;
  }

  protected ask(s: Shortage): void {
    this.note.reset('');
    this.resolving.set(s);
  }

  protected close(): void {
    if (!this.saving()) this.resolving.set(null);
  }

  protected confirm(): void {
    const s = this.resolving();
    if (!s || this.saving()) return;
    if (this.note.invalid) {
      this.note.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.inventory.resolveShortage(s.id, this.note.value.trim()).subscribe({
      next: () => {
        this.saving.set(false);
        this.resolving.set(null);
        this.list.reload();
        this.toast.success('Faltante resuelto');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
