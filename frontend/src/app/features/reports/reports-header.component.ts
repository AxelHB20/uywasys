import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReportsTabsComponent } from './reports-tabs.component';

/** Encabezado común de Reportes: título, qué muestra esta pestaña y las pestañas. */
@Component({
  selector: 'app-reports-header',
  imports: [ReportsTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block space-y-5' },
  template: `
    <div>
      <div>
        <h1 class="font-display text-2xl font-semibold tracking-tight text-slate-900">Reportes</h1>
        <p class="mt-1 text-sm text-slate-600">{{ description() }}</p>
      </div>
    </div>
    <app-reports-tabs />
  `,
})
export class ReportsHeaderComponent {
  readonly description = input.required<string>();
}
