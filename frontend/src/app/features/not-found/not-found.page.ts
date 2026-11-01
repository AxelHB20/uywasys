import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** Dirección que no existe (enlace viejo, error al escribir). */
@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card flex flex-col items-center px-6 py-16 text-center">
      <span class="grid size-16 place-items-center rounded-2xl bg-anil-50 text-anil-600">
        <app-icon name="search" class="size-8" [strokeWidth]="1.5" />
      </span>
      <h1 class="mt-5 font-display text-2xl font-semibold text-balance text-slate-900">
        Esta página no existe
      </h1>
      <p class="mt-2 max-w-md text-pretty text-slate-600">
        Puede que el enlace esté mal escrito o que la página se haya movido. Tus datos están a
        salvo.
      </p>
      <div class="mt-8 flex flex-wrap justify-center gap-2">
        <a routerLink="/dashboard" class="btn btn-primary">
          <app-icon name="chevron-left" class="size-4" /> Volver al inicio
        </a>
        <a routerLink="/clientes" class="btn btn-secondary">Buscar un cliente</a>
      </div>
    </section>
  `,
})
export class NotFoundPage {}
