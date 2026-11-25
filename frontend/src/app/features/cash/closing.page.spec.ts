import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SessionSummary } from '../../core/services/cash.models';
import { ClosingPage } from './closing.page';

const closed: SessionSummary = {
  id: 2,
  status: 'CLOSED',
  register: { id: 1, name: 'Caja principal' },
  openingAmount: 100,
  openedAt: '2026-10-28T13:00:00Z',
  openedBy: { id: 1, fullName: 'Ana' },
  closedAt: '2026-10-28T22:00:00Z',
  closedBy: { id: 1, fullName: 'Ana' },
  expectedCash: 150,
  countedCash: 140,
  difference: -10,
  closingNote: 'Vuelto mal dado',
  byMethod: [
    {
      method: 'CASH',
      label: 'Efectivo',
      collected: 70,
      refunded: 0,
      net: 70,
      payments: 2,
      withoutCode: 0,
    },
    {
      method: 'YAPE',
      label: 'Yape',
      collected: 40,
      refunded: 0,
      net: 40,
      payments: 2,
      withoutCode: 1,
    },
  ],
  expenses: 20,
  totals: { collected: 110, refunded: 0, net: 110, receipts: 3 },
  receipts: [],
  movements: [
    {
      id: 5,
      kind: 'EXPENSE',
      method: 'CASH',
      amount: 20,
      reason: 'Agua',
      receiptCode: null,
      createdAt: '2026-10-28T15:00:00Z',
      createdBy: 'Ana',
      voided: false,
    },
  ],
};

describe('ClosingPage', () => {
  it('arma el reporte de cierre: arqueo de efectivo, apps a revisar, egresos y firmas', () => {
    TestBed.configureTestingModule({
      imports: [ClosingPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ClosingPage);
    fixture.componentRef.setInput('id', '2');
    fixture.detectChanges();
    http.expectOne('/api/cash/sessions/2').flush(closed);
    http.match(() => true).forEach((r) => r.flush(null));
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Reporte de cierre de caja');
    expect(text).toContain('Debía haber');
    expect(text).toContain('S/ 150.00');
    expect(text).toContain('Falta');
    expect(text).toContain('Vuelto mal dado');
    expect(text).toContain('Yape');
    expect(text).toContain('1 sin código');
    expect(text).toContain('Agua');
    expect(text).toContain('Entregó');
    http.verify();
  });
});
