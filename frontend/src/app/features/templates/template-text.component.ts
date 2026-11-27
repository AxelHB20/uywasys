import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Texto de una plantilla con los "___" resaltados como dato por llenar.
 * Cada trozo va en su propio elemento para que Angular no se coma los espacios.
 */
@Component({
  selector: 'app-template-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (part of parts(); track $index) {
      @if (part.blank) {
        <mark
          class="rounded bg-amber-100 px-1 font-medium text-amber-900"
          aria-label="dato por llenar"
          >{{ part.text }}</mark
        >
      } @else {
        <span>{{ part.text }}</span>
      }
    }
  `,
})
export class TemplateTextComponent {
  readonly text = input.required<string>();
  protected readonly parts = computed(() =>
    this.text()
      .split(/(_{2,})/)
      .filter(Boolean)
      .map((t) => ({ text: t, blank: /^_{2,}$/.test(t) })),
  );
}
