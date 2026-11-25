import { DestroyRef } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificationEvent, NotificationsView, eventView, timeAgo } from './notifications.models';
import { NotificationsService } from './notifications.service';

const ev = (id: string, at: string, extra: Partial<NotificationEvent> = {}): NotificationEvent => ({
  id,
  kind: 'arrival',
  urgent: false,
  at,
  petName: 'Toby',
  species: 'DOG',
  detail: 'Vómitos · lo registró Ana',
  link: '/cola',
  ...extra,
});
const view = (events: NotificationEvent[], seenAt: string | null = null): NotificationsView => ({
  alerts: [],
  events,
  seenAt,
  serverTime: new Date().toISOString(),
});

describe('NotificationsService (campana y avisos)', () => {
  let http: HttpTestingController;
  let service: NotificationsService;
  const destroy = { onDestroy: () => () => undefined } as unknown as DestroyRef;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NotificationsService);
  });

  it('la primera carga no salta avisos; lo que llega después sí, y abrir la campana limpia el contador', () => {
    service.start(destroy);
    http.expectOne('/api/notifications').flush(view([ev('arrival:1', '2026-11-06T14:00:00Z')]));
    expect(service.toasts()).toEqual([]);
    expect(service.unread()).toBe(1);

    service.refresh();
    http
      .expectOne('/api/notifications')
      .flush(
        view([
          ev('arrival:2', '2026-11-06T15:00:00Z', { urgent: true }),
          ev('arrival:1', '2026-11-06T14:00:00Z'),
        ]),
      );
    expect(service.toasts().map((t) => t.view.title)).toEqual(['Urgencia: llegó Toby']);
    expect(service.unread()).toBe(2);

    service.markSeen();
    expect(service.unread()).toBe(0);
    http.expectOne('/api/notifications/seen').flush({ seenAt: '2026-11-06T15:01:00Z' });
    service.dismiss('arrival:2');
    expect(service.toasts()).toEqual([]);
  });

  it('textos de cada aviso', () => {
    expect(
      eventView(
        ev('r:1', '2026-11-06T15:00:00Z', {
          kind: 'readyToCharge',
          amount: 60,
          detail: 'atendió Dra. Lucía',
        }),
      ),
    ).toMatchObject({
      title: 'Toby: listo para cobrar',
      detail: 'S/ 60.00 · atendió Dra. Lucía',
      action: 'Cobrar',
    });
    expect(
      eventView(
        ev('b:1', '2026-11-06T15:00:00Z', {
          kind: 'billingRejected',
          urgent: true,
          code: 'B001-00000012',
          petName: null,
        }),
      ).title,
    ).toBe('B001-00000012 rechazado por SUNAT');
    const now = new Date('2026-11-06T15:10:00Z').getTime();
    expect(timeAgo('2026-11-06T15:09:40Z', now)).toBe('ahora');
    expect(timeAgo('2026-11-06T15:00:00Z', now)).toBe('hace 10 min');
    expect(timeAgo('2026-11-06T12:00:00Z', now)).toBe('hace 3 h');
  });
});
