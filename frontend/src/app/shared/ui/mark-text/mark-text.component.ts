import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { markMatch } from '../../utils/highlight';

/**
 * Texto con lo buscado en negrita (sin fondo: se lee como texto, no como un error). Cada trozo va
 * en su propio elemento: Angular quita los espacios de formato entre elementos, así un número no
 * aparece partido.
 */
@Component({
  selector: 'app-mark-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (part of parts(); track $index) {
      @if (part.hit) {
        <mark class="bg-transparent font-semibold text-slate-900">{{ part.text }}</mark>
      } @else {
        <span>{{ part.text }}</span>
      }
    }
  `,
})
export class MarkTextComponent {
  readonly text = input.required<string>();
  readonly query = input<string>('');
  protected readonly parts = computed(() => markMatch(this.text(), this.query()));
}
