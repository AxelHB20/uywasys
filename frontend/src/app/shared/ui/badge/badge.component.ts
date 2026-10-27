import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/15',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warning: 'bg-maiz-100 text-amber-900 ring-amber-600/25',
  danger: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  info: 'bg-anil-50 text-anil-800 ring-anil-600/20',
};

/** Etiqueta de estado. El color acompaña al texto: nunca es la única señal. */
@Component({
  selector: 'app-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `<span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset"
    [class]="classes()"
    ><ng-content
  /></span>`,
})
export class BadgeComponent {
  readonly tone = input<BadgeTone>('neutral');
  protected readonly classes = computed(() => TONES[this.tone()]);
}
