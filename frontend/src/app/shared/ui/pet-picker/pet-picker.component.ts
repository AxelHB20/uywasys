import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
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
import { ClientSummary } from '../../../core/services/clients.models';
import { ClientsService } from '../../../core/services/clients.service';
import { SPECIES_ICONS } from '../../utils/records';
import { IconComponent } from '../icon/icon.component';

export interface PickedPet {
  petId: number;
  petName: string;
  clientName: string;
}

type Search =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: ClientSummary[] };

/** Busca un cliente y elige una de sus mascotas activas. */
@Component({
  selector: 'app-pet-picker',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selected(); as sel) {
      <div class="flex items-center gap-3 rounded-xl bg-anil-50 p-3 ring-1 ring-anil-200">
        <app-icon name="paw" class="size-5 shrink-0 text-anil-700" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-slate-900">{{ sel.petName }}</p>
          <p class="truncate text-sm text-slate-600">{{ sel.clientName }}</p>
        </div>
        <button type="button" class="btn btn-ghost h-10 px-3" (click)="clear()">Cambiar</button>
      </div>
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
          placeholder="Dueño, DNI o nombre de la mascota"
          [attr.aria-invalid]="invalid()"
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
              <ul class="max-h-56 space-y-2 overflow-y-auto">
                @for (client of found.items; track client.id) {
                  <li class="rounded-xl p-2 ring-1 ring-slate-200">
                    <p class="px-1 text-sm font-medium text-slate-900">{{ client.name }}</p>
                    <div class="mt-1 flex flex-wrap gap-2">
                      @for (pet of client.pets; track pet.id) {
                        @if (pet.active) {
                          <button
                            type="button"
                            class="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-anil-50 hover:ring-anil-400"
                            (click)="pick(client, pet.id, pet.name)"
                          >
                            <app-icon [name]="icons[pet.species]" class="size-4" /> {{ pet.name }}
                          </button>
                        }
                      }
                    </div>
                  </li>
                }
              </ul>
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
              map((page): Search => ({ kind: 'ready', items: page.items.slice(0, 5) })),
              catchError(() => of<Search>({ kind: 'error' })),
              startWith<Search>({ kind: 'loading' }),
            ),
      ),
    ),
    { initialValue: { kind: 'idle' } as Search },
  );

  protected pick(client: ClientSummary, petId: number, petName: string): void {
    const value = { petId, petName, clientName: client.name };
    this.selected.set(value);
    this.picked.emit(value);
  }

  clear(): void {
    this.selected.set(null);
    this.search.setValue('');
    this.picked.emit(null);
  }
}
