import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { CareServicesService } from '../../core/services/care-services.service';
import {
  LAB_STATUS_LABELS,
  LAB_STEPS,
  LabOrder,
  LabStatus,
  labWhatsapp,
} from '../../core/services/lab.models';
import { LabService } from '../../core/services/lab.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import { petAge } from '../../shared/utils/pet-age';
import { apiErrorMessage } from '../../shared/utils/validators';
import { loaded } from '../../shared/utils/resource';
import { CLINICAL_ACCEPT, clinicalFileError } from '../../shared/utils/image';

const money = (n: number) => `S/ ${n.toFixed(2)}`;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type MenuAction = 'result' | 'cancel';

/** Pedidos de una mascota en una atención (en Exámenes); dentro de la atención, uno solo sin cabecera */
interface LabGroup {
  key: string;
  visitId: number;
  pet: LabOrder['pet'] | null;
  client: string;
  date: string;
  orders: LabOrder[];
}

/**
 * Pedidos de examen con todo su recorrido: pedir (en la atención), muestra, resultado, revisión
 * del veterinario y aviso al dueño. Se usa en la atención y en la pantalla Exámenes.
 */
@Component({
  host: {
    '(document:click)': 'onDocClick($event)',
    '(document:keydown.escape)': 'closeMenu()',
  },
  selector: 'app-lab-orders',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (orders().length) {
      <div class="@container space-y-4">
        @for (g of groups(); track g.key) {
          <section
            class="overflow-visible rounded-2xl bg-white ring-1 ring-slate-200"
            [attr.aria-label]="g.pet ? 'Exámenes de ' + g.pet.name : 'Exámenes'"
          >
            @if (g.pet; as pet) {
              <header
                class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-2xl border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 @md:px-5"
              >
                <span
                  class="grid size-9 shrink-0 place-items-center rounded-xl bg-anil-50 text-anil-700"
                  role="img"
                  [attr.aria-label]="speciesLabels[pet.species]"
                  [title]="speciesLabels[pet.species]"
                >
                  <app-icon [name]="speciesIcons[pet.species]" class="size-[18px]" />
                </span>
                <p class="min-w-0 flex-1 text-sm text-slate-600">
                  <a
                    [routerLink]="['/mascotas', pet.id]"
                    class="text-[15px] font-semibold text-slate-900 hover:underline"
                    >{{ pet.name }}</a
                  >
                  <span class="hidden @md:inline"> · {{ petCode(pet.number) }}</span>
                  · {{ g.client }}
                </p>
                <a
                  [routerLink]="['/atenciones', g.visitId]"
                  class="-mr-2 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-anil-700 hover:bg-anil-50"
                >
                  <span
                    >Atención<span class="hidden @md:inline"> del {{ g.date }}</span></span
                  >
                  <app-icon name="chevron-right" class="size-4" />
                </a>
              </header>
            }
            <ul role="list">
              @for (o of g.orders; track o.id) {
                @let open = expanded().has(o.id);
                <li class="border-t border-slate-100 first:border-t-0">
                  <div
                    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 @md:px-4 @4xl:grid-cols-[minmax(0,1fr)_15rem_16.5rem]"
                  >
                    <button
                      type="button"
                      class="col-start-1 row-start-1 flex min-w-0 items-start gap-2.5 rounded-lg py-1 pr-1 text-left focus-visible:outline-2 focus-visible:outline-anil-600"
                      [attr.aria-expanded]="open"
                      [attr.aria-controls]="'lab-detail-' + o.id"
                      (click)="toggleOpen(o.id)"
                    >
                      <app-icon
                        name="chevron-down"
                        class="mt-1 size-4 shrink-0 text-slate-500 transition-transform duration-150 motion-reduce:transition-none"
                        [class.rotate-180]="open"
                      />
                      <span class="min-w-0">
                        <span
                          class="block text-[15px] font-semibold text-pretty text-slate-900"
                          [class.line-through]="o.status === 'CANCELLED'"
                          >{{ examNames(o) }}</span
                        >
                        <span class="block text-sm text-slate-500">
                          <span class="tabular-nums">{{ o.code }}</span> · {{ place(o) }}
                          <span class="hidden @md:inline"> · Pidió {{ o.requestedBy }}</span>
                        </span>
                      </span>
                    </button>

                    <!-- Estado: una sola línea (barra de 4 pasos o, ya revisado, lo que dijo el médico) -->
                    <div
                      class="col-span-2 col-start-1 row-start-2 min-w-0 pl-[1.625rem] @4xl:col-span-1 @4xl:col-start-2 @4xl:row-start-1 @4xl:pl-0"
                      [class.hidden]="o.status === 'REVIEWED' && open"
                    >
                      @if (o.status === 'CANCELLED') {
                        <p class="text-sm text-slate-500">Cancelado: {{ o.cancelReason }}</p>
                      } @else if (o.status === 'REVIEWED') {
                        @if (!open) {
                          <p
                            class="truncate text-sm text-slate-700"
                            [title]="o.interpretation ?? ''"
                          >
                            <span class="text-slate-500">Médico:</span> {{ o.interpretation }}
                          </p>
                        }
                      } @else {
                        <div class="flex max-w-60 gap-1" aria-hidden="true">
                          @for (s of steps; track s.status; let i = $index) {
                            <span
                              class="h-1.5 flex-1 rounded-full"
                              [class]="stepIndex(o.status) >= i ? 'bg-anil-500' : 'bg-slate-200'"
                            ></span>
                          }
                        </div>
                        <p class="mt-1 text-xs text-slate-600">
                          <span class="font-semibold text-slate-900">{{
                            statusLabels[o.status]
                          }}</span>
                          @if (o.overdue) {
                            ·
                            <span class="font-semibold text-rose-700"
                              >{{ o.waitingDays }} días{{
                                o.destination === 'EXTERNAL' ? ' · llama al lab' : ''
                              }}</span
                            >
                          } @else if (o.status === 'RESULT_READY' && o.resultAt) {
                            · subido {{ when(o.resultAt) }}
                          }
                        </p>
                      }
                    </div>

                    <!-- Una sola acción: el siguiente paso -->
                    <div
                      class="relative col-start-2 row-start-1 flex items-center justify-end gap-2 @max-md:col-span-2 @max-md:col-start-1 @max-md:row-start-3 @4xl:col-start-3"
                      data-lab-menu
                    >
                      @switch (o.status) {
                        @case ('REQUESTED') {
                          <button
                            type="button"
                            class="btn h-10 text-sm @max-md:h-11 @max-md:flex-1"
                            [class]="quiet() ? 'btn-secondary' : 'btn-primary'"
                            [disabled]="busy() === o.id"
                            (click)="sample(o)"
                          >
                            <app-icon name="check" class="size-4" /> Registrar muestra
                          </button>
                        }
                        @case ('SAMPLE_TAKEN') {
                          <button
                            type="button"
                            class="btn h-10 text-sm @max-md:h-11 @max-md:flex-1"
                            [class]="quiet() ? 'btn-secondary' : 'btn-primary'"
                            (click)="openResult(o)"
                          >
                            <app-icon name="upload" class="size-4" /> Subir resultado
                          </button>
                        }
                        @case ('RESULT_READY') {
                          @if (isVet()) {
                            <button
                              type="button"
                              class="btn h-10 text-sm @max-md:h-11 @max-md:flex-1"
                              [class]="quiet() ? 'btn-secondary' : 'btn-primary'"
                              (click)="openReview(o)"
                            >
                              <app-icon name="stethoscope" class="size-4" /> Revisar e interpretar
                            </button>
                          } @else {
                            <p
                              class="text-right text-sm text-amber-800 @max-md:flex-1 @max-md:text-left"
                            >
                              Falta que el veterinario lo revise.
                            </p>
                          }
                        }
                        @case ('REVIEWED') {
                          @if (o.notifiedAt) {
                            <p
                              class="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-emerald-700"
                            >
                              <app-icon name="check" class="size-4" /> Dueño avisado
                              {{ date(o.notifiedAt) }}
                            </p>
                          } @else {
                            <a
                              class="btn h-10 bg-emerald-600 text-sm text-white hover:bg-emerald-700 @max-md:h-11 @max-md:flex-1"
                              [href]="whatsapp(o)"
                              target="_blank"
                              rel="noopener"
                              (click)="notified(o)"
                              [attr.aria-label]="'Avisar por WhatsApp a ' + o.client.name"
                            >
                              <app-icon name="message-circle" class="size-4" /> Avisar al dueño
                            </a>
                          }
                        }
                      }
                      @if (menuItems(o).length) {
                        <button
                          type="button"
                          class="btn btn-secondary size-10 shrink-0 px-0 @max-md:size-11"
                          [attr.aria-expanded]="menuFor() === o.id"
                          [attr.aria-controls]="'lab-menu-' + o.id"
                          [attr.aria-label]="'Más acciones de ' + examNames(o)"
                          (click)="toggleMenu(o.id)"
                        >
                          <app-icon name="more-horizontal" class="size-4" />
                        </button>
                        @if (menuFor() === o.id) {
                          <div
                            [id]="'lab-menu-' + o.id"
                            class="panel-in absolute top-full right-0 z-30 mt-1.5 w-60 origin-top-right rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5"
                            role="menu"
                          >
                            @for (m of menuItems(o); track m) {
                              <button
                                type="button"
                                role="menuitem"
                                class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-slate-50"
                                [class]="m === 'cancel' ? 'text-rose-700' : 'text-slate-800'"
                                (click)="menuAction(m, o)"
                              >
                                <app-icon
                                  [name]="m === 'cancel' ? 'x' : 'upload'"
                                  class="size-4"
                                  [class]="m === 'cancel' ? 'text-rose-600' : 'text-slate-500'"
                                />
                                {{ menuLabel(m, o) }}
                              </button>
                            }
                          </div>
                        }
                      } @else if (o.status !== 'REVIEWED' && o.status !== 'CANCELLED') {
                        <!-- Mantiene la columna alineada cuando no hay ⋯ -->
                        <span class="hidden w-10 shrink-0 @4xl:block" aria-hidden="true"></span>
                      }
                    </div>
                  </div>

                  @if (open) {
                    <!-- padding (no margin) abajo: el margen se escaparía de la tarjeta -->
                    <div class="px-3 pb-3 @md:px-4 @4xl:pl-[2.875rem]">
                      <div
                        [id]="'lab-detail-' + o.id"
                        class="space-y-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200"
                      >
                        @if (o.indication) {
                          <p>
                            <span class="font-medium text-slate-900">Indicación:</span>
                            {{ o.indication }}
                          </p>
                        }
                        <p class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-600">
                          <span>Pedido {{ when(o.requestedAt) }} · {{ o.requestedBy }}</span>
                          @if (o.sampleAt) {
                            <span>Muestra {{ when(o.sampleAt) }} · {{ o.sampleBy }}</span>
                          }
                          @if (o.total > 0) {
                            <span class="tabular-nums"
                              >{{ money(o.total)
                              }}{{ o.paid > 0 ? ' · pagado' : ' en la cuenta' }}</span
                            >
                          }
                        </p>
                        @if (o.resultAt) {
                          <div class="grid gap-3" [class.md:grid-cols-2]="!!o.interpretation">
                            <div>
                              <p
                                class="text-xs font-semibold tracking-wide text-slate-500 uppercase"
                              >
                                Resultado · {{ date(o.resultAt) }} · {{ o.resultBy }}
                              </p>
                              @if (o.resultText) {
                                <p class="mt-1 whitespace-pre-line text-slate-800">
                                  {{ o.resultText }}
                                </p>
                              }
                              @if (o.attachment; as file) {
                                <a
                                  [href]="fileUrl(file.id)"
                                  target="_blank"
                                  rel="noopener"
                                  class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 font-medium text-anil-700 ring-1 ring-slate-200 hover:bg-anil-50"
                                >
                                  <app-icon name="file-text" class="size-4" /> {{ file.fileName }}
                                </a>
                              }
                            </div>
                            @if (o.interpretation) {
                              <div class="rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200">
                                <p
                                  class="text-xs font-semibold tracking-wide text-emerald-800 uppercase"
                                >
                                  Interpretación · {{ o.reviewedBy }}
                                </p>
                                <p class="mt-1 whitespace-pre-line text-emerald-950">
                                  {{ o.interpretation }}
                                </p>
                              </div>
                            }
                          </div>
                        }
                        @if (o.status === 'CANCELLED') {
                          <p class="text-slate-500">Cancelado por {{ o.cancelledBy }}.</p>
                        }
                      </div>
                    </div>
                  }
                </li>
              }
            </ul>
          </section>
        }
      </div>
    } @else if (emptyText()) {
      <!-- Vacío: una línea; con quiet (dentro de la atención) ni eso, el título ya lo dice -->
      <p class="mt-3 text-sm text-slate-500">{{ emptyText() }}</p>
    }

    <!-- Pedir examen -->
    <app-modal
      [open]="ordering()"
      title="Pedir examen"
      description="Elige uno o varios exámenes: van en un solo pedido."
      (closed)="ordering.set(false)"
    >
      @if (catalog.isLoading()) {
        <div class="h-24 animate-pulse rounded-xl bg-slate-100" aria-busy="true"></div>
      } @else if (catalog.error()) {
        <p
          class="flex items-center gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200"
          role="alert"
        >
          <span class="flex-1">No se pudo cargar el catálogo de exámenes.</span>
          <button type="button" class="btn btn-secondary h-9 px-3" (click)="catalog.reload()">
            Reintentar
          </button>
        </p>
      } @else if (!labServices().length) {
        <p class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          No hay exámenes en el catálogo.
          <a routerLink="/servicios" class="font-semibold underline"
            >Créalos en Servicios y precios</a
          >
          con la categoría Laboratorio.
        </p>
      } @else {
        <form
          [formGroup]="orderForm"
          (ngSubmit)="submitOrder()"
          id="lab-order-form"
          class="space-y-4"
        >
          <fieldset>
            <legend class="field-label">Exámenes</legend>
            <div class="mt-1.5 grid gap-2">
              @for (s of labServices(); track s.id) {
                <button
                  type="button"
                  role="checkbox"
                  [attr.aria-checked]="chosen().includes(s.id)"
                  [attr.data-exam]="s.id"
                  class="flex min-h-12 items-center gap-3 rounded-xl px-3.5 py-2 text-left ring-1 transition-colors"
                  [class]="
                    chosen().includes(s.id)
                      ? 'bg-anil-50 ring-2 ring-anil-600'
                      : 'bg-white ring-slate-200 hover:bg-slate-50'
                  "
                  (click)="toggle(s.id)"
                >
                  <span
                    class="grid size-5 shrink-0 place-items-center rounded-md ring-1"
                    [class]="
                      chosen().includes(s.id)
                        ? 'bg-anil-600 text-white ring-anil-600'
                        : 'bg-white ring-slate-300'
                    "
                    aria-hidden="true"
                  >
                    @if (chosen().includes(s.id)) {
                      <app-icon name="check" class="size-3.5" />
                    }
                  </span>
                  <span class="min-w-0 flex-1 text-sm font-medium text-slate-900">{{
                    s.name
                  }}</span>
                  <span class="text-sm text-slate-700 tabular-nums">{{ money(s.price) }}</span>
                </button>
              }
            </div>
            @if (submitted() && !chosen().length) {
              <p class="field-error">Elige al menos un examen</p>
            }
          </fieldset>

          <div>
            <span id="lab-dest" class="field-label">Dónde se procesa</span>
            <div class="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="lab-dest">
              @for (d of destinations; track d.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="orderForm.controls.destination.value === d.value"
                  class="min-h-11 rounded-xl px-3 text-sm font-medium ring-1"
                  [class]="
                    orderForm.controls.destination.value === d.value
                      ? 'bg-anil-50 text-anil-900 ring-2 ring-anil-600'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                  "
                  (click)="orderForm.controls.destination.setValue(d.value)"
                >
                  {{ d.label }}
                </button>
              }
            </div>
          </div>
          @if (orderForm.controls.destination.value === 'EXTERNAL') {
            <div class="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div>
                <label for="lab-name" class="field-label"
                  >Laboratorio <span class="text-rose-600" aria-hidden="true">*</span></label
                >
                <input
                  id="lab-name"
                  class="field-input"
                  formControlName="externalLab"
                  maxlength="120"
                  autocomplete="off"
                  placeholder="Ej.: Laboratorio Central"
                  [attr.aria-invalid]="submitted() && orderForm.controls.externalLab.invalid"
                />
                @if (submitted() && orderForm.controls.externalLab.invalid) {
                  <p class="field-error">Escribe el laboratorio</p>
                }
              </div>
              <div>
                <label for="lab-cost" class="field-label">Le cobra (S/)</label>
                <input
                  id="lab-cost"
                  class="field-input tabular-nums"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.01"
                  formControlName="labCost"
                />
              </div>
            </div>
          }
          <div>
            <label for="lab-indication" class="field-label">Indicación (opcional)</label>
            <input
              id="lab-indication"
              class="field-input"
              formControlName="indication"
              maxlength="300"
              autocomplete="off"
              placeholder="Ej.: prequirúrgico, control de función renal"
            />
          </div>
          <label class="flex items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <input type="checkbox" class="mt-0.5 size-4 accent-anil-600" formControlName="charge" />
            <span class="text-sm">
              <span class="font-medium text-slate-900">Cargar a la cuenta del cliente</span>
              <span class="block text-slate-600">
                {{
                  orderForm.controls.charge.value
                    ? money(orderTotal()) + ' se cobran en caja.'
                    : 'Sin cobro (por ejemplo, incluido en una cirugía).'
                }}
              </span>
            </span>
          </label>
        </form>
      }
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="ordering.set(false)">
          Volver
        </button>
        <button
          type="submit"
          form="lab-order-form"
          class="btn btn-primary"
          [disabled]="saving() || !labServices().length"
        >
          @if (saving()) {
            <app-icon name="loader" class="size-4 animate-spin" />
          }
          Pedir {{ chosen().length > 1 ? chosen().length + ' exámenes' : 'examen' }}
        </button>
      </ng-container>
    </app-modal>

    <!-- Resultado -->
    <app-modal
      [open]="!!resultFor()"
      title="Subir resultado"
      [description]="
        resultFor()
          ? examNames(resultFor()!) + ' · ' + resultFor()!.pet.name + ' · ' + resultFor()!.code
          : ''
      "
      (closed)="closeResult()"
    >
      <form
        id="lab-result-form"
        (submit)="$event.preventDefault(); submitResult()"
        class="space-y-4"
      >
        <div>
          <span id="lab-file-label" class="field-label">Archivo del resultado</span>
          @if (touch) {
            <!-- Celular y tablet: la cámara primero -->
            <div class="mt-1.5 grid gap-2">
              <label class="btn btn-primary h-12 w-full cursor-pointer">
                <app-icon name="image" class="size-4" /> Tomar foto
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  class="sr-only"
                  aria-describedby="lab-file-help"
                  (change)="pickFile($event)"
                />
              </label>
              <label class="btn btn-secondary h-12 w-full cursor-pointer">
                <app-icon name="file-text" class="size-4" /> Elegir archivo o PDF
                <input
                  id="lab-file"
                  type="file"
                  [attr.accept]="accept"
                  class="sr-only"
                  aria-describedby="lab-file-help"
                  (change)="pickFile($event)"
                />
              </label>
            </div>
          } @else {
            <div
              class="mt-1.5 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors"
              [class]="dragging() ? 'border-anil-500 bg-anil-50' : 'border-anil-200 bg-anil-50/40'"
              (dragover)="dragOver($event)"
              (dragleave)="dragging.set(false)"
              (drop)="dropFile($event)"
            >
              <span
                class="mx-auto grid size-11 place-items-center rounded-xl bg-anil-100 text-anil-700"
              >
                <app-icon name="upload" class="size-5" />
              </span>
              <p class="mt-2 text-sm font-semibold text-slate-900">
                Arrastra el PDF o la foto aquí
              </p>
              <label class="btn btn-primary mt-3 h-10 cursor-pointer text-sm">
                <app-icon name="file-text" class="size-4" /> Elegir archivo
                <input
                  id="lab-file"
                  type="file"
                  [attr.accept]="accept"
                  class="sr-only"
                  aria-describedby="lab-file-help"
                  (change)="pickFile($event)"
                />
              </label>
            </div>
          }
          <p id="lab-file-help" class="mt-1.5 text-xs text-slate-500">
            PDF o foto (JPG, PNG, del iPhone) · las fotos se comprimen solas.
          </p>
          @if (fileError(); as e) {
            <p class="field-error" role="alert">{{ e }}</p>
          }
          @if (file(); as f) {
            <div class="mt-2 flex items-center gap-3 rounded-xl p-2 ring-1 ring-slate-200">
              @if (preview(); as src) {
                <img
                  [src]="src"
                  alt="Vista previa del resultado"
                  class="size-12 rounded-lg object-cover"
                />
              } @else {
                <span
                  class="grid size-12 place-items-center rounded-lg bg-rose-50 text-[10px] font-bold text-rose-700"
                  aria-hidden="true"
                  >PDF</span
                >
              }
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-slate-900">{{ f.name }}</span>
                <span class="block text-xs text-slate-500">{{ fileSize() }}</span>
              </span>
              <button
                type="button"
                class="grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Quitar archivo"
                (click)="setFile(null)"
              >
                <app-icon name="x" class="size-4" />
              </button>
            </div>
            @if (f.type.startsWith('image/')) {
              <label class="mt-2 flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  class="mt-0.5 size-4 accent-anil-600"
                  [checked]="original()"
                  (change)="setOriginal($any($event.target).checked)"
                />
                <span>
                  Subir en calidad original
                  <span class="block text-xs text-slate-500">
                    Sin comprimir (máximo 10 MB): para radiografías o microscopio.
                  </span>
                </span>
              </label>
            }
          }
        </div>
        <div>
          <label for="lab-values" class="field-label">Valores o resumen</label>
          <textarea
            id="lab-values"
            class="field-input min-h-24"
            maxlength="4000"
            [formControl]="resultText"
            aria-describedby="lab-values-help"
            placeholder="Ej.: Hto 38 %, leucocitos 12 000/µL"
          ></textarea>
          <p id="lab-values-help" class="mt-1 text-xs text-slate-500">
            Si no tienes archivo, escribe aquí los valores. Con archivo es opcional.
          </p>
        </div>
        @if (resultError(); as e) {
          <p class="field-error" role="alert">{{ e }}</p>
        }
        <p class="text-xs text-slate-500">
          Al guardar pasa a <b class="font-semibold text-slate-700">Por revisar</b> para que el
          veterinario lo lea y escriba su interpretación.
        </p>
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="closeResult()">Volver</button>
        <button type="submit" form="lab-result-form" class="btn btn-primary" [disabled]="saving()">
          @if (saving()) {
            <app-icon name="loader" class="size-4 animate-spin" />
          }
          Guardar resultado
        </button>
      </ng-container>
    </app-modal>

    <!-- Revisión -->
    <app-modal
      [open]="!!reviewFor()"
      title="Revisar resultado"
      description="Tu interpretación queda en la historia. Después recepción puede avisar al dueño."
      (closed)="reviewFor.set(null)"
    >
      @if (reviewFor(); as o) {
        <div class="mb-4 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
          <p class="font-medium text-slate-900">{{ examNames(o) }} · {{ o.pet.name }}</p>
          <!-- Los valores normales cambian por especie, edad y raza -->
          <p class="text-slate-600" data-pet-facts>{{ petFacts(o) }}</p>
          @if (o.indication) {
            <p class="mt-1 text-slate-600">
              <span class="font-medium text-slate-700">Indicación:</span> {{ o.indication }}
            </p>
          }
          @if (o.resultText) {
            <p class="mt-2 whitespace-pre-line text-slate-800">{{ o.resultText }}</p>
          }
          @if (o.attachment; as file) {
            <a
              [href]="fileUrl(file.id)"
              target="_blank"
              rel="noopener"
              class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 font-medium text-anil-700 ring-1 ring-slate-200 hover:bg-anil-50"
            >
              <app-icon name="file-text" class="size-4" /> Abrir {{ file.fileName }}
            </a>
          }
        </div>
      }
      <form id="lab-review-form" (submit)="$event.preventDefault(); submitReview()">
        <label for="lab-interpretation" class="field-label"
          >Interpretación <span class="text-rose-600" aria-hidden="true">*</span></label
        >
        <textarea
          id="lab-interpretation"
          class="field-input min-h-28"
          maxlength="2000"
          [formControl]="interpretation"
          placeholder="Ej.: valores normales, apto para cirugía"
          [attr.aria-invalid]="submitted() && interpretation.invalid"
        ></textarea>
        @if (submitted() && interpretation.invalid) {
          <p class="field-error">Escribe la interpretación</p>
        }
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="reviewFor.set(null)">
          Volver
        </button>
        <button type="submit" form="lab-review-form" class="btn btn-primary" [disabled]="saving()">
          Marcar como revisado
        </button>
      </ng-container>
    </app-modal>

    <!-- Cancelar -->
    <app-modal
      [open]="!!cancelFor()"
      title="Cancelar examen"
      [description]="
        cancelFor()
          ? examNames(cancelFor()!) + ' · ' + cancelFor()!.pet.name + ' · ' + cancelFor()!.code
          : ''
      "
      (closed)="cancelFor.set(null)"
    >
      @if (cancelFor(); as o) {
        @if (o.paid > 0) {
          <p
            class="mb-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200"
            data-cancel-note
          >
            <b class="font-semibold">Ya se cobró {{ money(o.paid) }}.</b>
            El examen se cancela y el cobro se queda. Si devuelves el dinero, hazlo en Comprobantes
            con nota de crédito.
            @if (unpaid(o) > 0) {
              Se quita de la cuenta lo que falta pagar ({{ money(unpaid(o)) }}).
            }
          </p>
        } @else if (o.total > 0) {
          <p
            class="mb-4 rounded-xl bg-anil-50 px-3 py-2.5 text-sm text-anil-900 ring-1 ring-anil-200"
            data-cancel-note
          >
            <b class="font-semibold">Aún no se cobró.</b> Se quita {{ money(o.total) }} de la cuenta
            de {{ o.client.name }}.
          </p>
        }
      }
      <form id="lab-cancel-form" (submit)="$event.preventDefault(); submitCancel()">
        <label for="lab-cancel" class="field-label"
          >Motivo <span class="text-rose-600" aria-hidden="true">*</span></label
        >
        <input
          id="lab-cancel"
          class="field-input"
          maxlength="200"
          [formControl]="cancelReason"
          placeholder="Ej.: el laboratorio perdió la muestra"
          [attr.aria-invalid]="submitted() && cancelReason.invalid"
        />
        @if (submitted() && cancelReason.invalid) {
          <p class="field-error">Escribe el motivo</p>
        }
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="cancelFor.set(null)">
          Volver
        </button>
        <button
          type="submit"
          form="lab-cancel-form"
          class="btn bg-rose-600 text-white hover:bg-rose-700"
          [disabled]="saving()"
        >
          Cancelar examen
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class LabOrdersComponent {
  private readonly api = inject(LabService);
  private readonly services = inject(CareServicesService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  readonly orders = input.required<LabOrder[]>();
  /** En la pantalla Exámenes: muestra mascota y dueño con enlace a la atención */
  readonly showPatient = input(false);
  /** Dentro de la atención: botones secundarios, la acción principal ahí es cerrar la atención */
  readonly quiet = input(false);
  /** Atención donde se piden exámenes nuevos (si se puede pedir) */
  readonly visitId = input<number | null>(null);
  readonly emptyText = input('Sin exámenes.');
  /** Algo cambió: el padre vuelve a pedir la lista */
  readonly changed = output<LabOrder>();

  protected readonly statusLabels = LAB_STATUS_LABELS;
  protected readonly speciesLabels = SPECIES_LABELS;
  /** En celular y tablet aparece "Tomar foto" (abre la cámara); en la PC sería igual que elegir archivo */
  protected readonly touch =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  protected readonly steps = LAB_STEPS;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly petCode = petCode;
  protected readonly money = money;
  protected readonly destinations = [
    { value: 'IN_HOUSE' as const, label: 'En la clínica' },
    { value: 'EXTERNAL' as const, label: 'Laboratorio externo' },
  ];
  protected readonly isVet = computed(() => ['ADMIN', 'VET'].includes(this.session.role() ?? ''));

  // ── Lista ──
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly menuFor = signal<number | null>(null);
  protected readonly groups = computed<LabGroup[]>(() => {
    const orders = this.orders();
    if (!this.showPatient())
      return [{ key: 'all', visitId: 0, pet: null, client: '', date: '', orders }];
    const byVisit = new Map<number, LabGroup>();
    for (const o of orders) {
      let g = byVisit.get(o.visitId);
      if (!g) {
        g = {
          key: 'v' + o.visitId,
          visitId: o.visitId,
          pet: o.pet,
          client: o.client.name,
          date: this.shortDate(o.requestedAt),
          orders: [],
        };
        byVisit.set(o.visitId, g);
      }
      g.orders.push(o);
    }
    return [...byVisit.values()];
  });

  protected readonly busy = signal<number | null>(null);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);

  // ── Pedir ──
  protected readonly ordering = signal(false);
  protected readonly catalog = rxResource({
    params: () => (this.ordering() ? true : undefined),
    stream: () => (this.ordering() ? this.services.list('active') : of([])),
  });
  private readonly catalogList = loaded(this.catalog);
  protected readonly labServices = computed(() =>
    (this.catalogList() ?? []).filter((s) => s.category === 'LAB'),
  );
  protected readonly chosen = signal<number[]>([]);
  protected readonly orderForm = new FormGroup({
    destination: new FormControl<'IN_HOUSE' | 'EXTERNAL'>('IN_HOUSE', { nonNullable: true }),
    externalLab: new FormControl('', { nonNullable: true }),
    labCost: new FormControl<number | null>(null, { validators: Validators.min(0) }),
    indication: new FormControl('', { nonNullable: true, validators: Validators.maxLength(300) }),
    charge: new FormControl(true, { nonNullable: true }),
  });
  protected readonly orderTotal = computed(() =>
    this.labServices()
      .filter((s) => this.chosen().includes(s.id))
      .reduce((sum, s) => sum + s.price, 0),
  );

  // ── Resultado, revisión y cancelación ──
  protected readonly resultFor = signal<LabOrder | null>(null);
  protected readonly resultText = new FormControl('', { nonNullable: true });
  protected readonly file = signal<File | null>(null);
  protected readonly accept = CLINICAL_ACCEPT;
  /** Subir la foto sin comprimir */
  protected readonly original = signal(false);
  protected readonly fileError = signal<string | null>(null);
  protected readonly dragging = signal(false);
  /** Vista previa de la foto elegida (se libera al cerrar) */
  protected readonly preview = signal<string | null>(null);
  protected readonly fileSize = computed(() => {
    const f = this.file();
    if (!f) return '';
    const isPhoto = f.type.startsWith('image/');
    return isPhoto && !this.original()
      ? `${kb(f.size)} · se comprime al subir (unos ${kb(Math.min(f.size, 350 * 1024))})`
      : kb(f.size);
  });
  protected readonly resultError = signal<string | null>(null);
  protected readonly reviewFor = signal<LabOrder | null>(null);
  protected readonly interpretation = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3)],
  });
  protected readonly cancelFor = signal<LabOrder | null>(null);
  protected readonly cancelReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3)],
  });

  /** Lo llama el padre con su botón "Pedir examen" */
  openOrder(): void {
    this.chosen.set([]);
    this.submitted.set(false);
    this.orderForm.reset({
      destination: 'IN_HOUSE',
      externalLab: '',
      labCost: null,
      indication: '',
      charge: true,
    });
    this.ordering.set(true);
  }

  protected toggle(id: number): void {
    this.chosen.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected submitOrder(): void {
    this.submitted.set(true);
    const visitId = this.visitId();
    const v = this.orderForm.getRawValue();
    const external = v.destination === 'EXTERNAL';
    if (!visitId || !this.chosen().length || (external && v.externalLab.trim().length < 2)) {
      if (external) this.orderForm.controls.externalLab.setErrors({ required: true });
      return;
    }
    this.saving.set(true);
    this.api
      .create(visitId, {
        careServiceIds: this.chosen(),
        destination: v.destination,
        externalLab: external ? v.externalLab.trim() : null,
        labCost: external && v.labCost !== null ? Number(v.labCost) : null,
        indication: v.indication.trim() || null,
        charge: v.charge,
      })
      .subscribe({
        next: (order) => {
          this.saving.set(false);
          this.ordering.set(false);
          this.toast.success(`Pedido ${order.code} registrado`);
          this.changed.emit(order);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected sample(o: LabOrder): void {
    this.busy.set(o.id);
    this.api.sample(o.id).subscribe({
      next: (order) => {
        this.busy.set(null);
        this.changed.emit(order);
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected openResult(o: LabOrder): void {
    this.setFile(null);
    this.fileError.set(null);
    this.original.set(false);
    this.resultError.set(null);
    this.resultText.setValue(o.resultText ?? '');
    this.resultFor.set(o);
  }

  protected pickFile(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    this.useFile(inputEl.files?.[0] ?? null);
    inputEl.value = '';
  }

  protected dropFile(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.useFile(event.dataTransfer?.files?.[0] ?? null);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  private useFile(file: File | null): void {
    const error = file ? clinicalFileError(file, this.original()) : null;
    this.fileError.set(error);
    this.setFile(file && !error ? file : null);
    if (file && !error) this.resultError.set(null);
  }

  protected setFile(file: File | null): void {
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
    this.preview.set(
      file?.type.startsWith('image/') && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : null,
    );
    this.file.set(file);
  }

  protected closeResult(): void {
    this.setFile(null);
    this.resultFor.set(null);
  }

  protected setOriginal(value: boolean): void {
    this.original.set(value);
    const f = this.file();
    if (f) this.fileError.set(clinicalFileError(f, value));
  }

  protected submitResult(): void {
    const o = this.resultFor();
    if (!o) return;
    const text = this.resultText.value.trim() || null;
    if (!text && !this.file()) {
      this.resultError.set('Sube el archivo del resultado o escribe los valores');
      return;
    }
    if (this.fileError()) return;
    this.saving.set(true);
    this.api.result(o.id, text, this.file(), this.original()).subscribe({
      next: (order) => {
        this.saving.set(false);
        this.closeResult();
        this.toast.success(
          this.isVet()
            ? 'Resultado guardado: revísalo'
            : 'Resultado guardado: el veterinario lo revisará',
        );
        this.changed.emit(order);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected openReview(o: LabOrder): void {
    this.submitted.set(false);
    this.interpretation.reset('');
    this.reviewFor.set(o);
  }

  protected submitReview(): void {
    const o = this.reviewFor();
    this.submitted.set(true);
    if (!o || this.interpretation.invalid) return;
    this.saving.set(true);
    this.api.review(o.id, this.interpretation.value.trim()).subscribe({
      next: (order) => {
        this.saving.set(false);
        this.reviewFor.set(null);
        this.toast.success('Resultado revisado');
        this.changed.emit(order);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  /** El enlace abre WhatsApp; aquí solo se marca el aviso */
  protected notified(o: LabOrder): void {
    this.api.notified(o.id).subscribe({
      next: (order) => this.changed.emit(order),
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  protected openCancel(o: LabOrder): void {
    this.submitted.set(false);
    this.cancelReason.reset('');
    this.cancelFor.set(o);
  }

  protected submitCancel(): void {
    const o = this.cancelFor();
    this.submitted.set(true);
    if (!o || this.cancelReason.invalid) return;
    this.saving.set(true);
    this.api.cancel(o.id, this.cancelReason.value.trim()).subscribe({
      next: (order) => {
        this.saving.set(false);
        this.cancelFor.set(null);
        this.toast.success(`Examen ${order.code} cancelado`);
        this.changed.emit(order);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected toggleOpen(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Lo que trae ⋯ según el paso y el rol (Cancelar: solo veterinario o admin, antes del resultado) */
  protected menuItems(o: LabOrder): MenuAction[] {
    const items: MenuAction[] = [];
    if (o.status === 'REQUESTED' || o.status === 'RESULT_READY') items.push('result');
    if (this.isVet() && (o.status === 'REQUESTED' || o.status === 'SAMPLE_TAKEN'))
      items.push('cancel');
    return items;
  }

  protected menuLabel(action: MenuAction, o: LabOrder): string {
    if (action === 'cancel') return 'Cancelar examen';
    return o.status === 'RESULT_READY' ? 'Cambiar resultado' : 'Subir resultado ahora';
  }

  protected toggleMenu(id: number): void {
    this.menuFor.set(this.menuFor() === id ? null : id);
  }

  protected closeMenu(): void {
    const id = this.menuFor();
    if (id === null) return;
    this.menuFor.set(null);
    // El foco vuelve al botón ⋯
    document.querySelector<HTMLElement>(`[aria-controls="lab-menu-${id}"]`)?.focus();
  }

  protected onDocClick(event: Event): void {
    if (this.menuFor() === null) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-lab-menu]')) this.menuFor.set(null);
  }

  protected menuAction(action: MenuAction, o: LabOrder): void {
    this.menuFor.set(null);
    if (action === 'cancel') this.openCancel(o);
    else this.openResult(o);
  }

  protected place(o: LabOrder): string {
    return o.destination === 'EXTERNAL'
      ? (o.externalLab ?? 'Laboratorio externo')
      : 'En la clínica';
  }

  /** "Perro · Labrador · Macho · 7 años · 24.5 kg" para interpretar el resultado */
  protected petFacts(o: LabOrder): string {
    const p = o.pet;
    return [
      SPECIES_LABELS[p.species],
      p.breed,
      p.sex ? SEX_LABELS[p.sex] : null,
      petAge(p.birthDate),
      p.weightKg !== null ? `${p.weightKg} kg` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** Lo que se quita de la cuenta al cancelar (lo pagado se queda) */
  protected unpaid(o: LabOrder): number {
    return Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
  }

  protected shortDate(iso: string): string {
    const [d, m] = formatDate(iso, 'date').split('/');
    return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  }

  /** "hoy 10:20", "ayer 09:05" o "19/11 10:12" (hora de Lima) */
  protected when(iso: string): string {
    const time = formatDate(iso, 'time');
    const day = limaToday(new Date(iso));
    if (day === limaToday()) return `hoy ${time}`;
    if (day === limaToday(new Date(Date.now() - 86_400_000))) return `ayer ${time}`;
    return `${formatDate(iso, 'date').slice(0, 5)} ${time}`;
  }

  protected examNames(o: LabOrder): string {
    return o.items.map((i) => i.name).join(' + ');
  }

  protected stepIndex(status: LabStatus): number {
    return LAB_STEPS.findIndex((s) => s.status === status);
  }

  protected date(iso: string): string {
    return formatDate(iso, 'date');
  }

  protected fileUrl(id: number): string {
    return this.api.fileUrl(id);
  }

  protected whatsapp(o: LabOrder): string {
    return labWhatsapp(o, this.session.clinicName());
  }

  private fail(error: unknown): void {
    this.saving.set(false);
    this.toast.error(apiErrorMessage(error));
  }
}
