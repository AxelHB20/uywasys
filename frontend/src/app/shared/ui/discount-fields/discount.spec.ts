import { discountCap, discountProblem, discountProblemText } from './discount';

describe('descuento en soles', () => {
  it('tope: hasta el % sin administrador, el monto y el motivo', () => {
    expect(discountCap(46, 10)).toBe(4.6);
    expect(discountProblem(46, null, '', 10, false)).toBeNull();
    expect(discountProblem(46, 5, 'Campaña', 10, false)).toBe('cap');
    expect(discountProblem(46, 5, 'Campaña', 10, true)).toBeNull();
    expect(discountProblem(46, 4.6, '', 10, false)).toBe('reason');
    expect(discountProblem(46, 50, 'Campaña', 100, true)).toBe('tooBig');
    expect(discountProblem(46, 1.234, 'Campaña', 10, false)).toBe('format');
    expect(discountProblemText('cap', 46, 10)).toBe(
      'Pasa del 10 % (máx. S/ 4.60): solo el administrador puede darlo',
    );
  });
});
