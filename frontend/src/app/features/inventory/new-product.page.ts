import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  BASE_UNITS,
  BASE_UNIT_LABELS,
  BaseUnit,
  CATEGORIES,
  CATEGORY_LABELS,
  IGV_LABELS,
  IgvAffectation,
  ProductCategory,
} from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';

type PresentationForm = FormGroup<{
  name: FormControl<string>;
  factor: FormControl<number | null>;
  price: FormControl<number | null>;
}>;

const DEFAULT_PRESENTATION: Record<BaseUnit, string> = {
  UNIT: 'Unidad',
  TABLET: 'Tableta',
  ML: 'Frasco',
  G: 'Bolsa',
};

function presentationForm(
  name = '',
  factor: number | null = 1,
  price: number | null = null,
): PresentationForm {
  return new FormGroup({
    name: new FormControl(name, {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    factor: new FormControl<number | null>(factor, [Validators.required, Validators.min(0.001)]),
    price: new FormControl<number | null>(price, [Validators.min(0)]),
  });
}

@Component({
  selector: 'app-new-product-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-product.page.html',
})
export class NewProductPage {
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly categories = CATEGORIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly units = BASE_UNITS;
  protected readonly unitLabels = BASE_UNIT_LABELS;
  protected readonly igvTypes = Object.keys(IGV_LABELS) as IgvAffectation[];
  protected readonly igvLabels = IGV_LABELS;
  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(120)],
    }),
    category: new FormControl<ProductCategory | null>(null, [Validators.required]),
    baseUnit: new FormControl<BaseUnit>('TABLET', { nonNullable: true }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[\w.-]{0,30}$/)],
    }),
    barcode: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    minStock: new FormControl<number | null>(null, [Validators.min(0)]),
    requiresPrescription: new FormControl(false, { nonNullable: true }),
    controlled: new FormControl(false, { nonNullable: true }),
    igv: new FormControl<IgvAffectation>('TAXED', { nonNullable: true }),
    sunatUnit: new FormControl('NIU', {
      nonNullable: true,
      validators: [Validators.pattern(/^[A-Z0-9]{2,3}$/)],
    }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    presentations: new FormArray<PresentationForm>([presentationForm('Tableta', 1)]),
  });

  protected readonly baseUnit = toSignal(this.form.controls.baseUnit.valueChanges, {
    initialValue: this.form.controls.baseUnit.value,
  });
  protected readonly category = toSignal(this.form.controls.category.valueChanges, {
    initialValue: this.form.controls.category.value,
  });
  protected readonly unitPlural = computed(() => this.unitLabels[this.baseUnit()][1]);

  constructor() {
    // Si la única presentación sigue con el nombre por defecto, se ajusta a la nueva unidad
    this.form.controls.baseUnit.valueChanges.subscribe((unit) => {
      const rows = this.form.controls.presentations.controls;
      const first = rows[0]?.controls.name;
      if (rows.length === 1 && first && Object.values(DEFAULT_PRESENTATION).includes(first.value))
        first.setValue(DEFAULT_PRESENTATION[unit]);
    });
    this.form.controls.controlled.valueChanges.subscribe((controlled) => {
      if (controlled) this.form.controls.requiresPrescription.setValue(true);
    });
  }

  protected get rows(): PresentationForm[] {
    return this.form.controls.presentations.controls;
  }

  protected addRow(): void {
    this.form.controls.presentations.push(presentationForm('', null));
  }

  protected removeRow(index: number): void {
    if (this.rows.length > 1) this.form.controls.presentations.removeAt(index);
  }

  protected invalid(control: { invalid: boolean; touched: boolean }): boolean {
    return control.invalid && control.touched;
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus());
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.inventory
      .create({
        name: v.name.trim(),
        category: v.category as ProductCategory,
        baseUnit: v.baseUnit,
        code: v.code.trim() || null,
        barcode: v.barcode.trim() || null,
        minStock: v.minStock ?? 0,
        requiresPrescription: v.requiresPrescription,
        controlled: v.controlled,
        igv: v.igv,
        sunatUnit: v.sunatUnit,
        notes: v.notes.trim() || null,
        presentations: v.presentations.map((p) => ({
          name: p.name.trim(),
          factor: Number(p.factor),
          price: p.price === null ? null : Number(p.price),
        })),
      })
      .subscribe({
        next: (product) => {
          this.toast.success(`${product.name} quedó registrado. Ahora ingresa su primera compra.`);
          this.router.navigate(['/inventario', product.id]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }
}
