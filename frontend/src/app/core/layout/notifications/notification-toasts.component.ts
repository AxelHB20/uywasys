import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TONE_TILE } from '../../services/notifications.models';
import { NotificationToast, NotificationsService } from '../../services/notifications.service';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

/**
 * Avisos emergentes de lo que acaba de pasar (llegó un paciente, listo para cobrar…). No roban el
 * foco, se van solos (8 s; 14 s las urgencias), se pausan con el mouse encima y como mucho hay 3.
 */
@Component({
  selector: 'app-notification-toasts',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="pointer-events-none fixed top-20 right-4 left-4 z-[65] flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      aria-live="polite"
      aria-label="Avisos"
    >
      @for (t of notifications.panelOpen() ? [] : notifications.toasts(); track t.id) {
        <article
          animate.enter="notif-in"
          animate.leave="notif-out"
          class="group pointer-events-auto relative w-full overflow-hidden rounded-2xl bg-white shadow-xl shadow-anil-950/10 ring-1"
          [class]="t.urgent ? 'ring-rose-200' : 'ring-slate-200'"
          [attr.role]="t.urgent ? 'alert' : null"
        >
          <div class="flex items-start gap-3 p-3.5 pr-10">
            <span
              class="grid size-9 shrink-0 place-items-center rounded-xl"
              [class]="tile[t.view.tone]"
              aria-hidden="true"
            >
              <app-icon [name]="t.view.icon" class="size-4" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-slate-900">{{ t.view.title }}</p>
              @if (t.view.detail) {
                <p class="mt-0.5 line-clamp-2 text-sm text-slate-600">{{ t.view.detail }}</p>
              }
              <button
                type="button"
                class="mt-2 inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-sm font-medium ring-1 transition-colors"
                [class]="
                  t.urgent
                    ? 'bg-rose-600 text-white ring-rose-600 hover:bg-rose-700'
                    : 'bg-white text-anil-700 ring-anil-200 hover:bg-anil-50'
                "
                (click)="go(t)"
              >
                {{ t.view.action }}
                <app-icon name="chevron-right" class="size-3.5" />
              </button>
            </div>
          </div>
          <button
            type="button"
            class="absolute top-2 right-2 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar aviso"
            (click)="notifications.dismiss(t.id)"
          >
            <app-icon name="x" class="size-4" />
          </button>
          <!-- Tiempo que le queda: se pausa con el mouse encima o el foco dentro -->
          <span
            class="notif-timer absolute inset-x-0 bottom-0 h-0.5 origin-left group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]"
            [class]="t.urgent ? 'bg-rose-500' : 'bg-anil-400'"
            [style.animation-duration.ms]="t.urgent ? 14000 : 8000"
            (animationend)="notifications.dismiss(t.id)"
            aria-hidden="true"
          ></span>
        </article>
      }
    </section>
  `,
})
export class NotificationToastsComponent {
  protected readonly notifications = inject(NotificationsService);
  protected readonly tile = TONE_TILE;

  protected go(t: NotificationToast): void {
    this.notifications.dismiss(t.id);
    this.notifications.open(t.link, t.query);
  }
}
