import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, map, of, switchMap } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES, SPECIES_LABELS } from '../../core/services/clients.models';
import {
  ESTIMATE_STATUS_LABELS,
  EstimatePrint,
  estimateMessage,
} from '../../core/services/estimates.models';
import { EstimatesService } from '../../core/services/estimates.service';
import { VisitSummary } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petCode } from '../../shared/utils/records';
import { formatQty, money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { ESTIMATE_TONE } from './estimates.page';

type Modal = 'accept' | 'reject' | 'convert' | null;

/**
 * Presupuesto: documento imprimible (A4) y sus pasos — aceptar o no, y cargarlo a una
 * atención abierta de la mascota (o abrir una en ese momento).
 */
@Component({
  selector: 'app-estimate-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    FechaPipe,
    BadgeComponent,
    IconComponent,
    ModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-5">
      <a
        routerLink="/presupuestos"
        class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 print:hidden"
      >
        <app-icon name="chevron-left" class="size-4" /> Presupuestos
      </a>

      @if (loading() && !estimate()) {
        <div class="card mx-auto h-96 max-w-[210mm] animate-pulse" aria-busy="true"></div>
      } @else if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
        </div>
      } @else if (estimate(); as e) {
        <!-- Barra de acciones -->
        <div
          class="card mx-auto flex max-w-[210mm] flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between print:hidden"
        >
          <div class="flex min-w-0 items-center gap-3">
            <app-badge [tone]="tone[e.status]">{{ labels[e.status] }}</app-badge>
            <p class="text-sm text-slate-600">
              @switch (e.status) {
                @case ('PENDING') {
                  Esperando la respuesta del dueño
                }
                @case ('ACCEPTED') {
                  Aceptado {{ e.decidedAt | fecha
                  }}{{ e.decisionNote ? ' · ' + e.decisionNote : '' }}
                }
                @case ('CONVERTED') {
                  Cargado a la atención {{ e.convertedAt | fecha }}
                }
                @case ('REJECTED') {
                  No aceptado{{ e.decisionNote ? ': ' + e.decisionNote : '' }}
                }
                @case ('EXPIRED') {
                  Venció el {{ e.validUntil | fecha: 'calendar' }}
                }
              }
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-2 lg:justify-end">
            @if (canEdit() && e.status === 'ACCEPTED') {
              <button type="button" class="btn btn-ghost text-slate-600" (click)="open('reject')">
                Ya no lo hará
              </button>
              <button type="button" class="btn btn-primary" (click)="openConvert()">
                <app-icon name="stethoscope" class="size-4" /> Cargar a la atención
              </button>
            }
            @if (canEdit() && e.status === 'PENDING') {
              <button type="button" class="btn btn-primary" (click)="open('accept')">
                <app-icon name="check" class="size-4" /> Aceptó
              </button>
              <button type="button" class="btn btn-secondary" (click)="open('reject')">
                No aceptó
              </button>
            }
            @if (e.status === 'CONVERTED' && e.visitId) {
              <a [routerLink]="['/atenciones', e.visitId]" class="btn btn-secondary">
                <app-icon name="stethoscope" class="size-4" /> Ver atención
              </a>
            }
            @if (e.status === 'EXPIRED' && canEdit()) {
              <a
                routerLink="/presupuestos/nuevo"
                [queryParams]="{ petId: e.pet.id, mascota: e.pet.name, cliente: e.client.name }"
                class="btn btn-secondary"
              >
                Emitir uno nuevo
              </a>
            }
            @if (e.status === 'PENDING' || e.status === 'ACCEPTED') {
              <a
                class="btn btn-secondary"
                [href]="whatsapp()"
                target="_blank"
                rel="noopener"
                aria-label="Enviar por WhatsApp"
              >
                <app-icon name="message-circle" class="size-4" /> WhatsApp
              </a>
            }
            <button type="button" class="btn btn-secondary" (click)="print()">
              <app-icon name="file-text" class="size-4" /> Imprimir
            </button>
          </div>
        </div>

        <!-- Documento -->
        <article
          class="print-sheet mx-auto max-w-[210mm] bg-white p-8 text-[12.5px] leading-snug text-slate-900 shadow-card ring-1 ring-slate-200 sm:p-10"
        >
          <header class="flex flex-wrap items-start justify-between gap-6">
            <div class="flex min-w-0 items-start gap-4">
              @if (logoUrl(); as logo) {
                <img
                  [src]="logo"
                  alt=""
                  class="h-16 w-auto max-w-[44mm] object-contain"
                  (error)="logoFailed.set(true)"
                />
              }
              <div class="min-w-0">
                <p class="font-display text-lg font-bold break-words">{{ e.clinic.name }}</p>
                @if (e.clinic.ruc) {
                  <p class="text-slate-600">RUC {{ e.clinic.ruc }}</p>
                }
                @if (e.clinic.address) {
                  <p class="text-slate-600">{{ e.clinic.address }}</p>
                }
                @if (e.clinic.phone) {
                  <p class="text-slate-600">Tel. {{ e.clinic.phone }}</p>
                }
              </div>
            </div>
            <div
              class="rounded-xl bg-anil-50 px-4 py-3 text-right ring-1 ring-anil-100 print:bg-white print:ring-black"
            >
              <p
                class="text-[10.5px] font-semibold tracking-wider text-anil-700 uppercase print:text-black"
              >
                Presupuesto
              </p>
              <p class="font-display text-xl font-bold">{{ e.code }}</p>
              <p class="text-slate-600">Emitido {{ e.createdAt | fecha }}</p>
              <p class="text-slate-600">Válido hasta {{ e.validUntil | fecha: 'calendar' }}</p>
            </div>
          </header>

          <h1 class="mt-6 font-display text-xl font-semibold break-words">{{ e.title }}</h1>

          <dl
            class="mt-4 grid gap-x-8 gap-y-1.5 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 print:bg-white print:ring-1 print:ring-black"
          >
            <div class="flex gap-1.5">
              <dt class="text-slate-500">Paciente:</dt>
              <dd class="font-medium">
                {{ e.pet.name }} · {{ petCode(e.pet.number) }} · {{ species[e.pet.species]
                }}{{ e.pet.breed ? ', ' + e.pet.breed : '' }}
              </dd>
            </div>
            <div class="flex gap-1.5">
              <dt class="text-slate-500">Propietario:</dt>
              <dd class="font-medium">{{ e.client.name }}</dd>
            </div>
            @if (e.pet.weightKg) {
              <div class="flex gap-1.5">
                <dt class="text-slate-500">Peso:</dt>
                <dd>{{ e.pet.weightKg }} kg</dd>
              </div>
            }
            <div class="flex gap-1.5">
              <dt class="text-slate-500">Teléfono:</dt>
              <dd>{{ formatPhone(e.client.phone) }}</dd>
            </div>
          </dl>

          <table class="mt-6 w-full text-left">
            <thead>
              <tr class="border-b-2 border-slate-900 text-[11px] tracking-wide uppercase">
                <th scope="col" class="py-2 pr-3 font-semibold">Descripción</th>
                <th scope="col" class="w-16 py-2 pr-3 text-right font-semibold">Cant.</th>
                <th scope="col" class="w-24 py-2 pr-3 text-right font-semibold">P. unit.</th>
                <th scope="col" class="w-24 py-2 pr-3 text-right font-semibold">Dscto.</th>
                <th scope="col" class="w-28 py-2 text-right font-semibold">Importe</th>
              </tr>
            </thead>
            <tbody>
              @for (i of e.items; track i.id) {
                <tr class="border-b border-slate-200 align-top">
                  <td class="py-2.5 pr-3">{{ i.description }}</td>
                  <td class="py-2.5 pr-3 text-right tabular-nums">{{ formatQty(i.quantity) }}</td>
                  <td class="py-2.5 pr-3 text-right tabular-nums">{{ money(i.unitPrice) }}</td>
                  <td class="py-2.5 pr-3 text-right tabular-nums">
                    {{ i.discount ? '− ' + money(i.discount) : '—' }}
                  </td>
                  <td class="py-2.5 text-right font-medium tabular-nums">{{ money(i.total) }}</td>
                </tr>
              }
            </tbody>
          </table>

          <div class="mt-4 flex justify-end">
            <dl class="w-full max-w-64 space-y-1">
              <div class="flex justify-between text-slate-600">
                <dt>Op. gravada</dt>
                <dd class="tabular-nums">{{ money(e.taxable) }}</dd>
              </div>
              <div class="flex justify-between text-slate-600">
                <dt>IGV 18 %</dt>
                <dd class="tabular-nums">{{ money(e.igv) }}</dd>
              </div>
              <div class="flex items-baseline justify-between border-t-2 border-slate-900 pt-2">
                <dt class="font-semibold">Total</dt>
                <dd class="font-display text-xl font-bold tabular-nums">{{ money(e.total) }}</dd>
              </div>
            </dl>
          </div>

          @if (e.notes) {
            <div class="mt-6">
              <p class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Notas</p>
              <p class="mt-1 whitespace-pre-line">{{ e.notes }}</p>
            </div>
          }

          <footer class="mt-10 grid gap-8 sm:grid-cols-2 print:grid-cols-2">
            <div class="border-t border-slate-400 pt-1.5 text-center">
              <p class="font-medium">{{ e.createdBy.fullName }}</p>
              @if (e.createdBy.licenseNumber) {
                <p class="text-slate-600">C.M.V.P. {{ e.createdBy.licenseNumber }}</p>
              } @else {
                <p class="text-slate-600">{{ e.clinic.name }}</p>
              }
            </div>
            <div class="border-t border-slate-400 pt-1.5 text-center">
              <p class="font-medium">Conformidad del propietario</p>
              <p class="text-slate-600">{{ e.client.name }}</p>
            </div>
          </footer>
          <p class="mt-6 text-center text-[10.5px] text-slate-500">
            Precios en soles con IGV. El presupuesto puede variar si durante el procedimiento se
            requieren servicios adicionales, que se informarán antes de realizarse.
          </p>
        </article>
      }
    </section>

    <!-- Aceptar / no aceptar -->
    <app-modal
      [open]="modal() === 'accept' || modal() === 'reject'"
      [title]="modal() === 'accept' ? 'El dueño aceptó' : 'El dueño no aceptó'"
      [description]="
        modal() === 'accept'
          ? 'Queda listo para cargarse a la atención el día del procedimiento.'
          : 'El presupuesto queda cerrado. Puedes anotar el motivo.'
      "
      [dismissible]="false"
      (closed)="close()"
    >
      <form id="decide-form" (submit)="$event.preventDefault(); decide()" novalidate>
        <label for="decide-note" class="field-label">
          {{ modal() === 'accept' ? 'Cómo aceptó (opcional)' : 'Motivo (opcional)' }}
        </label>
        <input
          id="decide-note"
          [formControl]="note"
          class="field-input"
          maxlength="200"
          autocomplete="off"
          [placeholder]="
            modal() === 'accept'
              ? 'Ej.: firmó en recepción, aceptó por WhatsApp'
              : 'Ej.: lo pensará'
          "
        />
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="close()">Volver</button>
        <button
          type="submit"
          form="decide-form"
          class="btn"
          [class]="modal() === 'accept' ? 'btn-primary' : 'btn-danger'"
          [disabled]="busy()"
        >
          {{ modal() === 'accept' ? 'Registrar aceptación' : 'Registrar' }}
        </button>
      </ng-container>
    </app-modal>

    <!-- Cargar a la atención -->
    <app-modal
      [open]="modal() === 'convert'"
      title="Cargar a la atención"
      description="Las líneas entran como cargos con el precio presupuestado y descuentan sus insumos."
      [dismissible]="false"
      (closed)="close()"
    >
      @if (estimate(); as e) {
        <div class="space-y-4">
          @if (visitsLoading()) {
            <div class="h-14 animate-pulse rounded-xl bg-slate-100"></div>
          } @else if (openVisits().length) {
            <fieldset>
              <legend class="field-label">Atención abierta de {{ e.pet.name }}</legend>
              <div class="mt-1.5 space-y-2">
                @for (v of openVisits(); track v.id) {
                  <label
                    class="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-slate-300 has-[:checked]:bg-anil-50 has-[:checked]:ring-2 has-[:checked]:ring-anil-600"
                  >
                    <input
                      type="radio"
                      name="convert-visit"
                      class="size-4 accent-anil-600"
                      [checked]="visitId() === v.id"
                      (change)="visitId.set(v.id)"
                    />
                    <span class="text-sm">
                      <span class="font-medium text-slate-900">{{
                        v.openedAt | fecha: 'datetime'
                      }}</span>
                      <span class="text-slate-600">
                        · {{ v.reason ?? 'Sin motivo' }} · {{ v.attendedBy.fullName }}</span
                      >
                    </span>
                  </label>
                }
              </div>
            </fieldset>
          } @else {
            <p
              class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200"
            >
              {{ e.pet.name }} no tiene una atención abierta. Se abrirá una ahora y los cargos
              entrarán en ella.
            </p>
          }
          @if (hasControlled()) {
            <div>
              <label for="convert-rx" class="field-label"
                >N.º de receta <span class="text-rose-600" aria-hidden="true">*</span></label
              >
              <input
                id="convert-rx"
                [formControl]="rx"
                class="field-input"
                maxlength="60"
                autocomplete="off"
                placeholder="Ej.: RX-00012"
                [attr.aria-invalid]="rx.invalid && rx.touched"
              />
              <p class="field-hint">
                Incluye un medicamento controlado: va con su receta retenida.
              </p>
            </div>
          }
        </div>
      }
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="close()">Volver</button>
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="busy() || visitsLoading()"
          (click)="convert()"
        >
          {{
            openVisits().length
              ? 'Cargar ' + money(estimate()?.total ?? 0)
              : 'Abrir atención y cargar'
          }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class EstimatePage {
  private readonly api = inject(EstimatesService);
  private readonly visits = inject(VisitsService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  readonly id = input.required<string>();
  /** ?atencion=… : atención a la que se quiere cargar */
  readonly atencion = input<string>();

  protected readonly labels = ESTIMATE_STATUS_LABELS;
  protected readonly tone = ESTIMATE_TONE;
  protected readonly species = SPECIES_LABELS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly formatQty = formatQty;
  protected readonly money = money;

  protected readonly estimate = signal<EstimatePrint | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl = computed(() =>
    this.logoFailed() ? null : (this.estimate()?.clinic.logoUrl ?? null),
  );
  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
  protected readonly hasControlled = computed(
    () => this.estimate()?.items.some((i) => i.controlled) ?? false,
  );

  protected readonly modal = signal<Modal>(null);
  protected readonly busy = signal(false);
  protected readonly note = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(200)],
  });
  protected readonly rx = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(60)],
  });
  protected readonly openVisits = signal<VisitSummary[]>([]);
  protected readonly visitsLoading = signal(false);
  protected readonly visitId = signal<number | null>(null);

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.loading.set(true);
      this.api.get(id).subscribe({
        next: (e) => {
          this.estimate.set(e);
          this.loading.set(false);
          // Viene desde una atención con un presupuesto aceptado: abre el paso de cargar
          if (this.atencion() && e.status === 'ACCEPTED' && this.canEdit()) this.openConvert();
        },
        error: (error: unknown) => {
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el presupuesto.'));
          this.loading.set(false);
        },
      });
    });
  }

  protected whatsapp(): string {
    const e = this.estimate()!;
    const text = estimateMessage(e, e.clinic.name, money);
    return `https://wa.me/51${e.client.phone}?text=${encodeURIComponent(text)}`;
  }

  protected open(modal: Modal): void {
    this.note.reset('');
    this.modal.set(modal);
  }

  protected close(): void {
    if (!this.busy()) this.modal.set(null);
  }

  protected openConvert(): void {
    const e = this.estimate();
    if (!e) return;
    this.rx.reset('');
    this.modal.set('convert');
    this.visitsLoading.set(true);
    this.visits.list({ petId: e.pet.id, status: 'OPEN' }).subscribe({
      next: (page) => {
        this.openVisits.set(page.items);
        const wanted = Number(this.atencion());
        this.visitId.set(page.items.find((v) => v.id === wanted)?.id ?? page.items[0]?.id ?? null);
        this.visitsLoading.set(false);
      },
      error: () => {
        this.openVisits.set([]);
        this.visitsLoading.set(false);
      },
    });
  }

  protected decide(): void {
    const e = this.estimate();
    if (!e || this.busy()) return;
    this.busy.set(true);
    const note = this.note.value.trim() || null;
    const request =
      this.modal() === 'accept' ? this.api.accept(e.id, note) : this.api.reject(e.id, note);
    request.subscribe({
      next: (updated) =>
        this.done(
          updated,
          updated.status === 'ACCEPTED' ? 'Presupuesto aceptado.' : 'Presupuesto cerrado.',
        ),
      error: (error: unknown) => this.fail(error),
    });
  }

  protected convert(): void {
    const e = this.estimate();
    if (!e || this.busy()) return;
    if (this.hasControlled() && this.rx.invalid) {
      this.rx.markAsTouched();
      return;
    }
    this.busy.set(true);
    const rx = this.hasControlled() ? this.rx.value.trim() : null;
    const chosen = this.visitId();
    const visit$: Observable<number> = chosen
      ? of(chosen)
      : this.visits.open(e.pet.id).pipe(map((v) => v.id));
    visit$.pipe(switchMap((visitId) => this.api.convert(e.id, visitId, rx))).subscribe({
      next: (updated) => this.done(updated, `Cargado a la atención de ${updated.pet.name}.`),
      error: (error: unknown) => this.fail(error),
    });
  }

  protected print(): void {
    const style = this.document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }';
    this.document.head.appendChild(style);
    window.print();
    style.remove();
  }

  private done(updated: EstimatePrint, message: string): void {
    this.busy.set(false);
    this.modal.set(null);
    this.estimate.set(updated);
    this.toast.success(message);
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.toast.error(apiErrorMessage(error));
  }

  /** Para el texto de ayuda: "29/10/2026" */
  protected calendar(day: string): string {
    return formatDate(day, 'calendar');
  }
}
