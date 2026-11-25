import { ApplicationRef, Injector, resource, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { rxResource } from '@angular/core/rxjs-interop';
import { of, throwError } from 'rxjs';
import { loaded } from './resource';

describe('loaded()', () => {
  it('da el valor cuando llega y undefined si el servidor falló (sin lanzar)', async () => {
    const injector = TestBed.inject(Injector);
    const good = rxResource({ stream: () => of(7), injector });
    const bad = rxResource({ stream: () => throwError(() => new Error('500')), injector });
    const value = loaded(good);
    const failed = loaded(bad);
    expect(value()).toBeUndefined();

    await TestBed.inject(ApplicationRef).whenStable();
    expect(value()).toBe(7);
    expect(() => bad.value()).toThrow();
    expect(failed()).toBeUndefined();
  });

  it('mientras carga otro filtro deja lo anterior (la lista no se vacía); si falla, nada', async () => {
    const injector = TestBed.inject(Injector);
    const filter = signal('a');
    let fail = false;
    const pending: (() => void)[] = [];
    const res = resource({
      params: () => filter(),
      loader: ({ params }) =>
        new Promise<string>((ok, ko) =>
          pending.push(() => (fail ? ko(new Error('500')) : ok('lista ' + params))),
        ),
      injector,
    });
    const data = loaded(res);
    const settle = async () => {
      TestBed.inject(ApplicationRef).tick();
      await Promise.resolve();
      pending.splice(0).forEach((run) => run());
      await new Promise((r) => setTimeout(r));
    };
    expect(data()).toBeUndefined();
    await settle();
    expect(data()).toBe('lista a');
    filter.set('b');
    TestBed.inject(ApplicationRef).tick();
    expect(res.isLoading()).toBe(true);
    expect(data()).toBe('lista a');
    await settle();
    expect(data()).toBe('lista b');
    fail = true;
    filter.set('c');
    await settle();
    expect(res.error()).toBeTruthy();
    expect(data()).toBeUndefined();
  });
});
