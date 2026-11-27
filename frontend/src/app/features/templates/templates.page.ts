import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import {
  CONSULTATION_FIELDS,
  ClinicalTemplate,
  ClinicalTemplatesService,
  ConsultationContent,
  TEMPLATE_KIND_LABELS,
  TemplateInput,
  TemplateKind,
  TemplateRxItem,
  SOAP_LETTER,
  fieldName,
  rxDosage,
  templateBlankCount,
} from '../../core/services/clinical-templates.service';
import { InventoryService } from '../../core/services/inventory.service';
import {
  DURATION_OPTIONS,
  FREQUENCY_OPTIONS,
  ROUTE_OPTIONS,
} from '../../core/services/medical.models';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { TemplateTextComponent } from './template-text.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatQty, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

const text = (max: number, required = false) =>
  new FormControl('', {
    nonNullable: true,
    validators: required
      ? [Validators.required, Validators.maxLength(max)]
      : [Validators.maxLength(max)],
  });

type RxRow = FormGroup<{
  productId: FormControl<number | null>;
  presentationId: FormControl<number | null>;
  /** Solo para mostrar: "Tableta 250 mg" (no se guarda) */
  presentation: FormControl<string>;
  /** El producto ya no está en el inventario: se guardará como receta externa */
  missing: FormControl<boolean>;
  /** Del inventario: se entrega y cobra en la clínica */
  dispense: FormControl<boolean>;
  dispenseQuantity: FormControl<number | null>;
  drug: FormControl<string>;
  dose: FormControl<string>;
  route: FormControl<string>;
  frequency: FormControl<string>;
  duration: FormControl<string>;
  instructions: FormControl<string>;
}>;

interface DrugOption {
  key: string;
  productId: number;
  presentationId: number;
  drug: string;
  presentation: string;
  stock: string;
}

/** Ayuda y ejemplo de cada campo de la consulta */
const FIELD_HELP: Record<keyof ConsultationContent, { hint: string; example: string }> = {
  reason: { hint: 'Por qué viene, en pocas palabras.', example: 'Ej.: Vómitos y diarrea' },
  anamnesis: {
    hint: 'Lo que cuenta el dueño.',
    example: 'Ej.: Vómitos hace ___ días, apetito disminuido, vacunas al día',
  },
  physicalExam: {
    hint: 'Lo que encuentras al revisarlo.',
    example: 'Ej.: T° ___ °C, mucosas rosadas, deshidratación leve',
  },
  diagnosis: {
    hint: 'Presuntivo o definitivo.',
    example: 'Ej.: Gastroenteritis aguda',
  },
  plan: {
    hint: 'Tratamiento, indicaciones y control.',
    example: 'Ej.: Dieta blanda 3 días, hidratación, control en 48 h',
  },
};

const TAB_INFO: Record<TemplateKind, string> = {
  CONSULTATION:
    'Motivo y SOAP que se repiten. En la Atención: «Usar plantilla» los llena y tú completas lo del paciente.',
  PRESCRIPTION:
    'Medicamentos que recetas seguido. Al recetar: «Recetas frecuentes» los agrega de una vez.',
};

const HOWTO_KEY = 'uywa.templates.howto-hidden';
const SEARCH_FROM = 6;
/** Tarjetas por tanda cuando hay muchas plantillas */
const PAGE = 12;

/**
 * Plantillas clínicas: consultas que se repiten (motivo, SOAP) y recetas frecuentes. Se aplican
 * desde la atención con un clic; aquí se ordenan, corrigen y crean. Una receta ligada al
 * inventario se entrega y cobra al usarla; una escrita a mano queda como receta externa.
 */
@Component({
  selector: 'app-templates-page',
  imports: [
    ReactiveFormsModule,
    IconComponent,
    ModalComponent,
    BadgeComponent,
    FechaPipe,
    TemplateTextComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-6">
      <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900">Plantillas clínicas</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-600">
            Lo que escribes una y otra vez, listo para usar en la consulta. Las más usadas aparecen
            primero.
          </p>
        </div>
        <button type="button" class="btn btn-primary" (click)="askNew()">
          <app-icon name="plus" class="size-4" />
          {{ tab() === 'CONSULTATION' ? 'Nueva plantilla' : 'Nueva receta frecuente' }}
        </button>
      </header>

      @if (!howtoHidden()) {
        <section
          class="rounded-2xl bg-anil-50/70 p-4 ring-1 ring-anil-100 sm:p-5"
          aria-labelledby="howto-title"
        >
          <div class="flex items-center justify-between gap-3">
            <h2 id="howto-title" class="text-sm font-semibold text-anil-900">Cómo funciona</h2>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-sm font-medium text-anil-700 hover:bg-anil-100 hover:text-anil-900"
              (click)="hideHowto()"
            >
              Ocultar
            </button>
          </div>
          <ol class="mt-3 grid gap-3 sm:grid-cols-3">
            @for (step of howto; track step.n) {
              <li class="flex gap-3">
                <span
                  class="grid size-7 shrink-0 place-items-center rounded-full bg-white font-display text-sm font-semibold text-anil-700 ring-1 ring-anil-200"
                  aria-hidden="true"
                  >{{ step.n }}</span
                >
                <p class="text-sm text-slate-700">
                  <span class="font-medium text-slate-900">{{ step.title }}</span>
                  {{ step.text }}
                </p>
              </li>
            }
          </ol>
        </section>
      }

      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div
          role="group"
          aria-label="Tipo de plantilla"
          class="flex gap-1 border-b border-slate-200 sm:flex-1"
        >
          @for (k of kinds; track k) {
            <button
              type="button"
              [attr.aria-pressed]="tab() === k"
              class="-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors"
              [class]="
                tab() === k
                  ? 'border-anil-600 text-anil-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              "
              (click)="selectTab(k)"
            >
              <app-icon [name]="k === 'CONSULTATION' ? 'stethoscope' : 'pill'" class="size-4" />
              {{ kindLabels[k] }}
              <span class="rounded-full bg-slate-100 px-2 text-xs text-slate-600 tabular-nums">{{
                count(k)
              }}</span>
            </button>
          }
        </div>
        @if (count(tab()) > searchFrom) {
          <div class="relative sm:w-80">
            <label for="tpl-search" class="sr-only">Buscar plantilla</label>
            <app-icon
              name="search"
              class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
            />
            <input
              id="tpl-search"
              type="search"
              [formControl]="filter"
              class="field-input mt-0 pl-10"
              placeholder="Buscar por nombre o contenido"
              autocomplete="off"
            />
          </div>
        }
      </div>
      <p class="-mt-3 text-sm text-slate-600">{{ tabInfo[tab()] }}</p>

      @if (loading()) {
        <div class="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Cargando plantillas">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="card h-28 animate-pulse bg-slate-50"></div>
          }
        </div>
      } @else if (error(); as e) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <app-icon name="alert" class="size-8 text-rose-600" />
          <p class="mt-3 font-medium text-slate-900">{{ e }}</p>
          <button type="button" class="btn btn-secondary mt-5" (click)="load()">Reintentar</button>
        </div>
      } @else if (!count(tab())) {
        <div class="card flex flex-col items-center px-6 py-14 text-center">
          <span class="grid size-14 place-items-center rounded-2xl bg-anil-50 text-anil-600">
            <app-icon [name]="tab() === 'CONSULTATION' ? 'book-open' : 'pill'" class="size-7" />
          </span>
          <p class="mt-4 font-display text-lg font-semibold text-slate-900">
            {{
              tab() === 'CONSULTATION'
                ? 'Aún no hay plantillas de consulta'
                : 'Aún no hay recetas frecuentes'
            }}
          </p>
          <p class="mt-1 max-w-md text-sm text-slate-600">
            {{
              tab() === 'CONSULTATION'
                ? 'Crea la primera aquí. También puedes guardar una consulta ya escrita con «Guardar como plantilla».'
                : 'Crea la primera aquí. También puedes guardarla al recetar con «Guardar como receta frecuente».'
            }}
          </p>
          <button type="button" class="btn btn-primary mt-5" (click)="askNew()">
            <app-icon name="plus" class="size-4" />
            {{ tab() === 'CONSULTATION' ? 'Nueva plantilla' : 'Nueva receta frecuente' }}
          </button>
        </div>
      } @else if (!visible().length) {
        <p class="card px-6 py-10 text-center text-sm text-slate-600">
          Ninguna plantilla coincide con «{{ filter.value.trim() }}».
        </p>
      } @else {
        <!-- Tarjeta completa: todo lo que escribe la plantilla, ordenado como en la Atención (SOAP).
             Toda la tarjeta abre la plantilla; Duplicar y Eliminar están adentro -->
        <ul class="grid gap-4 lg:grid-cols-2">
          @for (t of shown(); track t.id) {
            <li
              class="card group relative flex flex-col p-5 transition-shadow focus-within:ring-2 focus-within:ring-anil-500 hover:shadow-md"
            >
              <div class="flex items-start gap-3">
                <span
                  class="grid size-10 shrink-0 place-items-center rounded-xl bg-anil-50 text-anil-700"
                  aria-hidden="true"
                >
                  <app-icon
                    [name]="t.kind === 'CONSULTATION' ? 'stethoscope' : 'pill'"
                    class="size-5"
                  />
                </span>
                <div class="min-w-0 flex-1">
                  <h2 class="font-display text-base leading-snug font-semibold text-slate-900">
                    <button
                      type="button"
                      class="text-left outline-none group-hover:text-anil-700 after:absolute after:inset-0 after:rounded-2xl"
                      (click)="askEdit(t)"
                      [attr.data-tpl-id]="t.id"
                      [attr.aria-label]="'Abrir plantilla ' + t.name"
                    >
                      {{ t.name }}
                    </button>
                  </h2>
                  <p
                    class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
                  >
                    <span class="tabular-nums"
                      >{{ t.usageCount }} {{ t.usageCount === 1 ? 'uso' : 'usos' }}</span
                    >
                    @if (blankCount(t); as n) {
                      <span aria-hidden="true">·</span>
                      <app-badge tone="warning"
                        >{{ n }} {{ n === 1 ? 'dato' : 'datos' }} por llenar</app-badge
                      >
                    }
                  </p>
                </div>
              </div>

              @if (t.consultation; as c) {
                <dl class="mt-4 space-y-2.5 text-sm">
                  @for (f of fields; track f.key) {
                    @if (c[f.key]) {
                      <div
                        class="grid grid-cols-[7.5rem_1fr] gap-3 max-sm:grid-cols-1 max-sm:gap-0.5"
                      >
                        <dt class="flex items-center gap-2 self-start text-slate-600">
                          @if (soap[f.key]; as l) {
                            <span class="soap-letter shrink-0" aria-hidden="true">{{ l }}</span>
                          } @else {
                            <span class="size-6 shrink-0 max-sm:hidden" aria-hidden="true"></span>
                          }
                          {{ short(f.label) }}
                        </dt>
                        <dd class="line-clamp-2 min-w-0 text-slate-800">
                          <app-template-text [text]="c[f.key]!" />
                        </dd>
                      </div>
                    }
                  }
                </dl>
              } @else if (t.prescription; as p) {
                <ul class="mt-4 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                  @for (item of p.items; track $index) {
                    <li class="px-3.5 py-2.5 text-sm">
                      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span class="font-medium text-slate-900">{{ item.drug }}</span>
                        @if (item.productId) {
                          <app-badge tone="success">Del inventario</app-badge>
                        } @else {
                          <app-badge tone="neutral">Externa</app-badge>
                        }
                      </div>
                      <p class="mt-0.5 text-slate-600">{{ dosage(item) }}</p>
                    </li>
                  }
                </ul>
              }

              <div class="mt-auto pt-5">
                <div
                  class="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600"
                >
                  <span class="truncate"
                    >{{ t.createdBy.fullName }} · actualizada {{ t.updatedAt | fecha }}</span
                  >
                  <span
                    class="flex shrink-0 items-center gap-1 font-medium text-anil-700"
                    aria-hidden="true"
                  >
                    <app-icon name="pencil" class="size-3.5" /> Abrir
                  </span>
                </div>
              </div>
            </li>
          }
        </ul>
        <!-- Muchas plantillas: se muestran de a 12 (las más usadas primero); buscar muestra todas -->
        @if (visible().length > shown().length) {
          <div class="flex flex-col items-center gap-2 pt-1">
            <p class="text-sm text-slate-600" aria-live="polite">
              Mostrando {{ shown().length }} de {{ visible().length }}
            </p>
            <button type="button" class="btn btn-secondary" (click)="showMore()">
              <app-icon name="chevron-down" class="size-4" />
              Ver {{ nextBatch() }} más
            </button>
          </div>
        }
      }
    </section>

    <!-- Crear / editar -->
    <app-modal
      [open]="editing() !== null"
      [title]="
        editing()?.id
          ? editing()?.kind === 'CONSULTATION'
            ? 'Plantilla de consulta'
            : 'Receta frecuente'
          : editing()?.kind === 'CONSULTATION'
            ? 'Nueva plantilla de consulta'
            : 'Nueva receta frecuente'
      "
      [dismissible]="false"
      (closed)="closeEditor()"
    >
      <form id="tpl-form" (submit)="$event.preventDefault(); save()" novalidate class="space-y-5">
        <div>
          <label for="tpl-name" class="field-label"
            >Nombre <span class="text-rose-600" aria-hidden="true">*</span></label
          >
          <input
            id="tpl-name"
            [formControl]="name"
            class="field-input"
            maxlength="80"
            autocomplete="off"
            [placeholder]="
              editing()?.kind === 'CONSULTATION'
                ? 'Ej.: Gastroenteritis aguda'
                : 'Ej.: Gastroenteritis — perro'
            "
            aria-required="true"
            [attr.aria-invalid]="bad(name)"
            aria-describedby="tpl-name-hint"
          />
          <p id="tpl-name-hint" [class]="bad(name) ? 'field-error' : 'field-hint'">
            {{
              bad(name)
                ? 'Escribe un nombre de 2 a 80 caracteres.'
                : 'Es lo que verás en la lista al usarla. Que se entienda de un vistazo.'
            }}
          </p>
        </div>

        @if (editing()?.kind === 'CONSULTATION') {
          <p
            class="flex gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200"
          >
            <app-icon name="info" class="mt-0.5 size-4 shrink-0 text-slate-500" />
            <span
              >Escribe solo lo que se repite; lo de cada paciente se completa en la consulta. Usa
              <strong class="font-semibold">___</strong> donde va un dato, por ejemplo «T° ___
              °C».</span
            >
          </p>
          @for (f of fields; track f.key) {
            <div>
              <label [for]="'tpl-' + f.key" class="field-label">{{ f.label }}</label>
              @if (f.key === 'reason' || f.key === 'diagnosis') {
                <input
                  [id]="'tpl-' + f.key"
                  [formControl]="consultation.controls[f.key]"
                  class="field-input"
                  [attr.maxlength]="f.key === 'reason' ? 200 : 300"
                  autocomplete="off"
                  [placeholder]="help[f.key].example"
                  [attr.aria-describedby]="'tpl-' + f.key + '-hint'"
                />
              } @else {
                <textarea
                  [id]="'tpl-' + f.key"
                  [formControl]="consultation.controls[f.key]"
                  rows="3"
                  maxlength="5000"
                  class="field-input h-auto py-2.5"
                  [placeholder]="help[f.key].example"
                  [attr.aria-describedby]="'tpl-' + f.key + '-hint'"
                ></textarea>
              }
              <p [id]="'tpl-' + f.key + '-hint'" class="field-hint">{{ help[f.key].hint }}</p>
            </div>
          }
          @if (emptyConsultation()) {
            <p class="field-error" role="alert">Escribe al menos un campo de la consulta.</p>
          }
        } @else {
          <p
            class="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200"
          >
            <app-icon name="alert" class="mt-0.5 size-4 shrink-0" />
            <span
              ><strong class="font-semibold">La dosis es de referencia:</strong> ajústala al peso
              del paciente al recetar.</span
            >
          </p>
          <ol class="space-y-3">
            @for (g of rx.controls; track g; let i = $index) {
              <li class="rounded-xl p-4 ring-1 ring-slate-200" [formGroup]="g">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-slate-900">Medicamento {{ i + 1 }}</p>
                  @if (rx.length > 1) {
                    <button
                      type="button"
                      class="btn btn-ghost size-10 shrink-0 px-0 text-slate-500 hover:text-rose-700"
                      (click)="removeRow(i)"
                      [attr.aria-label]="'Quitar medicamento ' + (i + 1)"
                    >
                      <app-icon name="x" class="size-4" />
                    </button>
                  }
                </div>

                <label [for]="'rx-drug-' + i" class="field-label mt-1"
                  >Medicamento <span class="text-rose-600" aria-hidden="true">*</span></label
                >
                <div class="relative">
                  <app-icon
                    name="search"
                    class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    [id]="'rx-drug-' + i"
                    formControlName="drug"
                    class="field-input mt-0 pl-10 font-medium"
                    placeholder="Busca en el inventario o escribe el nombre"
                    maxlength="150"
                    autocomplete="off"
                    [attr.aria-controls]="
                      activeRow() === i && options().length ? 'rx-options-' + i : null
                    "
                    aria-required="true"
                    [attr.aria-invalid]="bad(g.controls.drug)"
                    (input)="onDrugInput(i)"
                    (focus)="activeRow.set(i)"
                    (blur)="closeOptions(i)"
                    (keydown.escape)="activeRow.set(null)"
                  />
                </div>
                @if (
                  activeRow() === i &&
                  g.controls.drug.value.trim().length >= 2 &&
                  !g.controls.productId.value
                ) {
                  <ul
                    [id]="'rx-options-' + i"
                    [attr.aria-label]="'Resultados para ' + g.controls.drug.value.trim()"
                    class="mt-1 space-y-0.5 rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200"
                    (mousedown)="$event.preventDefault()"
                  >
                    @for (o of options(); track o.key) {
                      <li>
                        <button
                          type="button"
                          class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                          (click)="pick(i, o)"
                        >
                          <span class="min-w-0">
                            <span class="block font-medium text-slate-900">{{ o.drug }}</span>
                            <span class="block text-xs text-slate-600"
                              >{{ o.presentation }} · {{ o.stock }}</span
                            >
                          </span>
                          <app-badge tone="success">Inventario</app-badge>
                        </button>
                      </li>
                    }
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        (click)="activeRow.set(null)"
                      >
                        <app-icon name="pen-line" class="size-4 text-slate-500" />
                        Usar «{{ g.controls.drug.value.trim() }}» como receta externa
                      </button>
                    </li>
                  </ul>
                }
                @if (bad(g.controls.drug)) {
                  <p class="field-error">Elige un medicamento o escribe su nombre.</p>
                } @else if (g.controls.productId.value) {
                  <p class="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-800">
                    <app-icon name="check" class="size-3.5" />
                    Del inventario{{
                      g.controls.presentation.value ? ' · ' + g.controls.presentation.value : ''
                    }}: se entrega y cobra en la clínica.
                  </p>
                } @else if (g.controls.missing.value) {
                  <p class="mt-1.5 flex items-center gap-1.5 text-xs text-amber-800">
                    <app-icon name="alert" class="size-3.5" />
                    Ya no está en el inventario: quedará como receta externa.
                  </p>
                } @else if (g.controls.drug.value.trim() && activeRow() !== i) {
                  <p class="mt-1.5 text-xs text-slate-500">
                    Receta externa: el dueño la compra en farmacia (no se cobra en la clínica).
                  </p>
                }

                @if (g.controls.productId.value) {
                  <div
                    class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-slate-50 px-3 py-2"
                  >
                    <label class="flex min-h-11 items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        formControlName="dispense"
                        class="size-4 rounded border-slate-300 text-anil-600 focus:ring-anil-500"
                      />
                      Entregar y cobrar en la clínica
                    </label>
                    @if (g.controls.dispense.value) {
                      <span class="flex items-center gap-2">
                        <label [for]="'rx-qty-' + i" class="text-sm text-slate-600">Cantidad</label>
                        <input
                          [id]="'rx-qty-' + i"
                          type="number"
                          inputmode="decimal"
                          min="0.01"
                          step="0.01"
                          formControlName="dispenseQuantity"
                          class="field-input mt-0 h-10 w-24 bg-white tabular-nums"
                          [attr.aria-invalid]="bad(g.controls.dispenseQuantity)"
                        />
                      </span>
                    }
                  </div>
                  @if (g.controls.dispense.value && bad(g.controls.dispenseQuantity)) {
                    <p class="field-error">Indica cuánto se entrega (mayor a 0).</p>
                  }
                }

                <div class="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label [for]="'rx-dose-' + i" class="field-label"
                      >Dosis <span class="text-rose-600" aria-hidden="true">*</span></label
                    >
                    <input
                      [id]="'rx-dose-' + i"
                      formControlName="dose"
                      class="field-input"
                      placeholder="Ej.: 1 tableta"
                      maxlength="80"
                      aria-required="true"
                      [attr.aria-invalid]="bad(g.controls.dose)"
                    />
                    @if (bad(g.controls.dose)) {
                      <p class="field-error">Falta la dosis.</p>
                    }
                  </div>
                  <div>
                    <label [for]="'rx-route-' + i" class="field-label">Vía</label>
                    <input
                      [id]="'rx-route-' + i"
                      formControlName="route"
                      class="field-input"
                      placeholder="Ej.: Oral"
                      maxlength="40"
                      list="tpl-routes"
                    />
                  </div>
                  <div>
                    <label [for]="'rx-freq-' + i" class="field-label"
                      >Frecuencia <span class="text-rose-600" aria-hidden="true">*</span></label
                    >
                    <input
                      [id]="'rx-freq-' + i"
                      formControlName="frequency"
                      class="field-input"
                      placeholder="Ej.: Cada 12 horas"
                      maxlength="60"
                      list="tpl-freq"
                      aria-required="true"
                      [attr.aria-invalid]="bad(g.controls.frequency)"
                    />
                    @if (bad(g.controls.frequency)) {
                      <p class="field-error">Falta la frecuencia.</p>
                    }
                  </div>
                  <div>
                    <label [for]="'rx-dur-' + i" class="field-label"
                      >Duración <span class="text-rose-600" aria-hidden="true">*</span></label
                    >
                    <input
                      [id]="'rx-dur-' + i"
                      formControlName="duration"
                      class="field-input"
                      placeholder="Ej.: 5 días"
                      maxlength="60"
                      list="tpl-dur"
                      aria-required="true"
                      [attr.aria-invalid]="bad(g.controls.duration)"
                    />
                    @if (bad(g.controls.duration)) {
                      <p class="field-error">Falta la duración.</p>
                    }
                  </div>
                </div>
                <div class="mt-3">
                  <label [for]="'rx-ins-' + i" class="field-label"
                    >Indicaciones <span class="font-normal text-slate-500">(opcional)</span></label
                  >
                  <input
                    [id]="'rx-ins-' + i"
                    formControlName="instructions"
                    class="field-input"
                    placeholder="Ej.: Dar con comida"
                    maxlength="300"
                  />
                </div>
              </li>
            }
          </ol>
          <datalist id="tpl-routes">
            @for (r of routes; track r) {
              <option [value]="r"></option>
            }
          </datalist>
          <datalist id="tpl-freq">
            @for (r of frequencies; track r) {
              <option [value]="r"></option>
            }
          </datalist>
          <datalist id="tpl-dur">
            @for (r of durations; track r) {
              <option [value]="r"></option>
            }
          </datalist>
          @if (rx.length < 12) {
            <button type="button" class="btn btn-secondary h-10" (click)="addRow(); focusDrug()">
              <app-icon name="plus" class="size-4" /> Agregar medicamento
            </button>
          }
          <div>
            <label for="tpl-notes" class="field-label"
              >Indicaciones generales
              <span class="font-normal text-slate-500">(opcional)</span></label
            >
            <textarea
              id="tpl-notes"
              [formControl]="rxNotes"
              rows="2"
              maxlength="1000"
              class="field-input h-auto py-2.5"
              placeholder="Ej.: Volver a control en 7 días o antes si no mejora"
            ></textarea>
          </div>
        }
      </form>
      <div modal-actions class="contents">
        @if (confirmDiscard()) {
          <p class="mr-auto self-center text-sm font-medium text-slate-800" role="alert">
            ¿Descartar los cambios?
          </p>
          <button type="button" class="btn btn-secondary" (click)="confirmDiscard.set(false)">
            Seguir editando
          </button>
          <button type="button" class="btn btn-danger" (click)="discard()">Descartar</button>
        } @else {
          @if (editing()?.id) {
            <div class="flex gap-2 sm:mr-auto">
              <button
                type="button"
                class="btn btn-ghost flex-1 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:flex-none"
                [disabled]="saving()"
                (click)="askDelete()"
              >
                <app-icon name="trash" class="size-4" /> Eliminar
              </button>
              <button
                type="button"
                class="btn btn-ghost flex-1 sm:flex-none"
                [disabled]="saving()"
                (click)="duplicate()"
              >
                <app-icon name="copy" class="size-4" /> Duplicar
              </button>
            </div>
          }
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="saving()"
            (click)="closeEditor()"
          >
            Cancelar
          </button>
          <button type="submit" form="tpl-form" class="btn btn-primary" [disabled]="saving()">
            @if (saving()) {
              <app-icon name="loader" class="size-4 animate-spin" />
            }
            Guardar
          </button>
        }
      </div>
    </app-modal>

    <!-- Eliminar -->
    <app-modal
      [open]="deleting() !== null"
      title="Eliminar plantilla"
      [description]="
        '«' +
        (deleting()?.name ?? '') +
        '» deja de aparecer al atender. Lo ya escrito en consultas y recetas no cambia.'
      "
      (closed)="deleting.set(null)"
    >
      <div modal-actions class="contents">
        <button type="button" class="btn btn-secondary" (click)="deleting.set(null)">
          Cancelar
        </button>
        <button type="button" class="btn btn-danger" [disabled]="saving()" (click)="remove()">
          Eliminar
        </button>
      </div>
    </app-modal>
  `,
})
export class TemplatesPage {
  private readonly api = inject(ClinicalTemplatesService);
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  protected readonly kinds: TemplateKind[] = ['CONSULTATION', 'PRESCRIPTION'];
  protected readonly kindLabels = TEMPLATE_KIND_LABELS;
  protected readonly fields = CONSULTATION_FIELDS;
  protected readonly help = FIELD_HELP;
  protected readonly tabInfo = TAB_INFO;
  protected readonly searchFrom = SEARCH_FROM;
  protected readonly routes = ROUTE_OPTIONS;
  protected readonly frequencies = FREQUENCY_OPTIONS;
  protected readonly durations = DURATION_OPTIONS;
  protected readonly howto = [
    { n: 1, title: 'Créala', text: 'con lo que escribes siempre igual.' },
    {
      n: 2,
      title: 'Úsala',
      text: 'en la Atención con «Usar plantilla», o al recetar con «Recetas frecuentes».',
    },
    {
      n: 3,
      title: 'Completa:',
      text: 'lo de cada paciente. Si dejas ___ en la plantilla, la Atención te avisa qué falta.',
    },
  ];

  protected readonly tab = signal<TemplateKind>('CONSULTATION');
  protected readonly templates = signal<ClinicalTemplate[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editing = signal<{ id: number | null; kind: TemplateKind } | null>(null);
  protected readonly deleting = signal<ClinicalTemplate | null>(null);
  protected readonly confirmDiscard = signal(false);
  protected readonly emptyConsultation = signal(false);
  protected readonly howtoHidden = signal(readHowtoHidden());

  protected readonly filter = new FormControl('', { nonNullable: true });
  private readonly filterText = toSignal(this.filter.valueChanges, { initialValue: '' });
  protected readonly visible = computed(() => {
    const q = normalize(this.filterText().trim());
    return this.templates().filter(
      (t) => t.kind === this.tab() && (!q || normalize(searchable(t)).includes(q)),
    );
  });

  /** Cuántas tarjetas se ven (de a 12); al buscar o cambiar de pestaña vuelve a 12 */
  protected readonly limit = signal(PAGE);
  protected readonly shown = computed(() =>
    this.filterText().trim() ? this.visible() : this.visible().slice(0, this.limit()),
  );
  protected readonly nextBatch = computed(() =>
    Math.min(PAGE, this.visible().length - this.shown().length),
  );

  protected showMore(): void {
    const from = this.shown().length;
    this.limit.update((n) => n + PAGE);
    // El foco pasa a la primera tarjeta nueva (teclado y lector de pantalla siguen el hilo)
    const next = this.visible()[from];
    if (next)
      setTimeout(() =>
        this.document.querySelector<HTMLButtonElement>(`[data-tpl-id="${next.id}"]`)?.focus(),
      );
  }

  protected readonly name = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
  });
  protected readonly consultation = new FormGroup({
    reason: text(200),
    anamnesis: text(5000),
    physicalExam: text(5000),
    diagnosis: text(300),
    plan: text(5000),
  });
  protected readonly rx = new FormArray<RxRow>([]);
  protected readonly rxNotes = text(1000);

  /** Fila de receta que está buscando en el inventario */
  protected readonly activeRow = signal<number | null>(null);
  private readonly query = new Subject<string>();
  protected readonly options = toSignal(
    this.query.pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<DrugOption[]>([])
          : this.inventory.list({ q }).pipe(
              map((page) =>
                page.items
                  .filter((p) => p.active)
                  .flatMap((p) =>
                    p.presentations
                      .filter((pr) => pr.active && pr.price !== null)
                      .map<DrugOption>((pr) => ({
                        key: `p${pr.id}`,
                        productId: p.id,
                        presentationId: pr.id,
                        drug: p.name,
                        presentation: pr.name,
                        stock: `stock ${formatQty(p.totalStock)} ${unitLabel(p.baseUnit, p.totalStock)}`,
                      })),
                  )
                  .slice(0, 6),
              ),
              catchError(() => of<DrugOption[]>([])),
            ),
      ),
    ),
    { initialValue: [] as DrugOption[] },
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (list) => {
        this.templates.set(list);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e, 'No se pudieron cargar las plantillas.'));
        this.loading.set(false);
      },
    });
  }

  protected selectTab(k: TemplateKind): void {
    this.tab.set(k);
    this.filter.setValue('');
    this.limit.set(PAGE);
  }

  protected count(kind: TemplateKind): number {
    return this.templates().filter((t) => t.kind === kind).length;
  }

  protected readonly soap = SOAP_LETTER;
  protected readonly blankCount = templateBlankCount;
  protected readonly dosage = rxDosage;
  protected readonly short = fieldName;

  /** Eliminar se pide desde la plantilla abierta (no está a la vista en cada tarjeta) */
  protected askDelete(): void {
    const id = this.editing()?.id;
    const t = this.templates().find((x) => x.id === id);
    if (!t) return;
    this.confirmDiscard.set(false);
    this.editing.set(null);
    this.deleting.set(t);
  }

  /** Duplicar: misma plantilla como nueva, para ajustarla (ej. la versión para gato) */
  protected duplicate(): void {
    const e = this.editing();
    if (!e?.id) return;
    this.editing.set({ id: null, kind: e.kind });
    this.name.setValue(`${this.name.value.trim()} (copia)`.slice(0, 80));
    this.name.markAsDirty();
    this.toast.info('Copia lista: cambia el nombre y lo que haga falta, y guarda.');
    this.focus('tpl-name');
  }

  protected bad(c: { invalid: boolean; touched: boolean }): boolean {
    return c.invalid && c.touched;
  }

  protected hideHowto(): void {
    this.howtoHidden.set(true);
    try {
      localStorage.setItem(HOWTO_KEY, '1');
    } catch {
      // Sin almacenamiento: vuelve a mostrarse la próxima vez, no pasa nada
    }
  }

  protected askNew(): void {
    this.resetEditor();
    if (this.tab() === 'PRESCRIPTION') this.addRow();
    this.editing.set({ id: null, kind: this.tab() });
  }

  protected askEdit(t: ClinicalTemplate): void {
    this.resetEditor();
    this.name.reset(t.name);
    this.consultation.reset({
      reason: t.consultation?.reason ?? '',
      anamnesis: t.consultation?.anamnesis ?? '',
      physicalExam: t.consultation?.physicalExam ?? '',
      diagnosis: t.consultation?.diagnosis ?? '',
      plan: t.consultation?.plan ?? '',
    });
    for (const item of t.prescription?.items ?? []) this.addRow(item);
    this.rxNotes.reset(t.prescription?.notes ?? '');
    this.editing.set({ id: t.id, kind: t.kind });
    this.checkLinkedProducts();
  }

  protected addRow(item?: TemplateRxItem): void {
    const linked = !!item?.productId && !!item.presentationId;
    this.rx.push(
      new FormGroup({
        productId: new FormControl<number | null>(linked ? item!.productId! : null),
        presentationId: new FormControl<number | null>(linked ? item!.presentationId! : null),
        presentation: new FormControl('', { nonNullable: true }),
        missing: new FormControl(false, { nonNullable: true }),
        dispense: new FormControl(linked && item?.dispenseQuantity != null, {
          nonNullable: true,
        }),
        dispenseQuantity: new FormControl<number | null>(item?.dispenseQuantity ?? 1, [
          Validators.min(0.01),
          Validators.max(9999),
        ]),
        drug: new FormControl(item?.drug ?? '', {
          nonNullable: true,
          validators: [Validators.required, Validators.minLength(2), Validators.maxLength(150)],
        }),
        dose: text(80, true),
        route: text(40),
        frequency: text(60, true),
        duration: text(60, true),
        instructions: text(300),
      }),
    );
    if (item)
      this.rx.at(-1).patchValue({
        dose: item.dose,
        route: item.route ?? '',
        frequency: item.frequency,
        duration: item.duration,
        instructions: item.instructions ?? '',
      });
  }

  protected removeRow(index: number): void {
    this.rx.removeAt(index);
    this.rx.markAsDirty();
    this.activeRow.set(null);
  }

  /** Escribir en el medicamento busca en el inventario; si estaba ligado, se desliga */
  protected onDrugInput(index: number): void {
    const g = this.rx.at(index);
    if (g.controls.productId.value)
      g.patchValue({ productId: null, presentationId: null, presentation: '', dispense: false });
    g.controls.missing.setValue(false);
    this.activeRow.set(index);
    this.query.next(g.controls.drug.value);
  }

  protected pick(index: number, o: DrugOption): void {
    const g = this.rx.at(index);
    g.patchValue({
      productId: o.productId,
      presentationId: o.presentationId,
      presentation: o.presentation,
      drug: o.drug,
      missing: false,
      dispense: true,
      dispenseQuantity: g.controls.dispenseQuantity.value ?? 1,
    });
    if (!g.controls.route.value) g.controls.route.setValue('Oral');
    g.markAsDirty();
    this.activeRow.set(null);
    this.focus(`rx-dose-${index}`);
  }

  /** Al salir del campo se cierra la lista (los clics en ella no quitan el foco) */
  protected closeOptions(index: number): void {
    if (this.activeRow() === index) this.activeRow.set(null);
  }

  protected focusDrug(): void {
    this.focus(`rx-drug-${this.rx.length - 1}`);
  }

  protected closeEditor(): void {
    if (this.saving()) return;
    if (this.isDirty() && !this.confirmDiscard()) {
      this.confirmDiscard.set(true);
      return;
    }
    this.discard();
  }

  protected discard(): void {
    this.confirmDiscard.set(false);
    this.editing.set(null);
  }

  protected save(): void {
    const editing = this.editing();
    if (!editing || this.saving()) return;
    const consultation = this.consultation.getRawValue();
    const empty =
      editing.kind === 'CONSULTATION' && !Object.values(consultation).some((v) => v.trim());
    this.emptyConsultation.set(empty);
    const rowsInvalid = this.rx.controls.some(
      (g) =>
        g.controls.drug.invalid ||
        g.controls.dose.invalid ||
        g.controls.frequency.invalid ||
        g.controls.duration.invalid ||
        (g.controls.productId.value &&
          g.controls.dispense.value &&
          (g.controls.dispenseQuantity.invalid || !g.controls.dispenseQuantity.value)),
    );
    const invalid =
      this.name.invalid ||
      empty ||
      (editing.kind === 'CONSULTATION'
        ? this.consultation.invalid
        : rowsInvalid || !this.rx.length);
    if (invalid) {
      this.name.markAsTouched();
      this.consultation.markAllAsTouched();
      this.rx.markAllAsTouched();
      for (const g of this.rx.controls)
        if (g.controls.dispense.value && !g.controls.dispenseQuantity.value)
          g.controls.dispenseQuantity.setErrors({ required: true });
      if (editing.kind === 'PRESCRIPTION' && !this.rx.length)
        this.toast.error('Agrega al menos un medicamento.');
      this.focusFirstInvalid();
      return;
    }
    const input: TemplateInput =
      editing.kind === 'CONSULTATION'
        ? { kind: 'CONSULTATION', name: this.name.value.trim(), consultation }
        : {
            kind: 'PRESCRIPTION',
            name: this.name.value.trim(),
            prescription: {
              notes: this.rxNotes.value.trim() || null,
              items: this.rx.getRawValue().map((i) => {
                const linked = !!i.productId && !!i.presentationId;
                return {
                  productId: linked ? i.productId : null,
                  presentationId: linked ? i.presentationId : null,
                  // Sin cantidad, la receta usa el producto pero no lo entrega ni lo cobra
                  dispenseQuantity: linked && i.dispense ? Number(i.dispenseQuantity) : null,
                  drug: i.drug.trim(),
                  dose: i.dose.trim(),
                  route: i.route.trim() || null,
                  frequency: i.frequency.trim(),
                  duration: i.duration.trim(),
                  instructions: i.instructions.trim() || null,
                };
              }),
            },
          };
    this.saving.set(true);
    const request = editing.id
      ? this.api.update(editing.id, {
          name: input.name,
          consultation: input.consultation,
          prescription: input.prescription,
        })
      : this.api.create(input);
    request.subscribe({
      next: (t) => {
        this.saving.set(false);
        this.editing.set(null);
        this.templates.update((list) =>
          editing.id ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t],
        );
        this.toast.success(`Plantilla «${t.name}» guardada.`);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(e));
      },
    });
  }

  protected remove(): void {
    const t = this.deleting();
    if (!t || this.saving()) return;
    this.saving.set(true);
    this.api.remove(t.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.deleting.set(null);
        this.templates.update((list) => list.filter((x) => x.id !== t.id));
        this.toast.info(`Plantilla «${t.name}» eliminada.`);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(e));
      },
    });
  }

  private resetEditor(): void {
    this.name.reset('');
    this.consultation.reset();
    this.rx.clear();
    this.rx.markAsPristine();
    this.rxNotes.reset('');
    this.confirmDiscard.set(false);
    this.emptyConsultation.set(false);
    this.activeRow.set(null);
  }

  private isDirty(): boolean {
    return this.name.dirty || this.consultation.dirty || this.rx.dirty || this.rxNotes.dirty;
  }

  /** Al editar: muestra la presentación de lo ligado y avisa si ya no está en el inventario */
  private checkLinkedProducts(): void {
    for (const g of this.rx.controls) {
      const productId = g.controls.productId.value;
      if (!productId) continue;
      this.inventory.get(productId).subscribe({
        next: (p) => {
          const pr = p.presentations.find(
            (x) => x.id === g.controls.presentationId.value && x.active && x.price !== null,
          );
          if (p.active && pr) g.controls.presentation.setValue(pr.name);
          else this.markMissing(g);
        },
        error: () => this.markMissing(g),
      });
    }
  }

  private markMissing(g: RxRow): void {
    g.patchValue({ productId: null, presentationId: null, dispense: false, missing: true });
  }

  private focus(id: string): void {
    setTimeout(() => (this.document.getElementById(id) as HTMLElement | null)?.focus());
  }

  private focusFirstInvalid(): void {
    setTimeout(() =>
      this.document
        .querySelector<HTMLElement>('#tpl-form [aria-invalid="true"], #tpl-form .field-error')
        ?.scrollIntoView({ block: 'center' }),
    );
    setTimeout(() =>
      this.document.querySelector<HTMLElement>('#tpl-form [aria-invalid="true"]')?.focus(),
    );
  }
}

function readHowtoHidden(): boolean {
  try {
    return localStorage.getItem(HOWTO_KEY) === '1';
  } catch {
    return false;
  }
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Texto donde busca el filtro: nombre y contenido */
function searchable(t: ClinicalTemplate): string {
  const c = t.consultation ?? {};
  const items = t.prescription?.items.map((i) => i.drug).join(' ') ?? '';
  return [t.name, c.reason, c.diagnosis, c.plan, items].filter(Boolean).join(' ');
}
