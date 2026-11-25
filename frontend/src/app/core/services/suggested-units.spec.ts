import { suggestedUnits } from './medical.models';

describe('suggestedUnits: lo que se entrega según la receta', () => {
  it('dosis × tomas al día × días', () => {
    expect(suggestedUnits('1 tableta', 'Cada 12 horas', '5 días')).toEqual({
      perDose: 1,
      perDay: 2,
      days: 5,
      total: 10,
    });
    expect(suggestedUnits('½ tableta', 'Cada 8 horas', '7 días')?.total).toBe(11);
    expect(suggestedUnits('1,5 ml', 'Cada 24 horas', '1 semana')?.total).toBe(11);
    expect(suggestedUnits('2', '2 veces al día', '1 mes')?.total).toBe(120);
    expect(suggestedUnits('1 pipeta', 'Dosis única', '1 día')?.total).toBe(1);
  });

  it('sin cálculo cuando no se puede saber', () => {
    expect(suggestedUnits('según peso', 'Cada 12 horas', '5 días')).toBeNull();
    expect(suggestedUnits('1 tableta', 'Según necesidad', '5 días')).toBeNull();
    expect(suggestedUnits('1 tableta', 'Cada 12 horas', 'hasta control')).toBeNull();
    expect(suggestedUnits('1 tableta', 'Cada 5 horas', '5 días')).toBeNull();
  });
});
