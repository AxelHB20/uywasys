import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PatientPage, PatientRow } from '../../core/services/patients.models';
import { PatientsPage } from './patients.page';

function row(overrides: Partial<PatientRow>): PatientRow {
  return {
    id: 1,
    number: 26,
    name: 'Firulais',
    species: 'DOG',
    breed: 'Yorkshire',
    sex: 'FEMALE',
    birthDate: null,
    birthDateEstimated: false,
    deceasedAt: null,
    active: true,
    allergies: null,
    aggressive: false,
    client: { id: 7, name: 'Yesenia Mendoza Ríos', phone: '945381778' },
    lastVisit: null,
    openVisit: null,
    overdue: 0,
    ...overrides,
  };
}

describe('PatientsPage (Historias clínicas)', () => {
  let http: HttpTestingController;

  function render() {
    TestBed.configureTestingModule({
      imports: [PatientsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PatientsPage);
    fixture.detectChanges();
    return fixture;
  }
  const next = () => http.expectOne((r) => r.url === '/api/pets');
  const page = (p: Partial<PatientPage>): PatientPage => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    counts: { ACTIVE: 0, INACTIVE: 0 },
    ...p,
  });
  const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');

  afterEach(() => http.verify());

  it('lista los activos con su historia, dueño, última atención y avisos', async () => {
    const fixture = render();
    const req = next();
    expect(req.request.params.get('status')).toBe('ACTIVE');
    expect(req.request.params.get('sort')).toBe('RECENT');
    req.flush(
      page({
        items: [
          row({
            allergies: 'Penicilina',
            aggressive: true,
            overdue: 2,
            openVisit: { id: 9, type: 'HOSPITALIZATION' },
            lastVisit: {
              id: 9,
              type: 'HOSPITALIZATION',
              openedAt: '2026-10-08T15:00:00Z',
              diagnosis: 'Gastroenteritis aguda',
              reason: 'Vómitos',
              attendedBy: 'Dra. Lucía Ruiz',
            },
          }),
          row({ id: 2, number: 55, name: 'Bruno', species: 'CAT', breed: null, sex: 'MALE' }),
        ],
        total: 2,
        counts: { ACTIVE: 2, INACTIVE: 1 },
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const rows = [...el.querySelectorAll<HTMLAnchorElement>('ul[aria-label="Pacientes"] a')];
    expect(rows[0].getAttribute('href')).toBe('/mascotas/1');
    const first = text(rows[0]);
    expect(first).toContain('HC-00026');
    expect(first).toContain('Perro · Hembra');
    expect(first).toContain('Yorkshire');
    expect(first).toContain('Yesenia Mendoza Ríos');
    expect(first).toContain('945 381 778');
    expect(first).toContain('Gastroenteritis aguda');
    // Se ven 2 avisos y el resto se resume, sin perderse para el lector de pantalla
    expect(first).toContain('Internado');
    expect(first).toContain('Agresivo');
    expect(first).toContain('+2');
    expect(rows[0].getAttribute('aria-label')).toContain('Alergia: Penicilina');
    expect(rows[0].getAttribute('aria-label')).toContain('2 refuerzos vencidos');
    expect(text(rows[1])).toContain('Sin atenciones todavía');
    expect(text(el)).toContain('Mostrando 1–2 de 2 pacientes');
    expect(text(el.querySelector('[aria-label="Estado del paciente"]')!)).toContain('Inactivos 1');
  });

  it('busca, filtra por especie y ordena', async () => {
    const fixture = render();
    next().flush(page({}));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const input = el.querySelector<HTMLInputElement>('#patients-q')!;
    input.value = 'HC-00041';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    fixture.detectChanges();
    const byQ = next();
    expect(byQ.request.params.get('q')).toBe('HC-00041');
    byQ.flush(page({}));
    fixture.detectChanges();

    [...el.querySelectorAll('[aria-label="Especie"] button')]
      .find((b) => b.textContent?.includes('Gatos'))!
      .dispatchEvent(new Event('click'));
    fixture.detectChanges();
    const bySpecies = next();
    expect(bySpecies.request.params.get('species')).toBe('CAT');
    bySpecies.flush(page({}));
    fixture.detectChanges();

    const sort = el.querySelector<HTMLSelectElement>('#patients-sort')!;
    sort.value = 'NAME';
    sort.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const bySort = next();
    expect(bySort.request.params.get('sort')).toBe('NAME');
    bySort.flush(page({}));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el)).toContain('Ningún paciente coincide con la búsqueda');
  });

  it('inactivos: el motivo va en gris, sin alarma (fallecido o inactivo)', async () => {
    const fixture = render();
    next().flush(page({}));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('[aria-label="Estado del paciente"] button')]
      .find((b) => b.textContent?.includes('Inactivos'))!
      .dispatchEvent(new Event('click'));
    fixture.detectChanges();
    const req = next();
    expect(req.request.params.get('status')).toBe('INACTIVE');
    req.flush(
      page({
        items: [
          row({ deceasedAt: '2026-09-01', overdue: 0 }),
          row({ id: 2, name: 'Toby', active: false }),
        ],
        total: 2,
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const rows = [...el.querySelectorAll('ul[aria-label="Pacientes"] a')].map((a) =>
      text(a as HTMLElement),
    );
    expect(rows[0]).toContain('Fallecido · 01/09/2026');
    expect(rows[1]).toContain('Inactivo');
    const tag = [...el.querySelectorAll('ul span.rounded-full')].find(
      (s) => s.textContent?.trim() === 'Inactivo',
    )!;
    expect(tag.className).toContain('bg-slate-100');
  });

  it('si falla, ofrece reintentar', async () => {
    const fixture = render();
    next().flush('error', { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(text(el)).toContain('No se pudieron cargar las historias.');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar'))!.click();
    TestBed.tick();
    next().flush(page({}));
  });
});
