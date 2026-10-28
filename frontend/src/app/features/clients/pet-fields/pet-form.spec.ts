import { createPetForm, patchPetForm, toPetInput } from './pet-form';

describe('formulario de mascota', () => {
  it('convierte la edad aproximada en fecha estimada', () => {
    const form = createPetForm();
    form.patchValue({ name: ' Toby ', species: 'DOG', years: 2, months: 0, weightKg: 12.345 });
    const input = toPetInput(form, new Date(2026, 9, 27));
    expect(input).toMatchObject({
      name: 'Toby',
      birthDate: '2024-10-01',
      birthDateEstimated: true,
      weightKg: 12.35,
      breed: null,
    });
  });

  it('sin edad no envía fecha, y la nota de agresividad solo si es agresivo', () => {
    const form = createPetForm();
    form.patchValue({ name: 'Mishi', species: 'CAT', aggressiveNote: 'muerde' });
    expect(toPetInput(form)).toMatchObject({ birthDate: null, aggressiveNote: null });
  });

  it('al editar una fecha exacta abre en modo fecha', () => {
    const form = createPetForm();
    patchPetForm(form, {
      id: 1,
      clientId: 1,
      name: 'Luna',
      species: 'DOG',
      breed: null,
      sex: 'FEMALE',
      neutered: true,
      birthDate: '2020-03-15',
      birthDateEstimated: false,
      weightKg: 8,
      color: null,
      microchip: null,
      allergies: null,
      aggressive: false,
      aggressiveNote: null,
      notes: null,
      deceasedAt: null,
      active: true,
    });
    expect(form.getRawValue()).toMatchObject({ ageMode: 'date', birthDate: '2020-03-15' });
  });
});
