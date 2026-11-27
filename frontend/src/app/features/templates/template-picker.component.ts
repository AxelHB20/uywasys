import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  CONSULTATION_FIELDS,
  ClinicalTemplate,
  ClinicalTemplatesService,
  ConsultationContent,
  SOAP_LETTER,
  TemplateKind,
  fieldName,
  rxDosage,
  templateBlankCount,
} from '../../core/services/clinical-templates.service';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { TemplateTextComponent } from './template-text.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { apiErrorMessage } from '../../shared/utils/validators';

export type ApplyMode = 'fill' | 'replace';

/** Se busca por nombre y por todo lo que escribe la plantilla */
const searchText = (t: ClinicalTemplate): string => {
  const c = t.consultation;
  const p = t.prescription;
  return [
    t.name,
    c?.reason,
    c?.anamnesis,
    c?.physicalExam,
    c?.diagnosis,
    c?.plan,
    ...(p?.items.map((i) => i.drug) ?? []),
  ]
    .filter(Boolean)
    .join(' ');
};

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Elegir una plantilla: búsqueda, vista previa y si completa solo lo vacío o reemplaza lo escrito.
 * Las más usadas aparecen primero.
 */
@Component({
  selector: 'app-template-picker',
  imports: [
    ModalComponent,
    IconComponent,
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    TemplateTextComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      size="lg"
      [open]="open()"
      [title]="kind() === 'CONSULTATION' ? 'Usar plantilla de consulta' : 'Recetas frecuentes'"
      [description]="
        kind() === 'CONSULTATION'
          ? 'Elige una y mira lo que escribe. Después completas lo del paciente.'
          : 'Elige una y mira los medicamentos. Se agregan a la receta y ajustas la dosis al peso.'
      "
      (closed)="closed.emit()"
    >
      @if (loading()) {
        <ul class="space-y-2" aria-busy="true" aria-label="Cargando plantillas">
          @for (i of [1, 2, 3]; track i) {
            <li class="h-16 animate-pulse rounded-xl bg-slate-100"></li>
          }
        </ul>
      } @else if (error(); as e) {
        <p class="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{{ e }}</p>
      } @else if (!templates().length) {
        <div class="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center">
          <app-icon name="book-open" class="mx-auto size-7 text-slate-500" />
          <p class="mt-3 font-medium text-slate-900">Aún no hay plantillas</p>
          <p class="mt-1 text-sm text-slate-600">
            {{
              kind() === 'CONSULTATION'
                ? 'Escribe una consulta y usa «Guardar como plantilla», o créalas en'
                : 'Arma una receta y usa «Guardar como frecuente», o créalas en'
            }}
            <a routerLink="/plantillas" class="font-medium text-anil-700 hover:underline"
              >Plantillas clínicas</a
            >.
          </p>
        </div>
      } @else {
        <!-- PC y tablet acostada: lista a la izquierda y vista previa a la derecha.
             Celular y tablet parada: primero la lista; al tocar una, su vista previa -->
        <div class="grid gap-5 lg:h-[min(58dvh,34rem)] lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div class="flex min-h-0 flex-col gap-3" [class.max-lg:hidden]="showDetail()">
            <!-- En celular la búsqueda queda fija arriba mientras se baja por la lista -->
            <div
              class="space-y-1.5 max-lg:sticky max-lg:-top-5 max-lg:z-10 max-lg:-mx-1 max-lg:-mt-5 max-lg:bg-white max-lg:px-1 max-lg:pt-5 max-lg:pb-1"
            >
              <div class="relative">
                <label for="tp-search" class="sr-only">Buscar plantilla</label>
                <app-icon
                  name="search"
                  class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-500"
                />
                <input
                  id="tp-search"
                  type="search"
                  [formControl]="search"
                  class="field-input mt-0 pl-10"
                  placeholder="Buscar por nombre o contenido"
                  autocomplete="off"
                />
              </div>
              <p class="px-1 text-xs text-slate-600" aria-live="polite">
                @if (term().trim()) {
                  {{ filtered().length }} de {{ templates().length }}
                  {{ templates().length === 1 ? 'plantilla' : 'plantillas' }}
                } @else {
                  {{ templates().length }}
                  {{ templates().length === 1 ? 'plantilla' : 'plantillas' }} · las más usadas
                  primero
                }
              </p>
            </div>
            <ul
              class="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-0.5 lg:-mr-2 lg:pr-2"
              aria-label="Plantillas"
              (keydown)="moveWithArrows($event)"
            >
              @for (t of filtered(); track t.id) {
                <li>
                  <button
                    type="button"
                    [id]="'tp-item-' + t.id"
                    [attr.aria-pressed]="selected()?.id === t.id"
                    class="w-full rounded-xl px-3.5 py-2.5 text-left ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anil-500"
                    [class]="
                      selected()?.id === t.id
                        ? 'bg-anil-50 ring-anil-300'
                        : 'bg-white ring-slate-200 hover:bg-slate-50'
                    "
                    (click)="choose(t)"
                    (dblclick)="apply()"
                  >
                    <span class="flex items-start justify-between gap-3">
                      <span
                        class="font-medium"
                        [class]="selected()?.id === t.id ? 'text-anil-800' : 'text-slate-900'"
                        >{{ t.name }}</span
                      >
                      @if (t.usageCount) {
                        <span class="mt-0.5 shrink-0 text-xs text-slate-600 tabular-nums"
                          >{{ t.usageCount }} {{ t.usageCount === 1 ? 'uso' : 'usos' }}</span
                        >
                      }
                    </span>
                    <span class="mt-0.5 block truncate text-sm text-slate-600">{{
                      subtitle(t)
                    }}</span>
                  </button>
                </li>
              } @empty {
                <li class="px-1 py-4 text-sm text-slate-600">Ninguna coincide con la búsqueda.</li>
              }
            </ul>
          </div>

          <section
            class="flex min-h-0 flex-col"
            [class.max-lg:hidden]="!showDetail()"
            aria-labelledby="tp-preview-title"
          >
            @if (selected(); as t) {
              <button
                #back
                type="button"
                class="btn btn-ghost -ml-2 mb-2 h-10 self-start px-2 lg:hidden"
                (click)="backToList()"
              >
                <app-icon name="chevron-left" class="size-4" /> Todas las plantillas
              </button>

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
                  <h3
                    id="tp-preview-title"
                    class="font-display text-lg leading-snug font-semibold text-slate-900"
                  >
                    {{ t.name }}
                  </h3>
                  <p
                    class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
                  >
                    <span class="tabular-nums"
                      >{{ t.usageCount }} {{ t.usageCount === 1 ? 'uso' : 'usos' }}</span
                    >
                    @if (blanks(t); as n) {
                      <span aria-hidden="true">·</span>
                      <app-badge tone="warning"
                        >{{ n }} {{ n === 1 ? 'dato' : 'datos' }} por llenar</app-badge
                      >
                    }
                    @if (t.prescription; as p) {
                      <span aria-hidden="true">·</span>
                      <span
                        >{{ p.items.length }}
                        {{ p.items.length === 1 ? 'medicamento' : 'medicamentos' }}</span
                      >
                    }
                  </p>
                </div>
              </div>

              <!-- Solo se pregunta si la plantilla pisa algo que ya escribiste -->
              @if (kind() === 'CONSULTATION' && conflicts().length) {
                <fieldset class="mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                  <legend class="sr-only">Qué hacer con lo que ya escribiste</legend>
                  <p class="flex gap-2 text-sm text-amber-950">
                    <app-icon name="alert" class="mt-0.5 size-4 shrink-0 text-amber-700" />
                    <span>
                      Ya escribiste en <strong class="font-semibold">{{ conflictNames() }}</strong
                      >. ¿Qué hacemos con
                      {{ conflicts().length === 1 ? 'ese campo' : 'esos campos' }}?
                    </span>
                  </p>
                  <div class="mt-3 grid gap-2 sm:grid-cols-2">
                    @for (m of modes; track m.value) {
                      <label
                        class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-white px-3.5 py-2.5 ring-1 has-checked:bg-anil-50 has-checked:ring-anil-300"
                        [class.ring-slate-200]="mode() !== m.value"
                      >
                        <input
                          type="radio"
                          name="tp-mode"
                          class="mt-1 accent-anil-600"
                          [checked]="mode() === m.value"
                          (change)="mode.set(m.value)"
                        />
                        <span class="text-sm">
                          <span class="block font-medium text-slate-900">{{ m.label }}</span>
                          <span class="block text-slate-600">{{ m.hint }}</span>
                        </span>
                      </label>
                    }
                  </div>
                </fieldset>
              }

              <div
                class="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 focus-visible:ring-2 focus-visible:ring-anil-500 focus-visible:outline-none"
                tabindex="0"
                aria-label="Contenido de la plantilla"
              >
                @if (t.consultation; as c) {
                  <dl class="space-y-3 text-sm">
                    @for (f of fields; track f.key) {
                      @if (c[f.key]) {
                        <div
                          class="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 max-sm:grid-cols-1 max-sm:gap-1"
                        >
                          <dt class="flex items-center gap-2 self-start font-medium text-slate-700">
                            @if (soap[f.key]; as l) {
                              <span class="soap-letter shrink-0" aria-hidden="true">{{ l }}</span>
                            } @else {
                              <span class="size-6 shrink-0 max-sm:hidden" aria-hidden="true"></span>
                            }
                            {{ name(f.label) }}
                          </dt>
                          <dd class="whitespace-pre-line text-slate-800">
                            <app-template-text [text]="c[f.key]!" />
                          </dd>
                        </div>
                      }
                    }
                  </dl>
                } @else if (t.prescription; as p) {
                  <ul
                    class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200"
                  >
                    @for (i of p.items; track $index) {
                      <li class="px-3.5 py-2.5 text-sm">
                        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <span class="font-medium text-slate-900">{{ i.drug }}</span>
                          @if (i.productId) {
                            <app-badge tone="success">Del inventario</app-badge>
                          } @else {
                            <app-badge tone="neutral">Externa</app-badge>
                          }
                        </div>
                        <p class="mt-0.5 text-slate-600">{{ dosage(i) }}</p>
                        @if (i.instructions) {
                          <p class="mt-0.5 text-slate-600">{{ i.instructions }}</p>
                        }
                      </li>
                    }
                  </ul>
                  <p class="mt-3 flex gap-2 text-sm text-slate-700">
                    <app-icon name="info" class="mt-0.5 size-4 shrink-0 text-anil-700" />
                    La dosis es de referencia: ajústala al peso del paciente.
                  </p>
                }
              </div>
            } @else {
              <div
                class="grid flex-1 place-items-center rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600"
              >
                Elige una plantilla para ver lo que escribe.
              </div>
            }
          </section>
        </div>
      }
      <div modal-actions class="contents">
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancelar</button>
        <button
          type="button"
          class="btn btn-primary"
          [class.max-lg:hidden]="!showDetail()"
          [disabled]="!selected()"
          (click)="apply()"
        >
          <app-icon name="check" class="size-4" />
          {{ kind() === 'CONSULTATION' ? 'Usar plantilla' : 'Agregar a la receta' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class TemplatePickerComponent {
  private readonly api = inject(ClinicalTemplatesService);
  private readonly document = inject(DOCUMENT);

  readonly open = input(false);
  readonly kind = input.required<TemplateKind>();
  /** Lo que ya está escrito en la consulta (para avisar solo si la plantilla lo pisaría) */
  readonly current = input<Partial<Record<keyof ConsultationContent, string | null>>>({});
  readonly picked = output<{ template: ClinicalTemplate; mode: ApplyMode }>();
  readonly closed = output<void>();

  protected readonly fields = CONSULTATION_FIELDS;
  protected readonly soap = SOAP_LETTER;
  protected readonly blanks = templateBlankCount;
  protected readonly dosage = rxDosage;
  protected readonly name = fieldName;
  protected readonly modes: { value: ApplyMode; label: string; hint: string }[] = [
    { value: 'fill', label: 'Dejar lo mío', hint: 'La plantilla solo llena los campos vacíos' },
    {
      value: 'replace',
      label: 'Usar la plantilla',
      hint: 'Se borra lo que escribiste en esos campos',
    },
  ];
  protected readonly templates = signal<ClinicalTemplate[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<ClinicalTemplate | null>(null);
  protected readonly mode = signal<ApplyMode>('fill');
  /** Celular / tablet parada: se ve la vista previa en vez de la lista */
  protected readonly showDetail = signal(false);
  private readonly backButton = viewChild<ElementRef<HTMLButtonElement>>('back');
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly term = toSignal(this.search.valueChanges, { initialValue: '' });

  protected readonly filtered = computed(() => {
    const q = normalize(this.term().trim());
    if (!q) return this.templates();
    return this.templates().filter((t) => normalize(searchText(t)).includes(q));
  });

  /** Campos donde la plantilla trae texto y la consulta ya tiene algo escrito */
  protected readonly conflicts = computed(() => {
    const c = this.selected()?.consultation;
    if (!c) return [];
    const now = this.current();
    return this.fields.filter((f) => c[f.key]?.trim() && now[f.key]?.trim());
  });
  protected readonly conflictNames = computed(() => {
    const names = this.conflicts().map((f) => fieldName(f.label));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];
  });

  /** Segunda línea de cada plantilla en la lista */
  protected subtitle(t: ClinicalTemplate): string {
    if (t.prescription) return t.prescription.items.map((i) => i.drug).join(' · ');
    const c = t.consultation;
    return c?.diagnosis ? `Dx: ${c.diagnosis}` : (c?.reason ?? '');
  }

  protected choose(t: ClinicalTemplate): void {
    if (this.selected()?.id !== t.id) this.mode.set('fill');
    this.selected.set(t);
    // En pantallas chicas se pasa a la vista previa y el foco va a "Todas las plantillas"
    if (!this.wide()) {
      this.showDetail.set(true);
      setTimeout(() => this.backButton()?.nativeElement.focus());
    }
  }

  /** PC y tablet acostada: lista y vista previa lado a lado */
  private wide(): boolean {
    const view = this.document.defaultView;
    return typeof view?.matchMedia === 'function' && view.matchMedia('(min-width: 64rem)').matches;
  }

  protected backToList(): void {
    const id = this.selected()?.id;
    this.showDetail.set(false);
    setTimeout(() => this.document.getElementById(`tp-item-${id}`)?.focus());
  }

  /** Flechas arriba/abajo recorren la lista y van mostrando cada plantilla */
  protected moveWithArrows(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = this.filtered();
    if (!list.length) return;
    event.preventDefault();
    const at = list.findIndex((t) => t.id === this.selected()?.id);
    const next =
      list[Math.min(list.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    this.selected.set(next);
    this.mode.set('fill');
    this.document.getElementById(`tp-item-${next.id}`)?.focus();
  }

  constructor() {
    // Al buscar, la vista previa sigue a los resultados: nunca se aplica una que no se ve
    effect(() => {
      const list = this.filtered();
      const current = untracked(this.selected);
      if (current && list.some((t) => t.id === current.id)) return;
      untracked(() => {
        this.mode.set('fill');
        this.selected.set(this.wide() ? (list[0] ?? null) : null);
      });
    });
    // Se carga cada vez que se abre: alguien pudo crear una nueva
    effect(() => {
      if (!this.open()) return;
      this.selected.set(null);
      this.showDetail.set(false);
      this.mode.set('fill');
      this.search.setValue('');
      this.loading.set(true);
      this.error.set(null);
      this.api.list(this.kind()).subscribe({
        next: (list) => {
          this.templates.set(list);
          // La más usada queda a la vista (en PC se ve su vista previa al abrir)
          this.selected.set(this.wide() ? (list[0] ?? null) : null);
          this.loading.set(false);
        },
        error: (e: unknown) => {
          this.error.set(apiErrorMessage(e, 'No se pudieron cargar las plantillas.'));
          this.loading.set(false);
        },
      });
    });
  }

  protected apply(): void {
    const template = this.selected();
    if (!template) return;
    this.api.used(template.id).subscribe({ error: () => undefined });
    // Sin choque no hay nada que reemplazar: se completa lo vacío
    this.picked.emit({ template, mode: this.conflicts().length ? this.mode() : 'fill' });
  }
}
