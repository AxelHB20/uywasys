import { navFor } from './nav-items';

const labels = (role: Parameters<typeof navFor>[0]) =>
  navFor(role).map((g) => `${g.label}: ${g.items.map((i) => i.label).join(', ')}`);

describe('menú por rol', () => {
  it('el veterinario ve recepción y clínica, sin caja ni grooming', () => {
    expect(labels('VET')).toEqual([
      ': Inicio',
      'Recepción: Cola de hoy, Citas, Clientes',
      'Clínica: Historias clínicas, Atenciones, Hospitalización, Exámenes, Refuerzos, Presupuestos',
      'Gestión: Inventario, Servicios y precios, Plantillas clínicas',
    ]);
  });

  it('el groomer ve su tablero y no la historia clínica', () => {
    expect(labels('GROOMER')).toEqual([
      ': Inicio',
      'Recepción: Cola de hoy, Citas, Clientes',
      'Grooming: Tablero',
    ]);
  });

  it('caja ve lo suyo y no lo clínico', () => {
    expect(labels('CASHIER')).toEqual([
      ': Inicio',
      'Recepción: Cola de hoy, Citas, Clientes',
      'Caja: Caja, Comprobantes',
      'Gestión: Inventario',
    ]);
  });

  it('el administrador tiene todo, con la gestión al final', () => {
    expect(navFor('ADMIN').map((g) => g.label)).toEqual([
      '',
      'Recepción',
      'Clínica',
      'Grooming',
      'Caja',
      'Gestión',
    ]);
  });
});
