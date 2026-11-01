import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { CommissionReport, periodRange } from '../../core/services/grooming.models';
import { GroomingCommissionsPage } from './commissions.page';

const report: CommissionReport = {
  from: '2026-10-26',
  to: '2026-11-01',
  rows: [
    {
      groomer: { id: 5, fullName: 'Rosa Flores' },
      currentPercent: 30,
      services: 2,
      paid: 100,
      pending: 20,
      commission: 30,
    },
    {
      groomer: { id: 6, fullName: 'Kevin Torres' },
      currentPercent: null,
      services: 1,
      paid: 40,
      pending: 0,
      commission: 0,
    },
  ],
  lines: [
    {
      id: 1,
      code: 'GR-00001',
      deliveredAt: '2026-10-30T20:00:00.000Z',
      groomer: { id: 5, fullName: 'Rosa Flores' },
      pet: { id: 3, name: 'Toby' },
      client: { id: 9, name: 'Rosa Quispe' },
      services: 'Baño completo (mediano)',
      paid: 45,
      pending: 20,
      percent: 30,
      commission: 13.5,
    },
  ],
  totals: { services: 3, paid: 140, pending: 20, commission: 30 },
};

describe('GroomingCommissionsPage (comisiones)', () => {
  let http: HttpTestingController;

  afterEach(() => http?.verify());

  function render(role: 'ADMIN' | 'GROOMER') {
    TestBed.configureTestingModule({
      imports: [GroomingCommissionsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({ id: 5, fullName: 'Ana', role } as never);
    const fixture = TestBed.createComponent(GroomingCommissionsPage);
    fixture.detectChanges();
    return fixture;
  }

  it('calcula semanas de lunes a domingo y meses completos', () => {
    expect(periodRange('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(periodRange('lastWeek', '2026-11-01')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodRange('month', '2026-11-01')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(periodRange('lastMonth', '2026-03-15')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('el administrador ve el resumen por groomer y avisa a quién le falta su porcentaje', () => {
    const fixture = render('ADMIN');
    http.expectOne('/api/grooming/groomers').flush([
      { id: 5, fullName: 'Rosa Flores' },
      { id: 6, fullName: 'Kevin Torres' },
    ]);
    const req = http.expectOne((r) => r.url === '/api/grooming/commissions');
    expect(req.request.params.get('from')).toBe(fixtureWeek().from);
    req.flush(report);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Por groomer');
    expect(el.textContent).toContain('Sin comisión configurada');
    expect(el.textContent).toContain('S/ 13.50');
    expect(el.textContent).toContain('debe S/ 20.00');

    // Cambiar de período vuelve a calcular
    [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((b) => b.textContent?.includes('Mes pasado'))!
      .click();
    fixture.detectChanges();
    const again = http.expectOne((r) => r.url === '/api/grooming/commissions');
    expect(again.request.params.get('to')).not.toBe(fixtureWeek().to);
    again.flush({
      ...report,
      rows: [],
      lines: [],
      totals: { services: 0, paid: 0, pending: 0, commission: 0 },
    });
    fixture.detectChanges();
    expect(el.textContent).toContain('No hay servicios entregados en este período');
  });

  it('el groomer ve solo lo suyo, sin la tabla del equipo', () => {
    const fixture = render('GROOMER');
    http.expectOne((r) => r.url === '/api/grooming/commissions').flush(report);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Mis comisiones');
    expect(el.textContent).not.toContain('Por groomer');
  });
});

function fixtureWeek() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  return periodRange('week', today);
}
