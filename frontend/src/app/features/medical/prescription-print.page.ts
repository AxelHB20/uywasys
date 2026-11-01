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
import { PrescriptionPrint, posology } from '../../core/services/medical.models';
import { PrescriptionsService } from '../../core/services/prescriptions.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatDate } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';

/**
 * Receta imprimible (A5 vertical). Lleva el nombre y la colegiatura del veterinario y un
 * espacio para su firma; si tiene controlados, se marca como receta retenida.
 */
@Component({
  selector: 'app-prescription-print-page',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        @if (rx(); as r) {
          <a
            [routerLink]="['/atenciones', r.visitId]"
            class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <app-icon name="chevron-left" class="size-4" /> Atención de {{ r.pet.name }}
          </a>
          @if (!r.voidedAt) {
            <button type="button" class="btn btn-primary" (click)="print()">
              <app-icon name="file-text" class="size-4" /> Imprimir
            </button>
          }
        }
      </div>

      @if (loading()) {
        <div class="card mx-auto h-96 max-w-[148mm] animate-pulse" aria-busy="true"></div>
      } @else if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
        </div>
      } @else if (rx(); as r) {
        <article
          class="print-sheet relative mx-auto flex min-h-[190mm] max-w-[148mm] flex-col bg-white p-7 text-[12px] leading-snug text-black shadow-card ring-1 ring-slate-200"
        >
          @if (r.voidedAt) {
            <p
              class="absolute inset-x-7 top-1/2 -translate-y-1/2 -rotate-12 rounded-lg border-4 border-rose-600 py-2 text-center font-display text-3xl font-bold tracking-widest text-rose-600 opacity-80"
            >
              ANULADA
            </p>
          }
          <header class="flex items-start gap-4 border-b-2 border-black pb-3">
            @if (logoUrl(); as logo) {
              <img
                [src]="logo"
                alt=""
                class="h-14 w-auto max-w-[36mm] object-contain"
                (error)="logoFailed.set(true)"
              />
            }
            <div class="min-w-0 flex-1">
              <p class="font-display text-base font-bold break-words">{{ r.clinic.name }}</p>
              @if (r.clinic.address) {
                <p>{{ r.clinic.address }}</p>
              }
              @if (r.clinic.phone) {
                <p>Tel. {{ r.clinic.phone }}</p>
              }
            </div>
            <div class="shrink-0 text-right">
              <p class="text-[10px] font-semibold tracking-wide uppercase">Receta médica</p>
              <p class="font-display text-[15px] font-bold">{{ r.code }}</p>
              <p>{{ date(r.createdAt) }}</p>
            </div>
          </header>

          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
            <div class="col-span-2 flex gap-1">
              <dt class="font-semibold">Paciente:</dt>
              <dd>
                <span class="font-display text-[13px] font-bold">{{ r.pet.name }}</span>
                · {{ petCode(r.pet.number) }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Especie:</dt>
              <dd>
                {{ speciesLabels[r.pet.species] }}{{ r.pet.breed ? ' · ' + r.pet.breed : '' }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Sexo / edad:</dt>
              <dd>{{ r.pet.sex ? sexLabels[r.pet.sex] : '—' }}{{ age() ? ' · ' + age() : '' }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Peso:</dt>
              <dd>{{ r.pet.weightKg ? r.pet.weightKg + ' kg' : '—' }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-semibold">Propietario:</dt>
              <dd class="break-words">{{ r.client.name }}</dd>
            </div>
            @if (r.client.docNumber) {
              <div class="flex gap-1">
                <dt class="font-semibold">{{ r.client.docType ?? 'Doc.' }}:</dt>
                <dd>{{ r.client.docNumber }}</dd>
              </div>
            }
            <div class="flex gap-1">
              <dt class="font-semibold">Teléfono:</dt>
              <dd>{{ formatPhone(r.client.phone) }}</dd>
            </div>
            @if (r.pet.allergies) {
              <div class="col-span-2 mt-1 rounded border border-black px-2 py-1">
                <dt class="inline font-semibold">Alergias:</dt>
                <dd class="inline">{{ r.pet.allergies }}</dd>
              </div>
            }
          </dl>

          <p class="mt-4 font-display text-3xl leading-none font-bold" aria-hidden="true">℞</p>
          <ol class="mt-2 space-y-3">
            @for (item of r.items; track item.id; let i = $index) {
              <li class="flex gap-2">
                <span class="w-4 shrink-0 font-bold">{{ i + 1 }}.</span>
                <div class="min-w-0">
                  <p class="text-[13px] font-bold break-words">
                    {{ item.drug }}{{ item.controlled ? ' *' : '' }}
                  </p>
                  <p>{{ posology(item) }}</p>
                  @if (item.instructions) {
                    <p class="italic">{{ item.instructions }}</p>
                  }
                </div>
              </li>
            }
          </ol>

          @if (r.notes) {
            <div class="mt-4">
              <p class="font-semibold">Indicaciones:</p>
              <p class="whitespace-pre-line">{{ r.notes }}</p>
            </div>
          }

          @if (hasControlled()) {
            <p class="mt-4 rounded border-2 border-black px-2 py-1.5 text-[11px]">
              <strong>* Medicamento controlado.</strong> Receta retenida N.º {{ r.code }}: queda en
              la clínica junto con el registro de salida del lote.
            </p>
          }

          <footer class="mt-auto pt-10">
            <div class="ml-auto w-56 border-t border-black pt-1 text-center">
              <p class="font-semibold">{{ r.vet.fullName }}</p>
              <p>Médico veterinario · C.M.V.P. {{ r.vet.licenseNumber ?? '—' }}</p>
            </div>
            <p class="mt-4 text-center text-[9.5px] text-slate-600">
              Emitida con Uywa · {{ r.clinic.name }}
            </p>
          </footer>
        </article>
      }
    </section>
  `,
})
export class PrescriptionPrintPage {
  private readonly api = inject(PrescriptionsService);
  private readonly document = inject(DOCUMENT);

  readonly id = input.required<string>();

  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly posology = posology;
  protected readonly date = (value: string) => formatDate(value, 'date');

  protected readonly rx = signal<PrescriptionPrint | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl = computed(() =>
    this.logoFailed() ? null : (this.rx()?.clinic.logoUrl ?? null),
  );
  protected readonly age = computed(() => petAge(this.rx()?.pet.birthDate ?? null));
  protected readonly hasControlled = computed(
    () => this.rx()?.items.some((i) => i.controlled) ?? false,
  );

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.loading.set(true);
      this.api.get(id).subscribe({
        next: (rx) => {
          this.rx.set(rx);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la receta.'));
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
