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
import { SPECIES_LABELS } from '../../core/services/clients.models';
import {
  GROOMING_STATUS_LABELS,
  GroomingDetail,
  PET_SIZE_LABELS,
  TRANSPORT_LABELS,
} from '../../core/services/grooming.models';
import { GroomingService } from '../../core/services/grooming.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatDate } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petCode } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';

/**
 * Constancia de grooming (A5): cómo llegó la mascota, lo pedido, los servicios y la entrega.
 * Es el respaldo de la clínica ante un reclamo ("ya venía con nudos").
 */
@Component({
  selector: 'app-grooming-certificate-page',
  imports: [BackLinkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <app-back-link fallback="/grooming" fallbackLabel="Tablero de grooming" />
        @if (g()) {
          <button type="button" class="btn btn-primary" (click)="print()">
            <app-icon name="file-text" class="size-4" /> Imprimir
          </button>
        }
      </div>

      @if (loading()) {
        <div class="card mx-auto h-96 max-w-[148mm] animate-pulse" aria-busy="true"></div>
      } @else if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
        </div>
      } @else if (g(); as d) {
        <article
          class="print-sheet relative mx-auto flex min-h-[190mm] max-w-[148mm] flex-col bg-white p-7 text-[11.5px] leading-snug text-black shadow-card ring-1 ring-slate-200"
        >
          @if (d.status === 'CANCELLED') {
            <p
              class="absolute inset-x-7 top-1/2 -translate-y-1/2 -rotate-12 rounded-lg border-4 border-rose-600 py-2 text-center font-display text-3xl font-bold tracking-widest text-rose-600 opacity-80"
            >
              CANCELADO
            </p>
          }
          <header class="flex items-start gap-4 border-b-2 border-black pb-3">
            @if (logoUrl(); as logo) {
              <img
                [src]="logo"
                alt=""
                class="h-12 w-auto max-w-[32mm] object-contain"
                (error)="logoFailed.set(true)"
              />
            }
            <div class="min-w-0 flex-1">
              <p class="font-display text-[14px] font-bold break-words">{{ d.clinic.name }}</p>
              @if (d.clinic.address) {
                <p>{{ d.clinic.address }}</p>
              }
              @if (d.clinic.phone) {
                <p>Tel. {{ d.clinic.phone }}</p>
              }
            </div>
            <div class="shrink-0 text-right">
              <p class="text-[10px] font-semibold tracking-wide uppercase">
                Constancia de grooming
              </p>
              <p class="font-display text-[15px] font-bold">{{ d.code }}</p>
              <p>{{ statusLabels[d.status] }}</p>
            </div>
          </header>

          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5">
            <div class="col-span-2 flex gap-1">
              <dt class="font-semibold">Mascota:</dt>
              <dd>
                <span class="font-display text-[12.5px] font-bold">{{ d.pet.name }}</span> ·
                {{ petCode(d.pet.number) }} · {{ speciesLabels[d.pet.species]
                }}{{ d.pet.breed ? ' · ' + d.pet.breed : '' }} ·
                {{ sizeLabels[d.size] }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Propietario:</dt>
              <dd class="break-words">{{ d.client.name }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Teléfono:</dt>
              <dd>{{ formatPhone(d.client.phone) }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Ingreso:</dt>
              <dd>{{ dateTime(d.checkInAt) }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Recibió:</dt>
              <dd>{{ d.createdBy.fullName }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Groomer:</dt>
              <dd>{{ d.groomer?.fullName ?? '—' }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Movilidad:</dt>
              <dd>{{ transportLabels[d.transport] }}</dd>
            </div>
            @if (d.transportAddress) {
              <div class="col-span-2 flex gap-1">
                <dt class="font-semibold">Dirección:</dt>
                <dd>{{ d.transportAddress }}</dd>
              </div>
            }
            @if (d.pet.allergies) {
              <div class="col-span-2 mt-1 rounded border border-black px-2 py-0.5">
                <dt class="inline font-semibold">Alergias:</dt>
                <dd class="inline">{{ d.pet.allergies }}</dd>
              </div>
            }
          </dl>

          <h2
            class="mt-4 border-b border-black pb-0.5 text-[10px] font-bold tracking-wide uppercase"
          >
            Cómo llegó
          </h2>
          <ul class="mt-1.5 grid grid-cols-4 gap-1" role="list">
            @for (f of checklist(); track f.label) {
              <li
                class="rounded border px-1.5 py-1 text-center"
                [class]="f.value ? 'border-black font-bold' : 'border-slate-300 text-slate-600'"
              >
                {{ f.label }}: {{ f.value ? 'Sí' : 'No' }}
              </li>
            }
          </ul>
          @if (d.skinNotes) {
            <p class="mt-1.5">
              <span class="font-semibold">Piel, orejas, heridas:</span> {{ d.skinNotes }}
            </p>
          }
          @if (d.belongings) {
            <p class="mt-0.5">
              <span class="font-semibold">Pertenencias:</span> {{ d.belongings }}
            </p>
          }
          @if (d.instructions) {
            <p class="mt-0.5"><span class="font-semibold">Pidió:</span> {{ d.instructions }}</p>
          }

          <h2
            class="mt-4 border-b border-black pb-0.5 text-[10px] font-bold tracking-wide uppercase"
          >
            Servicios
          </h2>
          <table class="mt-1 w-full">
            <tbody>
              @for (s of d.services; track s.id) {
                <tr>
                  <td class="py-0.5">
                    {{ s.quantity > 1 ? s.quantity + ' × ' : '' }}{{ s.description }}
                  </td>
                  <td class="py-0.5 text-right tabular-nums">{{ money(s.total) }}</td>
                </tr>
              }
              <tr class="border-t border-black font-bold">
                <td class="pt-1">Total</td>
                <td class="pt-1 text-right tabular-nums">{{ money(d.total) }}</td>
              </tr>
              @if (d.pending > 0 && d.status !== 'CANCELLED') {
                <tr>
                  <td>Por cobrar</td>
                  <td class="text-right tabular-nums">{{ money(d.pending) }}</td>
                </tr>
              }
            </tbody>
          </table>

          @if (d.cancelReason) {
            <p class="mt-3"><span class="font-semibold">Cancelado:</span> {{ d.cancelReason }}</p>
          }

          <footer class="mt-auto grid grid-cols-2 gap-6 pt-6">
            <div class="text-center">
              @if (d.signature) {
                <img
                  [src]="d.signature"
                  alt="Firma al dejar la mascota"
                  class="mx-auto h-16 w-full object-contain"
                />
              } @else {
                <div class="h-16"></div>
              }
              <div class="border-t border-black pt-1">
                <p class="font-semibold">{{ d.signerName ?? d.client.name }}</p>
                <p>Al dejar la mascota · {{ dateTime(d.checkInAt) }}</p>
              </div>
            </div>
            <div class="text-center">
              <div class="h-16"></div>
              <div class="border-t border-black pt-1">
                @if (d.pickedUpBy) {
                  <p class="font-semibold">{{ d.pickedUpBy }}</p>
                  <p>
                    {{ d.pickedUpRelation
                    }}{{ d.pickedUpDocument ? ' · Doc. ' + d.pickedUpDocument : '' }}
                  </p>
                  <p>Recogió · {{ d.deliveredAt ? dateTime(d.deliveredAt) : '' }}</p>
                } @else {
                  <p class="font-semibold">Quien recoge</p>
                  <p>Nombre, DNI y firma</p>
                }
              </div>
            </div>
          </footer>
          <p class="mt-4 text-center text-[9px] text-slate-600">
            El propietario declara que la mascota fue recibida en las condiciones indicadas. Emitida
            con Uywa · {{ d.clinic.name }}
          </p>
        </article>
      }
    </section>
  `,
})
export class GroomingCertificatePage {
  private readonly api = inject(GroomingService);
  private readonly document = inject(DOCUMENT);

  readonly id = input.required<string>();

  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sizeLabels = PET_SIZE_LABELS;
  protected readonly statusLabels = GROOMING_STATUS_LABELS;
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly money = money;
  protected readonly dateTime = (v: string) => formatDate(v, 'datetime');

  protected readonly g = signal<GroomingDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl = computed(() =>
    this.logoFailed() ? null : (this.g()?.clinic.logoUrl ?? null),
  );
  protected readonly checklist = computed(() => {
    const d = this.g();
    return d
      ? [
          { label: 'Pulgas', value: d.fleas },
          { label: 'Garrapatas', value: d.ticks },
          { label: 'Nudos', value: d.matting },
          { label: 'Agresivo', value: d.aggressive },
        ]
      : [];
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.loading.set(true);
      this.api.get(id).subscribe({
        next: (d) => {
          this.g.set(d);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la constancia.'));
          this.loading.set(false);
        },
      });
    });
  }

  protected print(): void {
    const style = this.document.createElement('style');
    style.textContent = '@page { size: A5 portrait; margin: 8mm; }';
    this.document.head.appendChild(style);
    window.print();
    style.remove();
  }
}
