import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import {
  ClientSummary,
  DOCUMENT_SHORT,
  PetBadge,
  SEX_LABELS,
  SPECIES_LABELS,
  Species,
} from '../../../core/services/clients.models';
import { ClientsService } from '../../../core/services/clients.service';
import { formatPhone } from '../../utils/peru';
import { petAge } from '../../utils/pet-age';
import { petCode, SPECIES_ICONS } from '../../utils/records';
import { IconComponent } from '../icon/icon.component';
import { MarkTextComponent } from '../mark-text/mark-text.component';

export interface PickedPet {
  petId: number;
  petName: string;
  clientName: string;
  /** Lo que se mostró al elegirla (si se eligió en el buscador; una mascota ya conocida no lo trae) */
  detail?: {
    species: Species;
    number: number;
    line: string;
    phone: string;
    aggressive: boolean;
    aggressiveNote: string | null;
    hasAllergies: boolean;
  };
}

/** La mascota elegida, con sus datos y avisos, y "Cambiar" */
@Component({
  selector: 'app-picked-pet',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = pet();
    <div class="rounded-xl bg-anil-50/70 p-3 ring-1 ring-anil-200">
      <div class="flex items-center gap-3">
        <span
          class="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-anil-700 ring-1 ring-anil-100"
          aria-hidden="true"
        >
          <app-icon [name]="p.detail ? icons[p.detail.species] : 'paw'" class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-medium text-slate-900">{{ p.petName }}</span>
            @if (p.detail) {
              <span class="text-xs text-slate-500 tabular-nums">{{ hc(p.detail.number) }}</span>
            }
          </p>
          @if (p.detail?.line; as line) {
            <p class="text-sm text-slate-600">{{ line }}</p>
          }
          <p class="truncate text-sm text-slate-500">
            {{ p.clientName }}
            @if (p.detail) {
              · {{ phone(p.detail.phone) }}
            }
          </p>
        </div>
        <button type="button" class="btn btn-ghost h-10 shrink-0 px-3" (click)="change.emit()">
          Cambiar
        </button>
      </div>
      @if (p.detail?.aggressive || p.detail?.hasAllergies) {
        <ul class="mt-2.5 space-y-1.5" aria-label="Avisos de la mascota">
          @if (p.detail?.aggressive) {
            <li
              class="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200"
            >
              <app-icon name="alert" class="mt-0.5 size-4 shrink-0 text-rose-600" />
              <span
                ><strong class="font-semibold">Agresivo.</strong>
                {{ p.detail?.aggressiveNote || 'Manipúlalo con cuidado.' }}</span
              >
            </li>
          }
          @if (p.detail?.hasAllergies) {
            <li
              class="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"
            >
              <app-icon name="alert" class="mt-0.5 size-4 shrink-0 text-amber-700" />
              <span
                ><strong class="font-semibold">Tiene alergias.</strong> El veterinario las ve en su
                historia.</span
              >
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class PickedPetComponent {
  readonly pet = input.required<PickedPet>();
  readonly change = output<void>();
  protected readonly icons = SPECIES_ICONS;
  protected readonly hc = petCode;
  protected readonly phone = formatPhone;
}

type Search =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: ClientSummary[]; total: number };

const SHOWN_CLIENTS = 5;

/**
 * Busca un cliente y elige una de sus mascotas activas (citas, grooming, presupuestos…). Igual que
 * "Agregar a la cola": cada dueño con su DNI y celular, y sus mascotas con especie, sexo, edad,
 * raza y los avisos de agresivo y alergias; lo buscado en negrita.
 */
@Component({
  selector: 'app-pet-picker',
  imports: [ReactiveFormsModule, IconComponent, MarkTextComponent, PickedPetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selected(); as sel) {
      <app-picked-pet [pet]="sel" (change)="clear()" />
    } @else {
      <div class="relative">
        <label [for]="inputId()" class="sr-only">Buscar paciente</label>
        <app-icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-slate-400"
        />
        <input
          [id]="inputId()"
          type="search"
          [formControl]="search"
          class="field-input mt-0 pl-10"
          autocomplete="off"
          placeholder="Dueño, DNI, celular o mascota"
          [attr.aria-invalid]="invalid()"
          (keydown.enter)="pickOnlyChoice($event)"
        />
      </div>
      <div class="mt-2" aria-live="polite">
        @switch (results().kind) {
          @case ('loading') {
            <p class="py-2 text-sm text-slate-500">Buscando…</p>
          }
          @case ('error') {
            <p class="py-2 text-sm text-rose-700">No se pudo buscar.</p>
          }
          @case ('ready') {
            @let found = results();
            @if (found.kind === 'ready' && found.items.length) {
              @let q = search.value;
              <ul class="max-h-72 space-y-2 overflow-y-auto">
                @for (client of found.items; track client.id) {
                  <li class="rounded-xl ring-1 ring-slate-200">
                    <div class="px-3 pt-2.5">
                      <p class="text-sm font-medium text-slate-900">
                        <app-mark-text [text]="client.name" [query]="q" />
                      </p>
                      <p
                        class="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-slate-500 tabular-nums"
                      >
                        @if (client.docType && client.docNumber) {
                          <span
                            >{{ docShort[client.docType] }}
                            <app-mark-text [text]="client.docNumber" [query]="q"
                          /></span>
                          <span aria-hidden="true">·</span>
                        }
                        <app-mark-text [text]="phone(client.phone)" [query]="q" />
                      </p>
                    </div>
                    <div class="flex flex-wrap gap-2 p-2.5">
                      @for (pet of activePets(client); track pet.id) {
                        <button
                          type="button"
                          class="inline-flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-800 ring-1 ring-slate-300 transition-colors duration-150 hover:bg-anil-50 hover:ring-anil-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anil-600"
                          [attr.aria-label]="
                            pet.name +
                            ', ' +
                            petLine(pet) +
                            (pet.aggressive ? ', agresivo' : '') +
                            (pet.hasAllergies ? ', tiene alergias' : '')
                          "
                          (click)="pick(client, pet)"
                        >
                          <app-icon [name]="icons[pet.species]" class="size-4 shrink-0" />
                          <span class="min-w-0">
                            <span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span class="font-medium">
                                <app-mark-text [text]="pet.name" [query]="q" />
                              </span>
                              @if (pet.aggressive) {
                                <span
                                  class="rounded bg-rose-50 px-1 text-[11px] font-medium text-rose-800 ring-1 ring-rose-200"
                                  aria-hidden="true"
                                  >Agresivo</span
                                >
                              }
                              @if (pet.hasAllergies) {
                                <span
                                  class="rounded bg-amber-50 px-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200"
                                  aria-hidden="true"
                                  >Alergias</span
                                >
                              }
                            </span>
                            <span class="block text-xs font-normal text-slate-500">{{
                              petLine(pet)
                            }}</span>
                          </span>
                        </button>
                      } @empty {
                        <p class="px-0.5 text-sm text-slate-500">Sin mascotas activas</p>
                      }
                    </div>
                  </li>
                }
              </ul>
              @if (found.total > found.items.length) {
                <p class="mt-2 text-center text-xs text-slate-500">
                  Hay {{ found.total - found.items.length }} clientes más: escribe más letras o el
                  DNI.
                </p>
              }
            } @else {
              <p class="py-2 text-sm text-slate-600">No encontramos a «{{ search.value }}».</p>
            }
          }
        }
      </div>
    }
  `,
})
export class PetPickerComponent {
  private readonly clients = inject(ClientsService);
  readonly inputId = input('pet-picker');
  readonly invalid = input(false);
  readonly picked = output<PickedPet | null>();

  protected readonly icons = SPECIES_ICONS;
  protected readonly docShort = DOCUMENT_SHORT;
  protected readonly phone = formatPhone;
  protected readonly hc = petCode;
  protected readonly selected = signal<PickedPet | null>(null);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly results = toSignal(
    this.search.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<Search>({ kind: 'idle' })
          : this.clients.list({ q }).pipe(
              map((page): Search => ({
                kind: 'ready',
                items: page.items.slice(0, SHOWN_CLIENTS),
                total: page.total,
              })),
              catchError(() => of<Search>({ kind: 'error' })),
              startWith<Search>({ kind: 'loading' }),
            ),
      ),
    ),
    { initialValue: { kind: 'idle' } as Search },
  );

  /** Las mascotas que se pueden elegir de todos los resultados */
  private readonly choices = computed(() => {
    const found = this.results();
    if (found.kind !== 'ready') return [];
    return found.items.flatMap((client) => this.activePets(client).map((pet) => ({ client, pet })));
  });

  protected activePets(client: ClientSummary): PetBadge[] {
    return client.pets.filter((p) => p.active);
  }

  /** "Perro · Hembra · 2 años · Shih tzu" (lo que haya) */
  protected petLine(pet: PetBadge): string {
    return [
      SPECIES_LABELS[pet.species],
      pet.sex ? SEX_LABELS[pet.sex] : null,
      petAge(pet.birthDate ?? null),
      pet.breed,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** Enter: si hay una sola mascota posible, se elige (no envía el formulario) */
  protected pickOnlyChoice(event: Event): void {
    event.preventDefault();
    const choices = this.choices();
    if (choices.length === 1) this.pick(choices[0].client, choices[0].pet);
  }

  protected pick(client: ClientSummary, pet: PetBadge): void {
    const value: PickedPet = {
      petId: pet.id,
      petName: pet.name,
      clientName: client.name,
      detail: {
        species: pet.species,
        number: pet.number,
        line: this.petLine(pet),
        phone: client.phone,
        aggressive: pet.aggressive,
        aggressiveNote: pet.aggressiveNote ?? null,
        hasAllergies: pet.hasAllergies,
      },
    };
    this.selected.set(value);
    this.picked.emit(value);
  }

  clear(): void {
    this.selected.set(null);
    this.search.setValue('');
    this.picked.emit(null);
  }
}
