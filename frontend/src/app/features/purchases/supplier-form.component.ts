import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { Supplier, SupplierInput } from '../../core/services/purchases.models';
import { PurchasesService } from '../../core/services/purchases.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { apiErrorMessage, rucValidator } from '../../shared/utils/validators';

/** Crear o editar un proveedor. Lo usan Proveedores y Recibir compra (sin salir de la ficha). */
@Component({
  selector: 'app-supplier-form',
  imports: [ReactiveFormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [title]="supplier() ? 'Editar proveedor' : 'Nuevo proveedor'"
      description="Como figura en sus fichas o facturas. El RUC evita registrarlo dos veces."
      [dismissible]="false"
      (closed)="cancel()"
    >
      <form id="supplier-form" [formGroup]="form" (ngSubmit)="save()" novalidate class="space-y-4">
        @if (error(); as message) {
          <p
            class="flex items-start gap-2 rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-900 ring-1 ring-rose-200"
            role="alert"
          >
            <app-icon name="alert" class="mt-0.5 size-4 shrink-0 text-rose-600" />
            {{ message }}
          </p>
        }
        <div>
          <label for="sup-name" class="field-label"
            >Razón social o nombre <span class="text-rose-600" aria-hidden="true">*</span></label
          >
          <input
            id="sup-name"
            formControlName="name"
            class="field-input"
            maxlength="150"
            autocomplete="off"
            placeholder="Ej.: Droguería Andina S.A.C."
            [attr.aria-invalid]="bad('name')"
          />
          @if (bad('name')) {
            <p class="field-error">Escribe el nombre (mínimo 2 letras)</p>
          }
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="sup-ruc" class="field-label">RUC</label>
            <input
              id="sup-ruc"
              formControlName="ruc"
              class="field-input tabular-nums"
              inputmode="numeric"
              maxlength="11"
              autocomplete="off"
              placeholder="20…"
              [attr.aria-invalid]="bad('ruc')"
              aria-describedby="sup-ruc-hint"
            />
            @if (bad('ruc')) {
              <p class="field-error">El RUC no es válido (11 dígitos)</p>
            } @else {
              <p id="sup-ruc-hint" class="field-hint">Opcional si da boleta.</p>
            }
          </div>
          <div>
            <label for="sup-phone" class="field-label">Teléfono o celular</label>
            <input
              id="sup-phone"
              formControlName="phone"
              class="field-input tabular-nums"
              type="tel"
              inputmode="tel"
              maxlength="20"
              autocomplete="off"
              [attr.aria-invalid]="bad('phone')"
            />
            @if (bad('phone')) {
              <p class="field-error">Escribe solo números (de 6 a 15)</p>
            }
          </div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="sup-contact" class="field-label">Contacto</label>
            <input
              id="sup-contact"
              formControlName="contact"
              class="field-input"
              maxlength="100"
              autocomplete="off"
              placeholder="Vendedor o encargado"
            />
          </div>
          <div>
            <label for="sup-email" class="field-label">Correo</label>
            <input
              id="sup-email"
              formControlName="email"
              class="field-input"
              type="email"
              maxlength="120"
              autocomplete="off"
              [attr.aria-invalid]="bad('email')"
            />
            @if (bad('email')) {
              <p class="field-error">El correo no es válido</p>
            }
          </div>
        </div>
        <div>
          <label for="sup-notes" class="field-label">Notas</label>
          <textarea
            id="sup-notes"
            formControlName="notes"
            class="field-input min-h-20"
            maxlength="300"
            placeholder="Días de visita, condiciones…"
          ></textarea>
        </div>
        @if (supplier()) {
          <label class="flex cursor-pointer items-center gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              formControlName="active"
              class="size-5 rounded accent-anil-600"
            />
            Activo (aparece al recibir una compra)
          </label>
        }
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="cancel()">Cancelar</button>
        <button type="submit" form="supplier-form" class="btn btn-primary" [disabled]="saving()">
          @if (saving()) {
            <app-icon name="loader" class="size-4 animate-spin" />
          }
          {{ supplier() ? 'Guardar cambios' : 'Agregar proveedor' }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class SupplierFormComponent {
  private readonly api = inject(PurchasesService);

  readonly open = input(false);
  /** Si viene, se edita; si no, se crea */
  readonly supplier = input<Supplier | null>(null);
  readonly saved = output<Supplier>();
  readonly cancelled = output<void>();

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly tried = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(150)],
    }),
    ruc: new FormControl('', { nonNullable: true, validators: rucValidator }),
    phone: new FormControl('', {
      nonNullable: true,
      validators: Validators.pattern(/^\+?[\d\s()-]{6,20}$/),
    }),
    contact: new FormControl('', { nonNullable: true, validators: Validators.maxLength(100) }),
    email: new FormControl('', { nonNullable: true, validators: Validators.email }),
    notes: new FormControl('', { nonNullable: true, validators: Validators.maxLength(300) }),
    active: new FormControl(true, { nonNullable: true }),
  });

  constructor() {
    // Cada vez que se abre, empieza con los datos del proveedor (o vacío)
    effect(() => {
      if (!this.open()) return;
      const s = this.supplier();
      untracked(() => {
        this.error.set(null);
        this.tried.set(false);
        this.form.reset({
          name: s?.name ?? '',
          ruc: s?.ruc ?? '',
          phone: s?.phone ?? '',
          contact: s?.contact ?? '',
          email: s?.email ?? '',
          notes: s?.notes ?? '',
          active: s?.active ?? true,
        });
        setTimeout(() => document.getElementById('sup-name')?.focus());
      });
    });
  }

  protected bad(name: 'name' | 'ruc' | 'phone' | 'email'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.tried());
  }

  protected cancel(): void {
    if (!this.saving()) this.cancelled.emit();
  }

  protected save(): void {
    this.tried.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) {
      setTimeout(() =>
        document.querySelector<HTMLElement>('#supplier-form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const v = this.form.getRawValue();
    const input: SupplierInput = {
      name: v.name.trim(),
      ruc: v.ruc.trim() || null,
      phone: v.phone.replace(/[\s()-]/g, '') || null,
      contact: v.contact.trim() || null,
      email: v.email.trim() || null,
      notes: v.notes.trim() || null,
    };
    const current = this.supplier();
    this.saving.set(true);
    this.error.set(null);
    (current
      ? this.api.updateSupplier(current.id, { ...input, active: v.active })
      : this.api.createSupplier(input)
    )
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (s) => this.saved.emit(s),
        error: (error) => this.error.set(apiErrorMessage(error, 'No se pudo guardar el proveedor')),
      });
  }
}
