import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { LabOrder } from '../../core/services/lab.models';
import { tick } from '../../shared/testing';
import { LabOrdersComponent } from './lab-orders.component';

const order = (extra: Partial<LabOrder> = {}): LabOrder => ({
  id: 1,
  code: 'EX-00001',
  status: 'RESULT_READY',
  destination: 'EXTERNAL',
  externalLab: 'Lab Central',
  labCost: 70,
  indication: 'Prequirúrgico',
  visitId: 5,
  pet: {
    id: 3,
    number: 3,
    name: 'Kira',
    species: 'DOG',
    breed: 'Labrador',
    sex: 'FEMALE',
    birthDate: '2019-05-01',
    weightKg: 24.5,
  },
  client: { id: 2, name: 'Ana Torres', phone: '987000333' },
  items: [
    { id: 1, name: 'Hemograma', careServiceId: 11, charged: true },
    { id: 2, name: 'Perfil bioquímico', careServiceId: 12, charged: true },
  ],
  total: 125,
  paid: 0,
  requestedAt: '2026-11-10T14:00:00Z',
  requestedBy: 'Dra. Ruiz',
  sampleAt: '2026-11-10T14:30:00Z',
  sampleBy: 'Carmen',
  resultAt: '2026-11-10T18:00:00Z',
  resultBy: 'Carmen',
  resultText: 'Hto 38 %',
  attachment: { id: 9, fileName: 'resultado.pdf', mime: 'application/pdf' },
  reviewedAt: null,
  reviewedBy: null,
  interpretation: null,
  notifiedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  waitingDays: null,
  overdue: false,
  ...extra,
});

describe('LabOrdersComponent (exámenes)', () => {
  let http: HttpTestingController;

  beforeAll(() => {
    // jsdom no trae <dialog>
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  function render(
    role: 'VET' | 'RECEPTION',
    orders: LabOrder[],
    visitId: number | null = null,
    showPatient = false,
  ) {
    TestBed.configureTestingModule({
      imports: [LabOrdersComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 9,
      fullName: 'Usuario',
      email: 'u@uywa.pe',
      role,
      mustChangePassword: false,
      clinic: { id: 1, name: 'Vet Sol', logoUrl: null },
    } as never);
    const fixture = TestBed.createComponent(LabOrdersComponent);
    fixture.componentRef.setInput('orders', orders);
    fixture.componentRef.setInput('visitId', visitId);
    fixture.componentRef.setInput('showPatient', showPatient);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const text = () => el.textContent!.replace(/\s+/g, ' ');
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(label),
      );
    return { fixture, el, text, button };
  }

  afterEach(() => http.verify());

  it('recepción ve el resultado pero no puede avisar al dueño hasta que el veterinario lo revise', () => {
    const { fixture, el, text, button } = render('RECEPTION', [order()]);
    expect(text()).toContain('Hemograma + Perfil bioquímico');
    // El detalle (resultado e indicación) se abre tocando la fila
    expect(text()).not.toContain('Hto 38 %');
    const row = el.querySelector<HTMLButtonElement>('[aria-controls="lab-detail-1"]')!;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    row.click();
    fixture.detectChanges();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain('Hto 38 %');
    expect(text()).toContain('Indicación: Prequirúrgico');
    expect(text()).toContain('Falta que el veterinario lo revise');
    expect(button('Revisar e interpretar')).toBeUndefined();
    expect(el.querySelector('a[href^="https://wa.me/"]')).toBeNull();
  });

  it('el veterinario interpreta y recién ahí aparece "Avisar al dueño"', async () => {
    const { fixture, el, button } = render('VET', [order()]);
    button('Revisar e interpretar')!.click();
    fixture.detectChanges();
    // Especie, raza, sexo, edad y peso: los valores normales dependen de eso
    expect(el.querySelector('[data-pet-facts]')!.textContent).toMatch(
      /Perro · Labrador · Hembra · \d+ años · 24.5 kg/,
    );
    const textarea = el.querySelector<HTMLTextAreaElement>('#lab-interpretation')!;
    textarea.value = 'Normal, apto para cirugía';
    textarea.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('#lab-review-form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/lab-orders/1/review');
    expect(req.request.body).toEqual({ interpretation: 'Normal, apto para cirugía' });
    req.flush(
      order({
        status: 'REVIEWED',
        interpretation: 'Normal, apto para cirugía',
        reviewedBy: 'Dra. Ruiz',
      }),
    );
    fixture.componentRef.setInput('orders', [
      order({
        status: 'REVIEWED',
        interpretation: 'Normal, apto para cirugía',
        reviewedBy: 'Dra. Ruiz',
      }),
    ]);
    fixture.detectChanges();
    const wa = el.querySelector<HTMLAnchorElement>('a[href^="https://wa.me/51987000333"]')!;
    expect(wa.textContent).toContain('Avisar al dueño');
  });

  it('pedir un perfil desde la atención: varios exámenes en un solo pedido', async () => {
    const { fixture, el, button } = render('VET', [], 5);
    fixture.componentInstance.openOrder();
    fixture.detectChanges();
    await tick();
    http
      .expectOne((r) => r.url === '/api/care-services')
      .flush([
        {
          id: 11,
          name: 'Hemograma',
          category: 'LAB',
          price: 45,
          igv: 'TAXED',
          durationMin: null,
          active: true,
          sizePrices: [],
          supplies: [],
        },
        {
          id: 12,
          name: 'Perfil bioquímico',
          category: 'LAB',
          price: 80,
          igv: 'TAXED',
          durationMin: null,
          active: true,
          sizePrices: [],
          supplies: [],
        },
        {
          id: 13,
          name: 'Consulta',
          category: 'CONSULTATION',
          price: 50,
          igv: 'TAXED',
          durationMin: null,
          active: true,
          sizePrices: [],
          supplies: [],
        },
      ]);
    await tick();
    fixture.detectChanges();
    expect(el.querySelector('[data-exam="13"]')).toBeNull();
    el.querySelector<HTMLElement>('[data-exam="11"]')!.click();
    el.querySelector<HTMLElement>('[data-exam="12"]')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('S/ 125.00 se cobran en caja');
    button('Pedir 2 exámenes')!.click();
    const req = http.expectOne('/api/visits/5/lab-orders');
    expect(req.request.body).toMatchObject({
      careServiceIds: [11, 12],
      destination: 'IN_HOUSE',
      charge: true,
    });
    req.flush(order({ status: 'REQUESTED' }));
  });

  it('en Exámenes agrupa por mascota y atención, con enlace a la atención', () => {
    const { el, text } = render(
      'RECEPTION',
      [
        order({ id: 1, status: 'SAMPLE_TAKEN', visitId: 5 }),
        order({
          id: 2,
          status: 'SAMPLE_TAKEN',
          visitId: 7,
          pet: { ...order().pet, id: 4, name: 'Rufo' },
        }),
        order({ id: 3, status: 'REQUESTED', visitId: 5 }),
      ],
      null,
      true,
    );
    const groups = el.querySelectorAll('section');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelectorAll('li')).toHaveLength(2);
    expect(groups[0].querySelector('a[href="/atenciones/5"]')?.textContent).toContain('Atención');
    expect(groups[0].querySelector('a[href="/mascotas/3"]')?.textContent).toContain('Kira');
    expect(groups[0].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Perro');
    expect(text()).toContain('Rufo');
  });

  it('una sola acción por fila y ⋯ según el rol: recepción no cancela', () => {
    const r = render('RECEPTION', [
      order({ id: 1, status: 'REQUESTED' }),
      order({ id: 2, status: 'SAMPLE_TAKEN', overdue: true, waitingDays: 4 }),
    ]);
    expect(r.button('Registrar muestra')).toBeDefined();
    expect(r.text()).toContain('4 días · llama al lab');
    // Muestra tomada: recepción no tiene nada más que hacer, sin ⋯
    expect(r.el.querySelector('[aria-controls="lab-menu-2"]')).toBeNull();
    r.el.querySelector<HTMLButtonElement>('[aria-controls="lab-menu-1"]')!.click();
    r.fixture.detectChanges();
    const menu = r.el.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain('Subir resultado ahora');
    expect(menu.textContent).not.toContain('Cancelar');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    r.fixture.detectChanges();
    expect(r.el.querySelector('[role="menu"]')).toBeNull();
  });

  it('el veterinario cancela un examen pagado: el cobro se queda y se lo dice', () => {
    const { fixture, el } = render('VET', [order({ status: 'SAMPLE_TAKEN', paid: 125 })]);
    el.querySelector<HTMLButtonElement>('[aria-controls="lab-menu-1"]')!.click();
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((b) => b.textContent?.includes('Cancelar examen'))!
      .click();
    fixture.detectChanges();
    expect(el.querySelector('[data-cancel-note]')!.textContent).toContain('Ya se cobró S/ 125.00');
    const reason = el.querySelector<HTMLInputElement>('#lab-cancel')!;
    reason.value = 'El laboratorio perdió la muestra';
    reason.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('#lab-cancel-form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/lab-orders/1/cancel');
    expect(req.request.body).toEqual({ reason: 'El laboratorio perdió la muestra' });
    req.flush(order({ status: 'CANCELLED', paid: 125 }));
  });

  it('por revisar: "Cambiar resultado" en ⋯; revisado y avisado ya no tiene acciones', () => {
    const r = render('RECEPTION', [
      order({ id: 1 }),
      order({
        id: 2,
        status: 'REVIEWED',
        interpretation: 'Leucocitos algo altos',
        notifiedAt: '2026-11-11T15:00:00Z',
      }),
    ]);
    r.el.querySelector<HTMLButtonElement>('[aria-controls="lab-menu-1"]')!.click();
    r.fixture.detectChanges();
    expect(r.el.querySelector('[role="menu"]')!.textContent).toContain('Cambiar resultado');
    expect(r.el.querySelector('[aria-controls="lab-menu-2"]')).toBeNull();
    expect(r.text()).toContain('Médico: Leucocitos algo altos');
    expect(r.text()).toContain('Dueño avisado 11/11/2026');
  });

  it('subir resultado: elegir archivo muestra el nombre y se puede quitar', () => {
    const { fixture, el, button } = render('RECEPTION', [
      order({ status: 'SAMPLE_TAKEN', resultText: null, resultAt: null }),
    ]);
    button('Subir resultado')!.click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#lab-file')!;
    const file = new File(['%PDF'], 'hemograma.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.textContent).toContain('hemograma.pdf');
    el.querySelector<HTMLButtonElement>('[aria-label="Quitar archivo"]')!.click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('hemograma.pdf');
    // Sin archivo ni valores: pide uno de los dos
    el.querySelector<HTMLFormElement>('#lab-result-form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(el.textContent).toContain('Sube el archivo del resultado o escribe los valores');
  });
});
