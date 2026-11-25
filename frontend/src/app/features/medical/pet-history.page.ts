import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { SessionService } from '../../core/auth/session.service';
import { SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import { PetHistory, VisitHistoryItem } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { WeightChartComponent } from '../../shared/ui/charts/weight-chart.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatDate } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';

/**
 * Historia clínica completa para imprimir (A4) o derivar a otro veterinario: todas las
 * consultas con su SOAP, recetas, vacunas y adendas, y la curva de peso.
 */
@Component({
  selector: 'app-pet-history-page',
  imports: [BackLinkComponent, IconComponent, WeightChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <app-back-link [fallback]="'/mascotas/' + id()" fallbackLabel="Historia clínica" />
        @if (h()) {
          <button type="button" class="btn btn-primary" (click)="print()">
            <app-icon name="file-text" class="size-4" /> Imprimir
          </button>
        }
      </div>

      @if (loading()) {
        <div class="card mx-auto h-96 max-w-[210mm] animate-pulse" aria-busy="true"></div>
      } @else if (loadError(); as error) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ error }}</p>
        </div>
      } @else if (h(); as d) {
        <article
          class="print-sheet print-solo mx-auto max-w-[210mm] bg-white p-8 text-[12.5px] leading-snug text-black shadow-card ring-1 ring-slate-200"
        >
          <header class="flex items-start gap-4 border-b-2 border-black pb-3">
            @if (d.clinic.logoUrl && !logoFailed()) {
              <img
                [src]="d.clinic.logoUrl"
                alt=""
                class="h-12 w-auto max-w-[32mm] object-contain"
                (error)="logoFailed.set(true)"
              />
            }
            <div class="min-w-0 flex-1">
              <p class="font-display text-[15px] font-bold break-words">{{ d.clinic.name }}</p>
              @if (d.clinic.address) {
                <p>{{ d.clinic.address }}</p>
              }
              @if (d.clinic.phone) {
                <p>Tel. {{ d.clinic.phone }}</p>
              }
            </div>
            <div class="shrink-0 text-right">
              <p class="text-[11px] font-semibold tracking-wide uppercase">Historia clínica</p>
              <p class="font-display text-[15px] font-bold">{{ petCode(d.pet.number) }}</p>
              <p>{{ date(today) }}</p>
            </div>
          </header>

          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5">
            <div class="col-span-2 flex gap-1">
              <dt class="font-semibold">Paciente:</dt>
              <dd>
                <span class="font-display font-bold">{{ d.pet.name }}</span> ·
                {{ speciesLabels[d.pet.species] }}{{ d.pet.breed ? ' · ' + d.pet.breed : '' }}
                @if (d.pet.sex) {
                  · {{ sexLabels[d.pet.sex] }}
                }
                @if (petAge(d.pet.birthDate); as age) {
                  · {{ age }}
                }
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
            @if (d.pet.allergies) {
              <div class="col-span-2 mt-1 rounded border border-black px-2 py-0.5">
                <dt class="inline font-semibold">Alergias:&ngsp;</dt>
                <dd class="inline">{{ d.pet.allergies }}</dd>
              </div>
            }
          </dl>

          @if (d.weights.length > 1) {
            <h2 class="sheet-title">Peso</h2>
            <app-weight-chart class="mt-2 break-inside-avoid" [points]="d.weights" />
          }

          <h2 class="sheet-title">
            Atenciones ({{ d.visits.length }}), de la más reciente a la más antigua
          </h2>
          @for (v of d.visits; track v.id) {
            <section class="mt-3 break-inside-avoid border-b border-slate-300 pb-3">
              <p class="font-semibold">
                {{ dateTime(v.openedAt) }} ·
                {{ v.type === 'HOSPITALIZATION' ? 'Internamiento' : 'Consulta' }} ·
                {{ v.attendedBy.fullName }}
                @if (v.status === 'OPEN') {
                  · <span class="font-normal">(abierta)</span>
                }
              </p>
              @if (v.reason) {
                <p><span class="font-semibold">Motivo:</span> {{ v.reason }}</p>
              }
              @if (v.anamnesis) {
                <p class="whitespace-pre-line">
                  <span class="font-semibold">S:</span> {{ v.anamnesis }}
                </p>
              }
              @if (vitals(v); as o) {
                <p><span class="font-semibold">O:</span> {{ o }}</p>
              }
              @if (v.physicalExam) {
                <p class="whitespace-pre-line">{{ v.physicalExam }}</p>
              }
              @if (v.diagnosis) {
                <p>
                  <span class="font-semibold">A:</span> {{ v.diagnosis }} ({{
                    v.diagnosisDefinitive ? 'definitivo' : 'presuntivo'
                  }})
                </p>
              }
              @if (v.notes) {
                <p class="whitespace-pre-line">
                  <span class="font-semibold">P:</span> {{ v.notes }}
                </p>
              }
              @for (rx of v.prescriptions; track rx.id) {
                @if (!rx.voidedAt) {
                  <p class="mt-1">
                    <span class="font-semibold">Receta {{ rx.code }}:</span>
                  </p>
                  <ul class="ml-4 list-disc">
                    @for (i of rx.items; track i.id) {
                      <li>
                        {{ i.drug }}: {{ i.dose }}{{ i.route ? ', ' + i.route.toLowerCase() : '' }},
                        {{ i.frequency }}, {{ i.duration }}
                      </li>
                    }
                  </ul>
                }
              }
              @if (activeDoses(v); as doses) {
                <p class="mt-1"><span class="font-semibold">Vacunas:</span> {{ doses }}</p>
              }
              @for (a of v.addenda; track a.id) {
                <p class="mt-1 italic">
                  Adenda ({{ a.author.fullName }}, {{ dateTime(a.createdAt) }}): {{ a.text }}
                </p>
              }
            </section>
          } @empty {
            <p class="mt-2">Sin consultas registradas.</p>
          }

          <p class="mt-4 text-[11px] text-slate-700">
            Impreso por {{ printedBy() }} el {{ dateTime(today) }}. Documento con datos personales
            (Ley 29733): entregar solo al propietario o al veterinario que lo atiende.
          </p>
        </article>
      }
    </section>
  `,
  styles: `
    .sheet-title {
      margin-top: 1rem;
      border-bottom: 1px solid #000;
      padding-bottom: 0.125rem;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
  `,
})
export class PetHistoryPage {
  private readonly api = inject(VisitsService);
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(SessionService);

  /** :id de la mascota */
  readonly id = input.required<string>();

  protected readonly h = signal<PetHistory | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly today = new Date().toISOString();
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly petCode = petCode;
  protected readonly petAge = petAge;
  protected readonly formatPhone = formatPhone;
  protected readonly printedBy = this.session.fullName;

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.loading.set(true);
      this.api.history(id).subscribe({
        next: (h) => {
          this.h.set(h);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la historia.'));
          this.loading.set(false);
        },
      });
    });
  }

  protected date(at: string): string {
    return formatDate(at, 'date');
  }

  protected dateTime(at: string): string {
    return formatDate(at, 'datetime');
  }

  /** "Peso 12.4 kg · T° 38.6 °C · FC 110 lpm …" */
  protected vitals(v: VisitHistoryItem): string {
    return [
      v.weightKg !== null && `Peso ${v.weightKg} kg`,
      v.temperatureC !== null && `T° ${v.temperatureC} °C`,
      v.heartRate !== null && `FC ${v.heartRate} lpm`,
      v.respiratoryRate !== null && `FR ${v.respiratoryRate} rpm`,
      v.capillaryRefillS !== null && `TLLC ${v.capillaryRefillS} s`,
      v.mucosa && `mucosas ${v.mucosa.toLowerCase()}`,
      v.hydration && `hidratación ${v.hydration.toLowerCase()}`,
      v.bodyCondition !== null && `CC ${v.bodyCondition}/9`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected activeDoses(v: VisitHistoryItem): string {
    return v.immunizations
      .filter((i) => !i.voidedAt)
      .map((i) => i.name)
      .join(', ');
  }

  protected print(): void {
    const style = this.document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }';
    this.document.head.appendChild(style);
    window.print();
    style.remove();
  }
}
