import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NotificationsService } from '../../services/notifications.service';
import { SystemBanner } from '../../services/notifications.models';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { limaDate } from '../../../shared/utils/records';

const HIDDEN_KEY = 'uywa.banners-hidden';

/**
 * Avisos que duran mientras dure el problema (facturación detenida, sin conexión con el PSE…).
 * Un solo lugar, arriba del contenido: se ve el más grave y los demás se abren con "+N".
 * Los rojos no se ocultan; los ámbar se pueden ocultar hasta el día siguiente.
 */
@Component({
  selector: 'app-system-banners',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible().length) {
      <div class="px-4 pt-2 pb-2 sm:px-6 lg:px-8" animate.leave="banner-out">
        <div class="mx-auto w-full max-w-7xl space-y-2">
          @for (b of shown(); track b.id; let first = $first) {
            <section
              animate.enter="banner-in"
              animate.leave="banner-out"
              class="flex flex-col gap-3 rounded-2xl px-4 py-3 ring-1 sm:flex-row sm:items-center sm:gap-4"
              [class]="
                b.tone === 'danger'
                  ? 'bg-rose-50 text-rose-950 ring-rose-200'
                  : 'bg-amber-50 text-amber-950 ring-amber-200'
              "
              [attr.role]="b.tone === 'danger' ? 'alert' : 'status'"
              [attr.aria-labelledby]="'banner-' + $index"
            >
              <div class="flex min-w-0 flex-1 items-start gap-3">
                <span
                  class="grid size-9 shrink-0 place-items-center rounded-xl"
                  [class]="
                    b.tone === 'danger'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-800'
                  "
                  aria-hidden="true"
                >
                  <app-icon [name]="b.tone === 'danger' ? 'alert' : 'clock'" class="size-5" />
                </span>
                <div class="min-w-0">
                  <p [id]="'banner-' + $index" class="font-semibold">{{ b.title }}</p>
                  <p
                    class="mt-0.5 text-sm text-pretty"
                    [class]="b.tone === 'danger' ? 'text-rose-900' : 'text-amber-900'"
                  >
                    {{ b.detail }}
                  </p>
                </div>
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-2 pl-12 sm:pl-0">
                @if (first && hiddenCount() && !expanded()) {
                  <button
                    type="button"
                    class="h-10 rounded-lg px-3 text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                    [class]="
                      b.tone === 'danger'
                        ? 'text-rose-800 focus-visible:outline-rose-600'
                        : 'text-amber-900 focus-visible:outline-amber-600'
                    "
                    [attr.aria-expanded]="false"
                    (click)="expanded.set(true)"
                  >
                    +{{ hiddenCount() }} {{ hiddenCount() === 1 ? 'aviso' : 'avisos' }}
                  </button>
                }
                @if (b.action; as action) {
                  <a
                    [routerLink]="action.link"
                    class="btn h-10 px-4 text-sm"
                    [class]="b.tone === 'danger' ? 'btn-danger' : 'btn-secondary'"
                  >
                    {{ action.label }}
                  </a>
                }
                @if (b.dismissible) {
                  <button
                    type="button"
                    class="grid size-10 place-items-center rounded-lg text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-600"
                    [attr.aria-label]="'Ocultar hasta mañana: ' + b.title"
                    title="Ocultar hasta mañana"
                    (click)="hide(b)"
                  >
                    <app-icon name="x" class="size-4" />
                  </button>
                }
              </div>
            </section>
          }
        </div>
      </div>
    }
  `,
})
export class SystemBannersComponent {
  private readonly center = inject(NotificationsService);
  protected readonly expanded = signal(false);
  private readonly hidden = signal<Record<string, string>>(readHidden());

  /** Los que no se ocultaron hoy, los rojos primero */
  protected readonly visible = computed(() => {
    const today = limaDate(new Date());
    const hidden = this.hidden();
    return this.center
      .banners()
      .filter((b) => !(b.dismissible && hidden[b.id] === today))
      .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1));
  });
  protected readonly shown = computed(() =>
    this.expanded() ? this.visible() : this.visible().slice(0, 1),
  );
  protected readonly hiddenCount = computed(() => this.visible().length - 1);

  protected hide(b: SystemBanner): void {
    // Solo se guarda lo de hoy: lo de días anteriores ya no sirve
    const today = limaDate(new Date());
    const next = Object.fromEntries(
      Object.entries(this.hidden()).filter(([, day]) => day === today),
    );
    next[b.id] = today;
    this.hidden.set(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      // Sin almacenamiento: se oculta solo en esta pestaña
    }
  }
}

function readHidden(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}
