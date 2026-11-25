import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Estimate, validityView } from '../../core/services/estimates.models';
import { tick } from '../../shared/testing';
import { EstimatesPage } from './estimates.page';

const row = (id: number, over: Partial<Estimate>): Estimate =>
  ({
    id,
    code: `PR-0000${id}`,
    title: 'Castración',
    status: 'PENDING',
    validUntil: '2099-01-01',
    total: 100,
    createdAt: '2026-11-06T15:00:00Z',
    decidedAt: null,
    convertedAt: null,
    pet: { id: 1, number: 1, name: 'Toby', species: 'DOG' },
    client: { id: 1, name: 'Rosa Quispe' },
    createdBy: { id: 1, fullName: 'Dra. Ruiz' },
    items: [],
    ...over,
  }) as Estimate;

describe('EstimatesPage (bandeja de presupuestos)', () => {
  it('muestra indicadores, filtra por estado y busca sin tildes', async () => {
    TestBed.configureTestingModule({
      imports: [EstimatesPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EstimatesPage);
    fixture.detectChanges();
    http.expectOne('/api/estimates/summary').flush({
      pending: { count: 2, amount: 630 },
      expiringSoon: 1,
      accepted: { count: 1, amount: 520 },
      convertedMonth: { count: 1, amount: 470 },
      acceptance: { won: 2, decided: 3, rate: 66.7 },
    });
    http
      .expectOne((r) => r.url === '/api/estimates' && r.params.get('status') === 'OPEN')
      .flush([
        row(1, { title: 'Profilaxis dental' }),
        row(2, {
          pet: { name: 'Michi', species: 'CAT' } as never,
          client: { name: 'José Núñez' } as never,
        }),
      ]);
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('S/ 630.00');
    expect(el.textContent).toContain('1 vence en 3 días');
    expect(el.textContent).toContain('66.7 %');
    expect(el.textContent).toContain('2 presupuestos');

    const q = el.querySelector<HTMLInputElement>('#est-q')!;
    q.value = 'nunez';
    q.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();
    expect(el.querySelectorAll('a[href^="/presupuestos/"]').length).toBe(1);
    expect(el.textContent).toContain('Michi');

    [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')]
      .find((b) => b.textContent?.includes('Por cargar'))!
      .click();
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === '/api/estimates' && r.params.get('status') === 'ACCEPTED')
      .flush([]);
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ningún presupuesto coincide con “nunez”');
    http.verify();
  });

  it('dice cuánto le queda a cada presupuesto por responder', () => {
    const today = '2026-11-06';
    expect(validityView({ status: 'PENDING', validUntil: '2026-11-06' }, today)).toEqual({
      text: 'Vence hoy',
      tone: 'urgent',
    });
    expect(validityView({ status: 'PENDING', validUntil: '2026-11-07' }, today).text).toBe(
      'Vence mañana',
    );
    expect(validityView({ status: 'PENDING', validUntil: '2026-11-09' }, today).tone).toBe('soon');
    expect(validityView({ status: 'PENDING', validUntil: '2026-11-20' }, today).text).toBe(
      'Quedan 14 días',
    );
    expect(validityView({ status: 'EXPIRED', validUntil: '2026-11-01' }, today).text).toBe(
      'Venció hace 5 días',
    );
    expect(validityView({ status: 'CONVERTED', validUntil: '2026-11-20' }, today).text).toBe('');
  });
});
