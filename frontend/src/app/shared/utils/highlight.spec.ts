import { markMatch } from './highlight';

describe('markMatch', () => {
  it('resalta lo buscado aunque el texto tenga espacios o tildes', () => {
    expect(markMatch('987 677 123', '77')).toEqual([
      { text: '987 6', hit: false },
      { text: '77', hit: true },
      { text: ' 123', hit: false },
    ]);
    expect(markMatch('987 654 321', '7654')).toEqual([
      { text: '98', hit: false },
      { text: '7 654', hit: true },
      { text: ' 321', hit: false },
    ]);
    expect(markMatch('Gabriela Medina Gutiérrez', 'gutierrez')).toEqual([
      { text: 'Gabriela Medina ', hit: false },
      { text: 'Gutiérrez', hit: true },
    ]);
  });

  it('sin coincidencia o con menos de 2 letras, queda tal cual', () => {
    expect(markMatch('Rosa Quispe', 'xx')).toEqual([{ text: 'Rosa Quispe', hit: false }]);
    expect(markMatch('Rosa Quispe', 'r')).toEqual([{ text: 'Rosa Quispe', hit: false }]);
  });
});
