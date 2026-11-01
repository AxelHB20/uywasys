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
import { RouterLink } from '@angular/router';
import { SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { ImmunizationCard } from '../../core/services/medical.models';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';

/**
 * Carnet de vacunación imprimible (A5 vertical; también sale bien en A4). Lo guarda el dueño
 * y lo muestra en otras clínicas, por eso lleva el nombre y la colegiatura de quien aplicó.
 */
@Component({
  selector: 'app-immunization-card-page',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <a
          [routerLink]="['/mascotas', id()]"
          class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <app-icon name="chevron-left" class="size-4" /> Historia clínica
        </a>
        @if (card()) {
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
      } @else if (card(); as c) {
        <article
          class="print-sheet mx-auto max-w-[148mm] bg-white p-7 text-[12px] leading-snug text-black shadow-card ring-1 ring-slate-200"
        >
          <header class="flex items-center gap-4 border-b-2 border-black pb-3">
            @if (logoUrl(); as logo) {
              <img
                [src]="logo"
                alt=""
                class="h-14 w-auto max-w-[40mm] object-contain"
                (error)="logoFailed.set(true)"
              />
            }
            <div class="min-w-0 flex-1">
              <p class="font-display text-base font-bold break-words">{{ c.clinic.name }}</p>
              @if (c.clinic.address) {
                <p>{{ c.clinic.address }}</p>
              }
              @if (c.clinic.phone) {
                <p>Tel. {{ c.clinic.phone }}</p>
              }
            </div>
          </header>

          <h1 class="mt-4 text-center font-display text-lg font-bold tracking-wide uppercase">
            Carnet de vacunación
          </h1>

          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-black p-3">
            <div class="col-span-2 flex gap-1">
              <dt class="font-semibold">Paciente:</dt>
              <dd class="font-display text-[14px] font-bold">{{ c.pet.name }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Historia:</dt>
              <dd>{{ petCode(c.pet.number) }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Especie:</dt>
              <dd>{{ speciesLabels[c.pet.species] }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Raza:</dt>
              <dd>{{ c.pet.breed ?? '—' }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Sexo:</dt>
              <dd>{{ c.pet.sex ? sexLabels[c.pet.sex] : '—' }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Nacimiento:</dt>
              <dd>
                {{ birth() }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Color:</dt>
              <dd>{{ c.pet.color ?? '—' }}</dd>
            </div>
            @if (c.pet.microchip) {
              <div class="col-span-2 flex gap-1">
                <dt class="font-semibold">Microchip:</dt>
                <dd class="tabular-nums">{{ c.pet.microchip }}</dd>
              </div>
            }
            <div class="col-span-2 flex gap-1">
              <dt class="font-semibold">Propietario:</dt>
              <dd>{{ c.pet.client.name }} · {{ formatPhone(c.pet.client.phone) }}</dd>
            </div>
          </dl>

          @for (group of groups(); track group.title) {
            <h2 class="mt-5 mb-1.5 text-[13px] font-bold uppercase">{{ group.title }}</h2>
            <table class="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col class="w-[21%]" />
                <col class="w-[37%]" />
                <col class="w-[20%]" />
                <col class="w-[22%]" />
              </colgroup>
              <thead>
                <tr class="border-y border-black text-[11px] uppercase">
                  <th scope="col" class="py-1 pr-2 font-semibold">Fecha</th>
                  <th scope="col" class="py-1 pr-2 font-semibold">{{ group.what }}</th>
                  <th scope="col" class="py-1 pr-2 font-semibold">Próxima</th>
                  <th scope="col" class="py-1 font-semibold">Aplicó</th>
                </tr>
              </thead>
              <tbody>
                @for (i of group.items; track i.id) {
                  <tr class="border-b border-slate-300 align-top">
                    <td class="py-1.5 pr-2 whitespace-nowrap tabular-nums">
                      {{ calendar(i.appliedAt) }}
                    </td>
                    <td class="py-1.5 pr-2">
                      <span class="font-semibold">{{ i.name }}</span>
                      @if (i.laboratory || i.batchNumber) {
                        <span class="block text-[10.5px]">
                          {{ i.laboratory }}{{ i.laboratory && i.batchNumber ? ' · ' : ''
                          }}{{ i.batchNumber ? 'Lote ' + i.batchNumber : '' }}
                        </span>
                      }
                    </td>
                    <td class="py-1.5 pr-2 whitespace-nowrap tabular-nums">
                      {{ i.nextDueAt ? calendar(i.nextDueAt) : '—' }}
                    </td>
                    <td class="py-1.5 text-[10.5px]">
                      @if (i.external) {
                        {{ i.externalClinic ?? 'Otra clínica' }}
                      } @else {
                        {{ i.appliedBy.fullName }}
                        @if (i.appliedBy.licenseNumber) {
                          <span class="block">CMVP {{ i.appliedBy.licenseNumber }}</span>
                        }
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr class="border-b border-slate-300">
                    <td colspan="4" class="py-2 text-center text-[11px]">Sin registros</td>
                  </tr>
                }
              </tbody>
            </table>
          }

          @if (nextDue(); as next) {
            <p class="mt-5 rounded-lg border-2 border-black p-2.5 text-center text-[13px]">
              Próxima cita: <strong>{{ calendar(next.nextDueAt!) }}</strong> · {{ next.name }}
            </p>
          }

          <footer class="mt-5 flex justify-between border-t border-slate-300 pt-2 text-[10px]">
            <span>Emitido el {{ calendar(today) }}</span>
            <span>Uywa · Gestión veterinaria</span>
          </footer>
        </article>
      }
    </section>
  `,
})
export class ImmunizationCardPage {
  private readonly api = inject(ImmunizationsService);
  private readonly document = inject(DOCUMENT);

  readonly id = input.required<string>();

  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly calendar = (day: string) => formatDate(day, 'calendar');
  protected readonly today = limaToday();

  protected readonly card = signal<ImmunizationCard | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl = computed(() =>
    this.logoFailed() ? null : (this.card()?.clinic.logoUrl ?? null),
  );

  protected readonly groups = computed(() => {
    const items = this.card()?.items ?? [];
    return [
      {
        title: 'Vacunas',
        what: 'Vacuna',
        items: items.filter((i) => i.kind === 'VACCINE'),
      },
      {
        title: 'Desparasitaciones',
        what: 'Producto',
        items: items.filter((i) => i.kind !== 'VACCINE'),
      },
    ];
  });

  /** El próximo refuerzo pendiente (de la última aplicación de cada producto) */
  protected readonly nextDue = computed(() => {
    const latest = new Map<string, ImmunizationCard['items'][number]>();
    for (const i of this.card()?.items ?? [])
      latest.set(`${i.kind}|${i.name.toLocaleLowerCase('es')}`, i); // vienen en orden de fecha
    return (
      [...latest.values()]
        .filter((i) => i.nextDueAt && i.nextDueAt >= this.today)
        .sort((a, b) => a.nextDueAt!.localeCompare(b.nextDueAt!))[0] ?? null
    );
  });

  protected readonly birth = computed(() => {
    const pet = this.card()?.pet;
    if (!pet?.birthDate) return '—';
    const age = petAge(pet.birthDate);
    return `${pet.birthDateEstimated ? 'aprox. ' : ''}${this.calendar(pet.birthDate)}${age ? ` (${age})` : ''}`;
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.loading.set(true);
      this.api.card(id).subscribe({
        next: (card) => {
          this.card.set(card);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el carnet.'));
          this.loading.set(false);
        },
      });
    });
  }

  /** Hoja A5 solo mientras se imprime (el ticket usa su propio tamaño) */
  protected print(): void {
    const style = this.document.createElement('style');
    style.textContent = '@page { size: A5 portrait; margin: 8mm; }';
    this.document.head.appendChild(style);
    window.print();
    style.remove();
  }
}
