import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';

/** Pantalla temporal para los módulos que aún no están construidos (los datos llegan por la ruta). */
@Component({
  selector: 'app-coming-soon-page',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-slate-200/70">
      <div class="h-28 bg-anil-900 bg-chakana" aria-hidden="true"></div>
      <div class="-mt-10 flex flex-col items-center px-6 pb-12 text-center">
        <span
          class="grid size-20 place-items-center rounded-2xl bg-white text-anil-600 shadow-card ring-1 ring-slate-200/70"
        >
          <app-icon [name]="icon()" class="size-9" [strokeWidth]="1.5" />
        </span>
        <h1 class="mt-5 font-display text-2xl font-semibold text-slate-900">{{ title() }}</h1>
        <p class="mt-2 max-w-md text-slate-500">{{ description() }}</p>
        <p class="mt-5 rounded-full bg-maiz-100 px-3 py-1 text-sm font-medium text-amber-800">
          Llega en la {{ phase() }}
        </p>
        <a
          routerLink="/dashboard"
          class="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-anil-600 px-5 text-sm font-semibold text-white shadow-sm shadow-anil-600/30 hover:bg-anil-700"
        >
          <app-icon name="chevron-left" class="size-4" /> Volver al dashboard
        </a>
      </div>
    </section>
  `,
})
export class ComingSoonPage {
  readonly title = input('Módulo en construcción');
  readonly description = input('');
  readonly phase = input('próxima fase');
  readonly icon = input<IconName>('hammer');
}
