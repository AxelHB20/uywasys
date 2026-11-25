import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { CATEGORY_ICON, CATEGORY_TINT, ProductSummary } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/**
 * Buscador para agregar productos a la ficha: por nombre, código o código de barras.
 * Con flechas y Enter se elige sin soltar el teclado; el lector de código de barras escribe el
 * código y un Enter, y el producto entra directo.
 */
@Component({
  selector: 'app-product-search',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="relative">
      <label [for]="inputId()" class="sr-only">{{ label() }}</label>
      <app-icon
        [name]="loading() ? 'loader' : 'search'"
        class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-500"
        [class.animate-spin]="loading()"
      />
      <input
        #box
        [id]="inputId()"
        type="search"
        class="field-input mt-0 pl-10"
        [placeholder]="placeholder()"
        autocomplete="off"
        maxlength="60"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-controls]="inputId() + '-list'"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="open() && results().length ? optionId(active()) : null"
        [value]="query()"
        (input)="onInput($any($event.target).value)"
        (keydown)="onKey($event)"
        (blur)="closeSoon()"
        (focus)="query() && open.set(true)"
      />
      @if (open() && query().trim().length >= 2) {
        <ul
          [id]="inputId() + '-list'"
          role="listbox"
          [attr.aria-label]="label()"
          class="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200"
        >
          @for (p of results(); track p.id; let i = $index) {
            <li
              [id]="optionId(i)"
              role="option"
              [attr.aria-selected]="i === active()"
              class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
              [class.bg-anil-50]="i === active()"
              (mousedown)="$event.preventDefault()"
              (click)="pick(p)"
              (mouseenter)="active.set(i)"
            >
              <span
                class="grid size-8 shrink-0 place-items-center rounded-lg"
                [class]="tint[p.category]"
                aria-hidden="true"
                ><app-icon [name]="icon[p.category]" class="size-4"
              /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-slate-900">{{ p.name }}</span>
                <span class="block truncate text-xs text-slate-600">
                  {{ presentationsText(p) }}
                </span>
              </span>
              @if (p.code) {
                <span class="shrink-0 text-xs text-slate-500 tabular-nums">{{ p.code }}</span>
              }
            </li>
          } @empty {
            <li class="px-3 py-3 text-sm text-slate-600" role="presentation">
              @if (loading()) {
                Buscando…
              } @else {
                Ningún producto activo con «{{ query().trim() }}».
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class ProductSearchComponent {
  private readonly inventory = inject(InventoryService);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  readonly inputId = input('product-search');
  readonly label = input('Buscar producto');
  readonly placeholder = input('Producto, código o código de barras');
  readonly picked = output<ProductSummary>();

  protected readonly icon = CATEGORY_ICON;
  protected readonly tint = CATEGORY_TINT;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly loading = signal(false);
  protected readonly results = signal<ProductSummary[]>([]);
  /** El Enter llegó antes que la respuesta (lector de código de barras): se elige al llegar */
  private pendingEnter = false;

  private readonly term = computed(() => this.query().trim());

  constructor() {
    toObservable(this.term)
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap((q) => this.loading.set(q.length >= 2)),
        switchMap((q) =>
          q.length < 2
            ? of([])
            : this.inventory.list({ q, status: 'active' }).pipe(
                map((page) => page.items),
                catchError(() => of([])),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((items) => {
        this.loading.set(false);
        this.results.set(items);
        this.active.set(0);
        if (this.pendingEnter) {
          this.pendingEnter = false;
          this.enter();
        }
      });
  }

  focus(): void {
    this.box().nativeElement.focus();
  }

  protected optionId(i: number): string {
    return `${this.inputId()}-opt-${i}`;
  }

  protected presentationsText(p: ProductSummary): string {
    return p.presentations.map((x) => x.name).join(' · ') || 'Sin presentaciones activas';
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.open.set(true);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.open.set(true);
      this.active.set((this.active() + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.set((this.active() - 1 + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.loading()) this.pendingEnter = true;
      else this.enter();
    } else if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  protected closeSoon(): void {
    setTimeout(() => this.open.set(false), 150);
  }

  protected pick(p: ProductSummary): void {
    this.picked.emit(p);
    this.query.set('');
    this.results.set([]);
    this.open.set(false);
  }

  /** Enter: el resaltado; con el lector, el que tiene ese código exacto */
  private enter(): void {
    const items = this.results();
    if (!items.length) return;
    const raw = this.term().toLowerCase();
    const exact = items.find(
      (p) =>
        p.code?.toLowerCase() === raw ||
        p.presentations.some((x) => x.barcode?.toLowerCase() === raw),
    );
    this.pick(exact ?? items[Math.min(this.active(), items.length - 1)]);
  }
}
