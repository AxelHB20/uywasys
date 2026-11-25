import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { LabOrder, LabOrderPage } from '../../core/services/lab.models';
import { tick } from '../../shared/testing';
import { LabOrdersPage } from './lab-orders.page';

const order = (id: number, extra: Partial<LabOrder> = {}): LabOrder => ({
  id,
  code: `EX-0000${id}`,
  status: 'SAMPLE_TAKEN',
  destination: 'IN_HOUSE',
  externalLab: null,
  labCost: null,
  indication: null,
  visitId: 5,
  pet: {
    id: 3,
    number: 3,
    name: 'Kira',
    species: 'DOG',
    breed: null,
    sex: null,
    birthDate: null,
    weightKg: null,
  },
  client: { id: 2, name: 'Ana Torres', phone: '987000333' },
  items: [{ id: id, name: 'Hemograma', careServiceId: 11, charged: false }],
  total: 0,
  paid: 0,
  requestedAt: '2026-11-19T15:00:00Z',
  requestedBy: 'Dra. Ruiz',
  sampleAt: null,
  sampleBy: null,
  resultAt: null,
  resultBy: null,
  resultText: null,
  attachment: null,
  reviewedAt: null,
  reviewedBy: null,
  interpretation: null,
  notifiedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  waitingDays: 0,
  overdue: false,
  ...extra,
});

const page = (items: LabOrder[], extra: Partial<LabOrderPage> = {}): LabOrderPage => ({
  items,
  hasMore: false,
  counts: { pending: items.length, ready: 0, reviewed: 3, overdue: 0, toNotify: 1 },
  ...extra,
});

describe('LabOrdersPage (Exámenes)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      imports: [LabOrdersPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 9,
      fullName: 'Carmen',
      email: 'c@uywa.pe',
      role: 'RECEPTION',
      mustChangePassword: false,
      clinic: { id: 1, name: 'Vet Sol', logoUrl: null },
    } as never);
    const fixture = TestBed.createComponent(LabOrdersPage);
    fixture.detectChanges();
    await tick();
    const el: HTMLElement = fixture.nativeElement;
    const text = () => el.textContent!.replace(/\s+/g, ' ');
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(label),
      );
    const flush = async (body: LabOrderPage, match = (_: URLSearchParams) => true) => {
      const req = http.expectOne(
        (r) => r.url === '/api/lab-orders' && match(new URLSearchParams(r.params.toString())),
      );
      req.flush(body);
      await tick();
      fixture.detectChanges();
      return req;
    };
    return { fixture, el, text, button, flush };
  }

  afterEach(() => http.verify());

  it('botones con número, aviso de demorados y "Ver más"', async () => {
    const r = await render();
    const first = await r.flush(
      page([order(1, { overdue: true, waitingDays: 4 }), order(2)], {
        hasMore: true,
        counts: { pending: 3, ready: 2, reviewed: 5, overdue: 1, toNotify: 0 },
      }),
    );
    expect(first.request.params.get('status')).toBe('pending');
    expect(first.request.params.get('take')).toBe('50');
    const pressed = r.el.querySelector('[aria-pressed="true"]')!;
    expect(pressed.textContent!.replace(/\s+/g, ' ')).toContain('Esperando 3');
    expect(r.el.querySelector('[role="tablist"]')).toBeNull();
    expect(r.text()).toContain('1 examen demorado');
    r.button('Ver más')!.click();
    await r.flush(page([order(3)]), (p) => p.get('skip') === '2');
    expect(r.el.querySelectorAll('li')).toHaveLength(3);
    expect(r.button('Ver más')).toBeUndefined();
  });

  it('buscar y filtrar por lugar piden al servidor; sin resultados ofrece limpiar', async () => {
    const r = await render();
    await r.flush(page([order(1)]));
    const search = r.el.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'kira';
    search.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    r.fixture.detectChanges();
    await r.flush(
      page([], { counts: { pending: 0, ready: 0, reviewed: 0, overdue: 0, toNotify: 0 } }),
      (p) => p.get('q') === 'kira',
    );
    expect(r.text()).toContain('Ningún examen coincide');
    const select = r.el.querySelector<HTMLSelectElement>('select')!;
    select.value = 'EXTERNAL';
    select.dispatchEvent(new Event('change'));
    r.fixture.detectChanges();
    await r.flush(page([]), (p) => p.get('destination') === 'EXTERNAL' && p.get('q') === 'kira');
    r.button('Limpiar búsqueda')!.click();
    r.fixture.detectChanges();
    await r.flush(page([order(1)]), (p) => !p.has('q') && !p.has('destination'));
    expect(r.el.querySelectorAll('li')).toHaveLength(1);
  });

  it('por revisar vacío dice qué hacer y lleva a los que esperan', async () => {
    const r = await render();
    await r.flush(page([order(1)]));
    r.button('Por revisar')!.click();
    r.fixture.detectChanges();
    await r.flush(
      page([], { counts: { pending: 4, ready: 0, reviewed: 3, overdue: 0, toNotify: 0 } }),
      (p) => p.get('status') === 'ready',
    );
    expect(r.text()).toContain('No hay resultados por revisar');
    expect(r.text()).toContain('Hay 4 exámenes esperando resultado');
    r.button('Ver los que esperan')!.click();
    r.fixture.detectChanges();
    await r.flush(page([order(1)]), (p) => p.get('status') === 'pending');
  });
});
