import { describe, expect, it } from 'vitest';
import { serviceNotices, type ServiceWatch } from './service-notices.js';

const base: ServiceWatch = {
  today: '2026-11-21',
  provider: 'MIFACT',
  tokenUpdatedAt: new Date('2026-10-01T15:00:00Z'),
  monthlyQuota: 300,
  usedThisMonth: 10,
  planExpiresOn: null,
  domainExpiresOn: null,
  serverExpiresOn: null,
};

describe('serviceNotices', () => {
  it('sin nada por vencer no avisa', () => {
    expect(serviceNotices(base)).toEqual([]);
  });

  it('token de Mifact con 5 meses: aviso ámbar con "Actualizar token"', () => {
    const [n] = serviceNotices({
      ...base,
      tokenUpdatedAt: new Date('2026-06-20T15:00:00Z'),
    });
    expect(n).toMatchObject({
      tone: 'warning',
      title: 'El token de Mifact tiene 5 meses',
      action: { link: '/comprobantes/configuracion' },
      dismissible: true,
    });
    // Otro proveedor no cambia el token cada 6 meses
    expect(
      serviceNotices({
        ...base,
        provider: 'NUBEFACT',
        tokenUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toEqual([]);
  });

  it('cupo del mes: ámbar al 80 %, rojo al llegar al límite', () => {
    expect(serviceNotices({ ...base, usedThisMonth: 239 })).toEqual([]);
    expect(serviceNotices({ ...base, usedThisMonth: 240 })[0]).toMatchObject({
      tone: 'warning',
      title: 'Usaste 240 de 300 comprobantes de noviembre',
      detail: expect.stringContaining('Quedan 60'),
    });
    expect(serviceNotices({ ...base, usedThisMonth: 300 })[0]).toMatchObject({
      tone: 'danger',
      id: 'quota:2026-11:full',
      dismissible: false,
    });
    // En simulación o con la facturación apagada no se vigila
    expect(
      serviceNotices({ ...base, provider: null, usedThisMonth: 500 }),
    ).toEqual([]);
  });

  it('vencimientos: ámbar desde 30 días, rojo desde 7 y después de vencer', () => {
    expect(serviceNotices({ ...base, domainExpiresOn: '2026-12-22' })).toEqual(
      [],
    );
    expect(
      serviceNotices({ ...base, domainExpiresOn: '2026-12-21' })[0],
    ).toMatchObject({
      tone: 'warning',
      title: 'El dominio vence en 30 días (21 de diciembre)',
      dismissible: true,
    });
    expect(
      serviceNotices({ ...base, serverExpiresOn: '2026-11-22' })[0],
    ).toMatchObject({
      tone: 'danger',
      title: 'El servidor vence mañana (22 de noviembre)',
      dismissible: false,
    });
    expect(
      serviceNotices({ ...base, planExpiresOn: '2026-11-20' })[0],
    ).toMatchObject({
      tone: 'danger',
      title: 'El plan de Mifact venció el 20 de noviembre',
    });
  });

  it('los rojos van primero', () => {
    const list = serviceNotices({
      ...base,
      domainExpiresOn: '2026-12-10',
      serverExpiresOn: '2026-11-23',
    });
    expect(list.map((n) => n.tone)).toEqual(['danger', 'warning']);
  });
});
