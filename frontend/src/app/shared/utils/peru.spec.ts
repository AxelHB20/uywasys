import { FormControl } from '@angular/forms';
import { DocumentType } from '../../core/services/clients.models';
import { documentValidator, isValidDocument, mobileValidator, normalizeDocNumber } from './peru';

describe('validadores peruanos', () => {
  it('valida el número según el tipo de documento', () => {
    expect(isValidDocument('DNI', '45678912')).toBe(true);
    expect(isValidDocument('RUC', '20131312955')).toBe(true);
    expect(isValidDocument('RUC', '20131312956')).toBe(false);
    expect(isValidDocument('CE', normalizeDocNumber('001 234 567'))).toBe(true);
  });

  it('el validador usa el tipo elegido en otro campo', () => {
    let type: DocumentType | null = 'DNI';
    const control = new FormControl('1234', [documentValidator(() => type)]);
    expect(control.errors).toEqual({ document: true });
    type = null;
    control.updateValueAndValidity();
    expect(control.errors).toBeNull();
  });

  it('celular de 9 dígitos que empieza con 9, con o sin espacios', () => {
    expect(mobileValidator(new FormControl('987 654 321'))).toBeNull();
    expect(mobileValidator(new FormControl('887654321'))).toEqual({ mobile: true });
  });
});
