import { clientCode, parseRecordCode, petCode } from './clinic-sequence.js';

describe('códigos de expediente', () => {
  it('rellena con ceros', () => {
    expect(clientCode(12)).toBe('C-00012');
    expect(petCode(45)).toBe('HC-00045');
    expect(clientCode(123456)).toBe('C-123456');
  });

  it('reconoce códigos escritos de varias formas en el buscador', () => {
    expect(parseRecordCode('C-00012')).toEqual({ kind: 'client', number: 12 });
    expect(parseRecordCode('c12')).toEqual({ kind: 'client', number: 12 });
    expect(parseRecordCode(' HC-45 ')).toEqual({ kind: 'pet', number: 45 });
    expect(parseRecordCode('hc 0045')).toEqual({ kind: 'pet', number: 45 });
  });

  it('no confunde nombres ni documentos con códigos', () => {
    expect(parseRecordCode('Carlos')).toBeNull();
    expect(parseRecordCode('45678912')).toBeNull();
    expect(parseRecordCode('C-0')).toBeNull();
    expect(parseRecordCode('')).toBeNull();
  });
});
