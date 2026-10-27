import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-host',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end"
      aria-live="polite"
      role="status"
    >
      @for (toast of toasts.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-anil-950 px-4 py-3 text-sm text-white shadow-xl shadow-anil-950/25"
        >
          <app-icon
            [name]="toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'"
            class="mt-0.5 size-[18px]"
            [class.text-emerald-300]="toast.tone === 'success'"
            [class.text-rose-300]="toast.tone === 'error'"
            [class.text-anil-200]="toast.tone === 'info'"
          />
          <p class="flex-1">{{ toast.message }}</p>
          <button
            type="button"
            (click)="toasts.dismiss(toast.id)"
            class="-m-1 grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="Cerrar aviso"
          >
            <app-icon name="x" class="size-4" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
}
