import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { SEX_LABELS, SPECIES, SPECIES_LABELS } from '../../../core/services/clients.models';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { toIsoDate } from '../../../shared/utils/pet-age';
import { PetForm } from './pet-form';

/** Campos de una mascota. Se usa en el registro rápido y en el modal de la ficha. */
@Component({
  selector: 'app-pet-fields',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pet-fields.component.html',
})
export class PetFieldsComponent {
  readonly group = input.required<PetForm>();
  /** Prefijo para los id de los campos (debe ser único en la pantalla). */
  readonly idPrefix = input('pet');

  protected readonly species = SPECIES;
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly today = toIsoDate(new Date());

  private readonly value = toSignal(
    toObservable(this.group).pipe(switchMap((g) => g.valueChanges)),
  );
  protected readonly ageMode = computed(() => this.value()?.ageMode ?? this.group().value.ageMode);
  protected readonly aggressive = computed(
    () => this.value()?.aggressive ?? this.group().value.aggressive,
  );

  protected id(name: string): string {
    return `${this.idPrefix()}-${name}`;
  }

  protected invalid(name: keyof PetForm['controls']): boolean {
    const control = this.group().controls[name];
    return control.invalid && control.touched;
  }
}
