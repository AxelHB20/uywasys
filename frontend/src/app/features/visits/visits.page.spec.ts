import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { VisitPage as VisitPageData, VisitSummary } from '../../core/services/visits.models';
import { limaDate } from '../../shared/utils/records';
import { VisitsPage } from './visits.page';

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

function row(overrides: Partial<VisitSummary>): VisitSummary {
  return {
    id: 1,
    type: 'CONSULTATION',
    status: 'OPEN',
    reason: 'Vómitos',
    weightKg: null,
    diagnosis: null,
    diagnosisDefinitive: false,
    openedAt: now.toISOString(),
    closedAt: null,
    queueEntryId: null,
    pet: { id: 1, number: 1, name: 'Firulais', species: 'DOG' },
    client: { id: 1, number: 1, name: 'Ana Quispe' },
    attendedBy: { id: 1, fullName: 'Dra. Ana' },
    total: 0,
    ...overrides,
  };
}

describe('VisitsPage (lista de atenciones)', () => {
  let http: HttpTestingController;

  function render(role: 'VET' | 'GROOMER' = 'VET') {
    TestBed.configureTestingModule({
      imports: [VisitsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role,
      mustChangePassword: false,
    } as never);
    const fixture = TestBed.createComponent(VisitsPage);
    fixture.detectChanges();
    http.expectOne('/api/appointments/staff').flush([
      { id: 1, fullName: 'Dra. Ana', role: 'VET' },
      { id: 2, fullName: 'Dr. Luis', role: 'VET' },
      { id: 3, fullName: 'Rosa', role: 'GROOMER' },
    ]);
    return fixture;
  }

  const lastList = () => {
    const req = http.expectOne((r) => r.url === '/api/visits');
    return req;
  };
  const flush = (page: Partial<VisitPageData>) =>
    lastList().flush({ items: [], total: 0, page: 1, pageSize: 20, ...page });

  afterEach(() => http.verify());

  it('por defecto: consultas abiertas; la mascota y el diagnóstico van primero', async () => {
    const fixture = render();
    const req = lastList();
    expect(req.request.params.get('type')).toBe('CONSULTATION');
    expect(req.request.params.get('status')).toBe('OPEN');
    req.flush({
      items: [
        row({ id: 1, diagnosis: 'Gastroenteritis', total: 100, pending: 60 }),
        row({
          id: 2,
          pet: { id: 2, number: 2, name: 'Michi', species: 'CAT' },
          status: 'CLOSED',
          total: 80,
          pending: 0,
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      stale: 0,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const rows = [...el.querySelectorAll('li a')].map((a) => a.textContent!.replace(/\s+/g, ' '));
    // Abierta: todavía no se cobra, se dice lo que lleva
    expect(rows[0]).toMatch(/Firulais Gastroenteritis.*En atención.*Lleva S\/ 100\.00/);
    expect(rows[0]).not.toContain('Por cobrar');
    expect(rows[1]).toMatch(/Michi Vómitos.*Cerrada.*Pagada · S\/ 80\.00/);
    expect(el.querySelector('h2')?.textContent).toContain('Hoy');
  });

  it('nombra las abiertas de otros días y ofrece verlas', async () => {
    const fixture = render();
    flush({
      items: [
        row({ id: 3, openedAt: daysAgo(3) }),
        row({ id: 4, type: 'HOSPITALIZATION', openedAt: daysAgo(5) }),
      ],
      total: 2,
      stale: 1,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Abierta hace 3 días');
    expect(text).toContain('Internado');
    expect(text).toContain('1 atención sigue abierta desde días anteriores');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Ver cuáles'))!.click();
    fixture.detectChanges();
    const req = lastList();
    expect(req.request.params.get('stale')).toBe('true');
    expect(req.request.params.has('status')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 20, stale: 1 });
  });

  it('veterinario y día se mandan como filtros; siempre pide consultas', async () => {
    const fixture = render();
    flush({});
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    // Veterinarios de consultas (no el groomer)
    const vet = el.querySelector<HTMLSelectElement>('#visits-vet')!;
    expect([...vet.options].map((o) => o.text.trim())).toEqual([
      'Todos los veterinarios',
      'Dra. Ana',
      'Dr. Luis',
    ]);
    vet.value = '2';
    vet.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const byVet = lastList();
    expect(byVet.request.params.get('vetId')).toBe('2');
    byVet.flush({ items: [], total: 0, page: 1, pageSize: 20 });

    const day = el.querySelector<HTMLInputElement>('#visits-day')!;
    day.value = limaDate(now);
    day.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const byDay = lastList();
    expect(byDay.request.params.get('day')).toBe(limaDate(now));
    byDay.flush({ items: [], total: 0, page: 1, pageSize: 20 });

    expect(byDay.request.params.get('type')).toBe('CONSULTATION');
    // El grooming no se mezcla: se maneja en su tablero
    expect(el.querySelector('[aria-label="Tipo de atención"]')).toBeNull();
    expect(el.textContent).not.toContain('Grooming');
  });

  it('tolera un servidor anterior (sin por cobrar ni olvidadas)', async () => {
    const fixture = render();
    lastList().flush({
      items: [row({ status: 'CLOSED', total: 45 })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('S/ 45.00');
    expect(text).not.toContain('De otros días');
  });

  it('si el servidor falla, muestra el error en vez de romperse', async () => {
    const fixture = render();
    lastList().flush('error', { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar las atenciones.');
  });

  it('cerrada con saldo: "Por cobrar"; internamiento cerrado con su etiqueta; y contador', async () => {
    const fixture = render();
    lastList().flush({
      items: [
        row({
          id: 3,
          status: 'CLOSED',
          type: 'HOSPITALIZATION',
          diagnosis: 'Piometra',
          total: 300,
          pending: 120,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      stale: 0,
      open: 4,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const text = el.querySelector('li a')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Internamiento');
    expect(text).toContain('Por cobrar S/ 120.00');
    const open = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Abiertas'),
    )!;
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(open.textContent).toContain('4');
    expect(el.querySelector('[role="tab"]')).toBeNull();
  });
});
