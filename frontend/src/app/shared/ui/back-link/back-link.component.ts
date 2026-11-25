import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  NavigationHistoryService,
  pageLabel,
} from '../../../core/navigation/navigation-history.service';
import { IconComponent } from '../icon/icon.component';

/**
 * "‹ Volver" de las pantallas de detalle: regresa a donde vino el usuario (con sus filtros) y dice
 * a dónde. Si entró directo por un enlace, va a `fallback`.
 *   <app-back-link fallback="/caja" fallbackLabel="Caja" />
 */
@Component({
  selector: 'app-back-link',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <a
      [href]="target()"
      class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 print:hidden"
      (click)="go($event)"
    >
      <app-icon name="chevron-left" class="size-4" /> {{ label() }}
    </a>
  `,
})
export class BackLinkComponent {
  private readonly history = inject(NavigationHistoryService);

  /** A dónde ir si no hay pantalla anterior en la app */
  readonly fallback = input.required<string>();
  readonly fallbackLabel = input.required<string>();

  protected readonly target = computed(() => this.history.previous() ?? this.fallback());
  protected readonly label = computed(() => {
    const prev = this.history.previous();
    return (prev && pageLabel(prev)) || this.fallbackLabel();
  });

  protected go(event: MouseEvent): void {
    // Ctrl/⌘ o rueda: que el navegador abra la pestaña nueva
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.history.back(this.fallback());
  }
}
