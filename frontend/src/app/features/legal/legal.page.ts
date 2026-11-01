import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDate } from '../../shared/utils/dates';
import { LogoComponent } from '../../shared/ui/logo/logo.component';
import { LEGAL_UPDATED, PRIVACY, TERMS, UYWA_COMPANY } from './legal-content';

/** Términos del servicio y Política de privacidad. Públicas: se leen sin iniciar sesión. */
@Component({
  selector: 'app-legal-page',
  imports: [RouterLink, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-dvh bg-canvas">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a
            routerLink="/login"
            class="flex items-center gap-2 font-display font-semibold text-anil-900"
          >
            <app-logo class="size-7" /> {{ company.name }}
          </a>
          <nav class="flex gap-4 text-sm font-medium" aria-label="Documentos legales">
            <a
              routerLink="/legal/terminos"
              class="text-slate-600 hover:text-slate-900"
              [class.text-anil-700]="doc() === 'terminos'"
              [attr.aria-current]="doc() === 'terminos' ? 'page' : null"
              >Términos</a
            >
            <a
              routerLink="/legal/privacidad"
              class="text-slate-600 hover:text-slate-900"
              [class.text-anil-700]="doc() === 'privacidad'"
              [attr.aria-current]="doc() === 'privacidad' ? 'page' : null"
              >Privacidad</a
            >
          </nav>
        </div>
      </header>

      <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <article class="card px-6 py-8 sm:px-10">
          <h1 class="font-display text-3xl font-semibold text-balance text-slate-900">
            {{ content().title }}
          </h1>
          <p class="mt-2 text-sm text-slate-500">Actualizado el {{ updated }}</p>
          <p class="mt-6 text-pretty text-slate-700">{{ content().intro }}</p>

          @for (section of content().sections; track section.title; let i = $index) {
            <section class="mt-8">
              <h2 class="font-display text-lg font-semibold text-slate-900">
                {{ i + 1 }}. {{ section.title }}
              </h2>
              @for (p of section.paragraphs; track $index) {
                <p class="mt-3 text-pretty text-slate-700">{{ p }}</p>
              }
            </section>
          }
        </article>
        <p class="mt-6 text-center text-sm">
          <a routerLink="/login" class="font-medium text-anil-700 hover:text-anil-900"
            >Volver al inicio de sesión</a
          >
        </p>
      </main>
    </div>
  `,
})
export class LegalPage {
  /** Viene de la ruta: data.doc */
  readonly doc = input<'terminos' | 'privacidad'>('terminos');

  protected readonly company = UYWA_COMPANY;
  protected readonly updated = formatDate(LEGAL_UPDATED, 'calendar');
  protected readonly content = computed(() => (this.doc() === 'privacidad' ? PRIVACY : TERMS));
}
