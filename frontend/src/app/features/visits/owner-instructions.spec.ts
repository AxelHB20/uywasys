import { VisitDetail } from '../../core/services/visits.models';
import { ownerInstructions, ownerMessage } from './owner-instructions';

const base = {
  diagnosis: 'Gastroenteritis',
  notes: 'Dieta blanda 3 días.',
  openedAt: '2026-10-28T15:00:00Z',
  pet: { name: 'Toby' },
  client: { name: 'Rosa Quispe' },
  prescriptions: [
    {
      voidedAt: null,
      items: [
        {
          drug: 'Metronidazol 250 mg',
          dose: '1 tableta',
          route: 'Oral',
          frequency: 'cada 12 h',
          duration: '5 días',
          instructions: 'Con comida.',
        },
      ],
    },
    { voidedAt: '2026-10-28T16:00:00Z', items: [{ drug: 'Anulado', dose: '1' }] },
  ],
  immunizations: [
    { name: 'Séxtuple', nextDueAt: '2026-11-18', voidedAt: null },
    { name: 'Quitada', nextDueAt: null, voidedAt: '2026-10-28T16:00:00Z' },
  ],
} as unknown as VisitDetail;

describe('indicaciones para el dueño', () => {
  it('junta diagnóstico, plan, medicamentos y vacunas (sin lo anulado)', () => {
    const text = ownerInstructions(base);
    expect(text).toBe(
      [
        'Diagnóstico: Gastroenteritis',
        'Tratamiento e indicaciones:\nDieta blanda 3 días.',
        'Medicamentos:\n• Metronidazol 250 mg: 1 tableta, oral, cada 12 h, por 5 días. Con comida.',
        'Vacunas y desparasitaciones de hoy:\n• Séxtuple (próxima dosis: 18/11/2026)',
      ].join('\n\n'),
    );
  });

  it('queda vacío si no hay nada que contar', () => {
    expect(
      ownerInstructions({
        ...base,
        diagnosis: null,
        notes: '  ',
        prescriptions: [],
        immunizations: [],
      }),
    ).toBe('');
  });

  it('saluda al dueño por su nombre', () => {
    expect(ownerMessage(base, 'Huellitas', 'Texto')).toBe(
      'Hola Rosa, estas son las indicaciones para Toby de su atención del 28/10/2026 en Huellitas:\n\nTexto\n\nCualquier duda, escríbenos por aquí.',
    );
  });
});
