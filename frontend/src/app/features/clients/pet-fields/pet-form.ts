import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Pet, PetInput, PetSex, Species } from '../../../core/services/clients.models';
import { ageParts, birthDateFromAge } from '../../../shared/utils/pet-age';

export type AgeMode = 'age' | 'date';

export type PetForm = FormGroup<{
  name: FormControl<string>;
  species: FormControl<Species | null>;
  breed: FormControl<string>;
  sex: FormControl<PetSex | null>;
  neutered: FormControl<boolean>;
  ageMode: FormControl<AgeMode>;
  years: FormControl<number | null>;
  months: FormControl<number | null>;
  birthDate: FormControl<string>;
  weightKg: FormControl<number | null>;
  allergies: FormControl<string>;
  aggressive: FormControl<boolean>;
  aggressiveNote: FormControl<string>;
  color: FormControl<string>;
  microchip: FormControl<string>;
  notes: FormControl<string>;
}>;

export function createPetForm(): PetForm {
  return new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    species: new FormControl<Species | null>(null, { validators: [Validators.required] }),
    breed: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    sex: new FormControl<PetSex | null>(null),
    neutered: new FormControl(false, { nonNullable: true }),
    // Recepción casi nunca sabe la fecha exacta: por defecto se pide la edad aproximada.
    ageMode: new FormControl<AgeMode>('age', { nonNullable: true }),
    years: new FormControl<number | null>(null, [Validators.min(0), Validators.max(40)]),
    months: new FormControl<number | null>(null, [Validators.min(0), Validators.max(11)]),
    birthDate: new FormControl('', { nonNullable: true }),
    weightKg: new FormControl<number | null>(null, [Validators.min(0.01), Validators.max(999.99)]),
    allergies: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    aggressive: new FormControl(false, { nonNullable: true }),
    aggressiveNote: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(200)],
    }),
    color: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    microchip: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[0-9A-Za-z]{9,15}$/)],
    }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });
}

/** Llena el formulario con una mascota existente (para editar). */
export function patchPetForm(form: PetForm, pet: Pet): void {
  const estimated = !!pet.birthDate && pet.birthDateEstimated;
  const parts = estimated && pet.birthDate ? ageParts(pet.birthDate) : null;
  form.reset({
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? '',
    sex: pet.sex,
    neutered: pet.neutered,
    ageMode: pet.birthDate && !estimated ? 'date' : 'age',
    years: parts?.years ?? null,
    months: parts?.months ?? null,
    birthDate: pet.birthDate && !estimated ? pet.birthDate : '',
    weightKg: pet.weightKg,
    allergies: pet.allergies ?? '',
    aggressive: pet.aggressive,
    aggressiveNote: pet.aggressiveNote ?? '',
    color: pet.color ?? '',
    microchip: pet.microchip ?? '',
    notes: pet.notes ?? '',
  });
}

const text = (value: string) => value.trim() || null;

/** Convierte el formulario a lo que espera la API. */
export function toPetInput(form: PetForm, today: Date = new Date()): PetInput {
  const v = form.getRawValue();
  let birthDate: string | null = null;
  let birthDateEstimated = false;
  if (v.ageMode === 'date') {
    birthDate = v.birthDate || null;
  } else if (v.years != null || v.months != null) {
    birthDate = birthDateFromAge(v.years ?? 0, v.months ?? 0, today);
    birthDateEstimated = true;
  }
  return {
    name: v.name.trim(),
    species: v.species as Species,
    breed: text(v.breed),
    sex: v.sex,
    neutered: v.neutered,
    birthDate,
    birthDateEstimated,
    weightKg: v.weightKg == null ? null : Math.round(v.weightKg * 100) / 100,
    allergies: text(v.allergies),
    aggressive: v.aggressive,
    aggressiveNote: v.aggressive ? text(v.aggressiveNote) : null,
    color: text(v.color),
    microchip: text(v.microchip),
    notes: text(v.notes),
  };
}
