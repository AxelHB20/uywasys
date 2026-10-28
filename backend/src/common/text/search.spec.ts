import { clientSearchText, normalizeSearch } from './search.js';

describe('normalizeSearch', () => {
  it('quita tildes, eñes y signos', () => {
    expect(normalizeSearch('  Peña  Ñahui, José-Luis ')).toBe(
      'pena nahui jose luis',
    );
  });

  it('arma el texto de búsqueda del cliente con documento y celular', () => {
    expect(clientSearchText('Rosa Quispe', '45678912', '987654321')).toBe(
      'rosa quispe 45678912 987654321',
    );
    expect(clientSearchText('Rosa Quispe', null, '987654321')).toBe(
      'rosa quispe 987654321',
    );
  });
});
