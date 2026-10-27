import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Isotipo de Uywa: chakana escalonada con una huella al centro. */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 40 40" class="size-full">
      <rect width="40" height="40" rx="12" class="fill-anil-600" />
      <path d="M16 7h8v4h4v4h4v10h-4v4h-4v4h-8v-4h-4v-4H8V15h4v-4h4z" class="fill-anil-500" />
      <path
        d="M17.5 11h5v3.5H26V18h3.5v4H26v3.5h-3.5V29h-5v-3.5H14V22h-3.5v-4H14v-3.5h3.5z"
        fill="none"
        class="stroke-maiz-400"
        stroke-width="1.5"
      />
      <ellipse cx="20" cy="22.2" rx="3.2" ry="2.6" fill="#fff" />
      <circle cx="16.3" cy="18" r="1.3" fill="#fff" />
      <circle cx="19" cy="16.4" r="1.3" fill="#fff" />
      <circle cx="21.9" cy="16.4" r="1.3" fill="#fff" />
      <circle cx="24.4" cy="18" r="1.3" fill="#fff" />
    </svg>
  `,
})
export class LogoComponent {}
