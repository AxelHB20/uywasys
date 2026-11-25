import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  CONSULTATION_FIELDS,
  ClinicalTemplate,
  ClinicalTemplatesService,
  TemplateKind,
  templateSummary,
} from '../../core/services/clinical-templates.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { apiErrorMessage } from '../../shared/utils/validators';

export type ApplyMode = 'fill' | 'replace';

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
  imports: [ModalComponent, IconComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [title]="kind() === 'CONSULTATION' ? 'Usar plantilla de consulta' : 'Recetas frecuentes'"
      description="Las más usadas aparecen primero. Revisa y ajusta antes de guardar."
      (closed)="closed.emit()"
    >
      <div class="space-y-4">
        <div class="relative">
          <label for="tp-search" class="sr-only">Buscar plantilla</label>
          <app-icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
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
            <app-icon name="book-open" class="mx-auto size-7 text-slate-400" />
            <p class="mt-3 font-medium text-slate-900">Aún no hay plantillas</p>
            <p class="mt-1 text-sm text-slate-600">
              Escribe una consulta y usa «Guardar como plantilla», o créalas en
              <a routerLink="/plantillas" class="font-medium text-anil-700 hover:underline"
                >Plantillas clínicas</a
              >.
            </p>
          </div>
        } @else {
          <ul class="space-y-2" role="listbox" aria-label="Plantillas">
            @for (t of filtered(); track t.id) {
              <li role="option" [attr.aria-selected]="selected()?.id === t.id">
                <button
                  type="button"
                  class="w-full rounded-xl px-4 py-3 text-left ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anil-500"
                  [class]="
                    selected()?.id === t.id
                      ? 'bg-anil-50 ring-anil-300'
                      : 'bg-white ring-slate-200 hover:bg-slate-50'
                  "
                  (click)="selected.set(t)"
                >
                  <span class="flex items-center justify-between gap-3">
                    <span class="font-medium text-slate-900">{{ t.name }}</span>
                    @if (t.usageCount) {
                      <span class="shrink-0 text-xs text-slate-500 tabular-nums"
                        >{{ t.usageCount }} {{ t.usageCount === 1 ? 'uso' : 'usos' }}</span
                      >
                    }
                  </span>
                  <span class="mt-0.5 block truncate text-sm text-slate-600">{{ summary(t) }}</span>
                </button>
                @if (selected()?.id === t.id) {
                  <div class="mt-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      Vista previa
                    </p>
                    @if (t.consultation; as c) {
                      <dl class="mt-2 space-y-2 text-sm">
                        @for (f of fields; track f.key) {
                          @if (c[f.key]) {
                            <div>
                              <dt class="font-medium text-slate-800">{{ f.label }}</dt>
                              <dd class="whitespace-pre-line text-slate-700">{{ c[f.key] }}</dd>
                            </div>
                          }
                        }
                      </dl>
                    }
                    @if (t.prescription; as p) {
                      <ol class="mt-2 space-y-1.5 text-sm">
                        @for (i of p.items; track $index) {
                          <li>
                            <span class="font-medium text-slate-900">{{ i.drug }}</span>
                            <span class="text-slate-700">
                              · {{ i.dose }}{{ i.route ? ' · ' + i.route : '' }} ·
                              {{ i.frequency }} · {{ i.duration }}</span
                            >
                          </li>
                        }
                      </ol>
                    }
                  </div>

                  @if (kind() === 'CONSULTATION') {
                    <fieldset>
                      <legend class="field-label">Si ya escribiste algo</legend>
                      <div class="mt-2 grid gap-2 sm:grid-cols-2">
                        @for (m of modes; track m.value) {
                          <label
                            class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-3.5 py-2.5 ring-1 has-checked:bg-anil-50 has-checked:ring-anil-300"
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
                }
              </li>
            } @empty {
              <li class="px-1 py-4 text-sm text-slate-600">Ninguna coincide con la búsqueda.</li>
            }
          </ul>
        }
      </div>
      <div modal-actions class="contents">
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="!selected()" (click)="apply()">
          <app-icon name="check" class="size-4" /> Aplicar
        </button>
      </div>
    </app-modal>
  `,
})
export class TemplatePickerComponent {
  private readonly api = inject(ClinicalTemplatesService);

  readonly open = input(false);
  readonly kind = input.required<TemplateKind>();
  readonly picked = output<{ template: ClinicalTemplate; mode: ApplyMode }>();
  readonly closed = output<void>();

  protected readonly fields = CONSULTATION_FIELDS;
  protected readonly summary = templateSummary;
  protected readonly modes: { value: ApplyMode; label: string; hint: string }[] = [
    { value: 'fill', label: 'Completar lo vacío', hint: 'No toca lo que ya escribiste' },
    { value: 'replace', label: 'Reemplazar', hint: 'Usa el texto de la plantilla' },
  ];
  protected readonly templates = signal<ClinicalTemplate[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<ClinicalTemplate | null>(null);
  protected readonly mode = signal<ApplyMode>('fill');
  protected readonly search = new FormControl('', { nonNullable: true });
  private readonly term = toSignal(this.search.valueChanges, { initialValue: '' });

  protected readonly filtered = computed(() => {
    const q = normalize(this.term().trim());
    if (!q) return this.templates();
    return this.templates().filter((t) => normalize(`${t.name} ${templateSummary(t)}`).includes(q));
  });

  constructor() {
    // Se carga cada vez que se abre: alguien pudo crear una nueva
    effect(() => {
      if (!this.open()) return;
      this.selected.set(null);
      this.mode.set('fill');
      this.search.setValue('');
      this.loading.set(true);
      this.error.set(null);
      this.api.list(this.kind()).subscribe({
        next: (list) => {
          this.templates.set(list);
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
    this.picked.emit({ template, mode: this.mode() });
  }
}
