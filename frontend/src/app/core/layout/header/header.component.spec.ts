import { toNotification } from './header.component';

describe('avisos de la campana', () => {
  it('arma el texto con singular y plural, y conserva el enlace', () => {
    expect(toNotification({ kind: 'urgent', count: 1, link: '/cola' })).toMatchObject({
      title: '1 urgencia en la cola',
      tone: 'danger',
      link: '/cola',
    });
    expect(
      toNotification({
        kind: 'shortage',
        count: 3,
        link: '/inventario',
        query: { filtro: 'faltantes' },
      }),
    ).toMatchObject({
      title: '3 insumos usados sin stock',
      query: { filtro: 'faltantes' },
    });
    expect(toNotification({ kind: 'staleCash', count: 1, link: '/caja' }).title).toBe(
      'Caja abierta desde otro día',
    );
    expect(
      toNotification({
        kind: 'staleVisits',
        count: 2,
        link: '/atenciones',
        query: { ver: 'antiguas' },
      }),
    ).toMatchObject({
      tone: 'danger',
      title: '2 atenciones abiertas de días anteriores',
      query: { ver: 'antiguas' },
    });
    expect(toNotification({ kind: 'staleGrooming', count: 1, link: '/grooming' })).toMatchObject({
      title: '1 grooming sin entregar de días anteriores',
      link: '/grooming',
    });
  });
});
