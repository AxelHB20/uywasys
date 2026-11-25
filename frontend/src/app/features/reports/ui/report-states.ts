import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { IconName } from '../../../shared/ui/icon/icons';

/** Esqueleto con brillo suave (nada gira) mientras llega el reporte */
@Component({
  selector: 'app-report-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-busy': 'true', role: 'status' },
  template: `
    <span class="sr-only">{{ label() }}</span>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
      @for (i of [1, 2, 3, 4]; track i) {
        <div class="sk h-28 rounded-2xl"></div>
      }
    </div>
    <div class="sk mt-4 h-64 rounded-2xl" aria-hidden="true"></div>
    <div class="mt-4 grid gap-4 lg:grid-cols-2" aria-hidden="true">
      <div class="sk h-56 rounded-2xl"></div>
      <div class="sk h-56 rounded-2xl"></div>
    </div>
  `,
  styles: `
    .sk {
      background: linear-gradient(90deg, #eef0f6 0%, #f7f8fb 50%, #eef0f6 100%);
      background-size: 200% 100%;
      animation: sk 1.4s ease-in-out infinite;
    }
    @keyframes sk {
      to {
        background-position: -200% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .sk {
        animation: none;
      }
    }
  `,
})
export class ReportSkeletonComponent {
  readonly label = input('Cargando el reporte');
}

/** No se pudo calcular: lo que ya se veía sigue ahí y se puede reintentar */
@Component({
  selector: 'app-report-error',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div role="alert" class="card flex flex-col items-center px-5 py-8 text-center">
      <span class="grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-600"
        ><app-icon name="alert" class="size-6"
      /></span>
      <h2 class="mt-3 font-display text-base font-semibold text-slate-900">
        No se pudo calcular el reporte
      </h2>
      <p class="mt-1 text-sm text-slate-500">{{ message() }}</p>
      <button type="button" class="btn btn-primary mt-4" (click)="retry.emit()">
        <app-icon name="refresh" class="size-4" /> Reintentar
      </button>
    </div>
  `,
})
export class ReportErrorComponent {
  readonly message = input('Revisa tu conexión e inténtalo de nuevo.');
  readonly retry = output<void>();
}

/** Sin datos en el período: una frase y una salida, no gráficos vacíos */
@Component({
  selector: 'app-report-empty',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="card flex flex-col items-center px-5 py-10 text-center">
      <span class="grid size-12 place-items-center rounded-2xl bg-anil-50 text-anil-700"
        ><app-icon [name]="icon()" class="size-6"
      /></span>
      <h2 class="mt-3 font-display text-base font-semibold text-slate-900">{{ heading() }}</h2>
      <p class="mt-1 max-w-md text-sm text-slate-500">{{ text() }}</p>
      <div class="mt-4 flex flex-wrap justify-center gap-2"><ng-content /></div>
    </div>
  `,
})
export class ReportEmptyComponent {
  readonly heading = input.required<string>();
  readonly text = input.required<string>();
  readonly icon = input<IconName>('chart-column');
}
