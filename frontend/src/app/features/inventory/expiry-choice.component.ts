import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** ¿El producto vence? Decide si la compra pide lote y fecha y si entra en el semáforo de vencimientos. */
@Component({
  selector: 'app-expiry-choice',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset>
      <legend class="field-label">Control de vencimiento</legend>
      <div class="mt-1.5 grid gap-2 sm:grid-cols-2">
        @for (o of options; track o.value) {
          <label
            class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-3.5 ring-1 ring-slate-300 select-none hover:bg-slate-50 has-checked:bg-anil-50 has-checked:ring-2 has-checked:ring-anil-500 has-focus-visible:ring-2 has-focus-visible:ring-anil-400"
          >
            <input type="radio" class="sr-only" [formControl]="control()" [value]="o.value" />
            <span
              class="grid size-9 shrink-0 place-items-center rounded-lg"
              [class]="o.value ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'"
            >
              <app-icon [name]="o.icon" class="size-4.5" />
            </span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold text-slate-900">{{ o.title }}</span>
              <span class="mt-0.5 block text-sm text-slate-600">{{ o.hint }}</span>
            </span>
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class ExpiryChoiceComponent {
  readonly control = input.required<FormControl<boolean>>();

  protected readonly options = [
    {
      value: true,
      icon: 'calendar',
      title: 'Vence',
      hint: 'Medicamentos, vacunas, alimentos. Pide lote y fecha; avisa antes de vencer.',
    },
    {
      value: false,
      icon: 'package',
      title: 'No vence',
      hint: 'Camas, juguetes, correas, collares. Solo cantidad y costo.',
    },
  ] as const;
}
