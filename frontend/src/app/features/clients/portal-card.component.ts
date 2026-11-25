import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionService } from '../../core/auth/session.service';
import { portalWhatsapp } from '../../core/services/portal.models';
import { PortalService } from '../../core/services/portal.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatPhone } from '../../shared/utils/peru';
import { apiErrorMessage } from '../../shared/utils/validators';
import { loaded } from '../../shared/utils/resource';

/**
 * Tarjeta "Portal del dueño" en la ficha del cliente: genera el enlace personal (carnet, citas y
 * recetas), lo envía por WhatsApp y lo desactiva. El enlace solo se ve al generarlo.
 */
@Component({
  selector: 'app-portal-card',
  imports: [FechaPipe, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card p-5" aria-labelledby="portal-title">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2
            id="portal-title"
            class="text-xs font-semibold tracking-wide text-slate-500 uppercase"
          >
            Portal del dueño
          </h2>
          <p class="mt-1 text-sm text-slate-600">
            Carnet de vacunas, próximas citas y recetas en su celular, sin contraseña.
          </p>
        </div>
        <span
          class="grid size-9 shrink-0 place-items-center rounded-xl bg-anil-50 text-anil-700"
          aria-hidden="true"
        >
          <app-icon name="paw" class="size-4" />
        </span>
      </div>

      @if (status.isLoading() && !status.hasValue()) {
        <div class="mt-4 h-10 animate-pulse rounded-xl bg-slate-100"></div>
      } @else if (status.error()) {
        <p class="mt-3 flex items-center gap-3 text-sm text-slate-700" role="alert">
          <span class="flex-1">No se pudo ver el estado del portal.</span>
          <button type="button" class="btn btn-secondary h-9 px-3" (click)="status.reload()">
            Reintentar
          </button>
        </p>
      } @else if (portal(); as s) {
        @if (s.active) {
          <p
            class="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200"
          >
            <app-icon name="check" class="mt-0.5 size-4 shrink-0" />
            <span>
              Enlace activo hasta el {{ s.expiresAt | fecha: 'date' }}
              <span class="block text-xs text-emerald-800/80">
                @if (s.viewCount) {
                  Lo abrió {{ s.viewCount }} {{ s.viewCount === 1 ? 'vez' : 'veces' }} · última
                  {{ s.lastViewedAt | fecha: 'datetime' }}
                } @else {
                  Aún no lo abre
                }
              </span>
            </span>
          </p>
        }
        @if (canEdit()) {
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn h-10"
              [class]="s.active ? 'btn-secondary' : 'btn-primary'"
              [disabled]="busy()"
              (click)="generate()"
            >
              <app-icon
                [name]="busy() ? 'loader' : 'message-circle'"
                class="size-4"
                [class.animate-spin]="busy()"
              />
              {{ s.active ? 'Enviar enlace nuevo' : 'Crear y enviar enlace' }}
            </button>
            @if (s.active) {
              <button
                type="button"
                class="btn btn-ghost h-10 text-rose-700 hover:text-rose-800"
                (click)="confirmRevoke.set(true)"
              >
                Desactivar
              </button>
            }
          </div>
          @if (s.active) {
            <p class="mt-2 text-xs text-slate-500">
              Por seguridad el enlace solo se muestra al crearlo; uno nuevo reemplaza al anterior.
            </p>
          }
        }
      }
    </section>

    <!-- Enlace recién creado -->
    <app-modal
      [open]="!!url()"
      title="Enlace del portal listo"
      description="Envíalo al dueño. Es personal: quien lo tenga ve las vacunas, citas y recetas."
      (closed)="url.set(null)"
    >
      @if (url(); as link) {
        <div class="space-y-4">
          <div class="flex gap-2">
            <label for="portal-url" class="sr-only">Enlace</label>
            <input
              id="portal-url"
              readonly
              class="field-input mt-0 font-mono text-sm"
              [value]="link"
              (focus)="$any($event.target).select()"
            />
            <button type="button" class="btn btn-secondary shrink-0" (click)="copy(link)">
              <app-icon [name]="copied() ? 'check' : 'copy'" class="size-4" />
              {{ copied() ? 'Copiado' : 'Copiar' }}
            </button>
          </div>
          <a class="btn btn-primary w-full" [href]="whatsapp(link)" target="_blank" rel="noopener">
            <app-icon name="message-circle" class="size-4" /> Enviar por WhatsApp al
            {{ formatPhone(phone()) }}
          </a>
          <p class="text-xs text-slate-500">
            Vale 6 meses. Si el dueño lo pierde o cambia de celular, genera uno nuevo y el anterior
            deja de funcionar.
          </p>
        </div>
      }
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="url.set(null)">Listo</button>
      </ng-container>
    </app-modal>

    <!-- Desactivar -->
    <app-modal
      [open]="confirmRevoke()"
      title="Desactivar el portal"
      description="El enlace que tiene el dueño dejará de funcionar. Puedes crear otro cuando quieras."
      (closed)="confirmRevoke.set(false)"
    >
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="confirmRevoke.set(false)">
          Volver
        </button>
        <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="revoke()">
          Desactivar enlace
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class PortalCardComponent {
  private readonly api = inject(PortalService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);

  readonly clientId = input.required<number>();
  readonly clientName = input.required<string>();
  readonly phone = input.required<string>();
  readonly canEdit = input(false);

  protected readonly status = rxResource({
    params: () => ({ id: this.clientId() }),
    stream: ({ params }) => this.api.status(params.id),
  });
  protected readonly portal = loaded(this.status);
  protected readonly formatPhone = formatPhone;
  protected readonly busy = signal(false);
  protected readonly url = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly confirmRevoke = signal(false);
  private readonly firstName = computed(() => this.clientName().trim().split(/\s+/)[0] ?? '');

  protected generate(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.create(this.clientId()).subscribe({
      next: ({ token }) => {
        this.busy.set(false);
        this.copied.set(false);
        this.url.set(this.api.link(token));
        this.status.reload();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected revoke(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.revoke(this.clientId()).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmRevoke.set(false);
        this.toast.success('Enlace desactivado.');
        this.status.reload();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected copy(link: string): void {
    void navigator.clipboard?.writeText(link).then(
      () => this.copied.set(true),
      () => this.toast.error('No se pudo copiar: selecciona el enlace y cópialo.'),
    );
  }

  protected whatsapp(link: string): string {
    return portalWhatsapp(this.phone(), this.firstName(), this.session.clinicName(), link);
  }
}
