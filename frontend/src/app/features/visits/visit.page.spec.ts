import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { CareService } from '../../core/services/inventory.models';
import { Charge, VisitDetail } from '../../core/services/visits.models';
import { stubDialog, tick } from '../../shared/testing';
import { toProductOptions } from '../../shared/catalog/catalog-options';
import { AUTOSAVE_MS, VisitPage } from './visit.page';

const bath: Charge = {
  id: 1,
  kind: 'SERVICE',
  visitId: 5,
  pet: { id: 3, name: 'Toby' },
  careServiceId: 9,
  productId: null,
  presentationId: null,
  description: 'Baño medicado',
  quantity: 1,
  unitPrice: 45,
  discount: 0,
  discountReason: null,
  igvAffectation: 'TAXED',
  taxableAmount: 38.14,
  igvAmount: 6.86,
  total: 45,
  paidAmount: 0,
  balance: 45,
  prescriptionRef: null,
  status: 'PENDING',
  createdAt: '2026-10-28T15:05:00Z',
  createdBy: { id: 1, fullName: 'Ana' },
  voidedAt: null,
  voidReason: null,
  shortages: [{ product: 'Champú clorhexidina', baseUnit: 'ML', quantity: 30, resolved: false }],
};

function visit(overrides: Partial<VisitDetail> = {}): VisitDetail {
  return {
    id: 5,
    type: 'CONSULTATION',
    status: 'OPEN',
    reason: 'Vacuna anual',
    weightKg: null,
    temperatureC: null,
    notes: null,
    anamnesis: null,
    heartRate: null,
    respiratoryRate: null,
    capillaryRefillS: null,
    mucosa: null,
    hydration: null,
    bodyCondition: null,
    physicalExam: null,
    diagnosis: null,
    diagnosisDefinitive: false,
    immunizations: [],
    prescriptions: [],
    grooming: null,
    hospitalization: null,
    openedAt: '2026-10-28T15:00:00Z',
    closedAt: null,
    queueEntryId: 2,
    cancelReason: null,
    closedBy: null,
    pet: {
      id: 3,
      number: 45,
      name: 'Toby',
      species: 'DOG',
      breed: 'Mestizo',
      sex: 'MALE',
      birthDate: null,
      weightKg: 12,
      allergies: 'Penicilina',
      aggressive: true,
      aggressiveNote: 'Bozal para uñas',
    },
    client: { id: 7, number: 12, name: 'Rosa Quispe', phone: '987654321' },
    attendedBy: { id: 1, fullName: 'Ana' },
    charges: [bath],
    addenda: [],
    total: 45,
    ...overrides,
  };
}

const castration: CareService = {
  id: 11,
  name: 'Castración felina',
  category: 'SURGERY',
  price: 180,
  igv: 'TAXED',
  durationMin: 90,
  active: true,
  sizePrices: [],
  supplies: [
    { productId: 4, name: 'Ketamina 50 mg/ml', baseUnit: 'ML', quantity: 2, controlled: true },
  ],
};

const haircut: CareService = {
  ...castration,
  id: 12,
  name: 'Corte de pelo',
  category: 'GROOMING',
  price: 35,
  supplies: [],
};

describe('VisitPage (atención)', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  function render(data: VisitDetail, role: 'VET' | 'CASHIER' | 'RECEPTION' = 'VET') {
    TestBed.configureTestingModule({
      imports: [VisitPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana',
      email: 'ana@uywa.pe',
      role,
      mustChangePassword: false,
      clinic: { id: 1, name: 'Huellitas', logoUrl: null },
    } as never);
    const fixture = TestBed.createComponent(VisitPage);
    fixture.componentRef.setInput('id', '5');
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/care-services').flush([castration, haircut]);
    http.expectOne('/api/visits/5').flush(data);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    // Presupuestos aceptados de la mascota (se piden al cargar una atención abierta)
    http.match((r) => r.url === '/api/estimates').forEach((r) => r.flush([]));
    // Recetas frecuentes (las pide el formulario de receta)
    http.match((r) => r.url === '/api/clinical-templates').forEach((r) => r.flush([]));
    // Archivos y consentimientos de la mascota
    http
      .match((r) => /^\/api\/pets\/\d+\/(attachments|consents)$/.test(r.url))
      .forEach((r) => r.flush([]));
    // Exámenes de la atención
    http.match((r) => /^\/api\/visits\/\d+\/lab-orders$/.test(r.url)).forEach((r) => r.flush([]));
    // Diagnósticos frecuentes (sugerencias)
    http.match((r) => r.url === '/api/visits/diagnoses').forEach((r) => r.flush([]));
    // Contexto del paciente (atención y peso anteriores, refuerzos vencidos)
    http
      .match((r) => /^\/api\/visits\/\d+\/context$/.test(r.url))
      .forEach((r) => r.flush({ previous: null, previousWeight: null, overdue: [] }));
    http.verify();
  });

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) =>
        !b.closest('dialog') &&
        b.textContent?.trim().startsWith(text) &&
        !b.textContent.includes('plantilla'),
    )!;

  it('carga un presupuesto aceptado sin salir de la atención (con receta si lleva controlado)', async () => {
    const fixture = render(visit());
    const el: HTMLElement = fixture.nativeElement;
    http
      .expectOne((r) => r.url === '/api/estimates')
      .flush([
        {
          id: 7,
          code: 'PR-00007',
          title: 'Castración canina',
          total: 350,
          items: [
            { id: 1, description: 'Castración canina', quantity: 1, total: 330, controlled: false },
            { id: 2, description: 'Ketamina 50 mg/ml', quantity: 2, total: 20, controlled: true },
          ],
        },
      ]);
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Toby tiene un presupuesto aceptado');
    expect(el.querySelector('a[href="/presupuestos/7"]')?.textContent).toContain('Ver detalle');
    button(el, 'Cargar a esta atención').click();
    fixture.detectChanges();

    const confirm = () =>
      [...el.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) =>
        b.textContent?.includes('Cargar S/ 350.00'),
      )!;
    // Lleva un controlado: sin receta no se envía
    confirm().click();
    fixture.detectChanges();
    http.expectNone('/api/estimates/7/convert');
    expect(el.textContent).toContain('Escribe el número de la receta retenida');

    const rx = el.querySelector<HTMLInputElement>('#estimate-rx')!;
    rx.value = 'RX-00012';
    rx.dispatchEvent(new Event('input'));
    confirm().click();
    const req = http.expectOne('/api/estimates/7/convert');
    expect(req.request.body).toEqual({ visitId: 5, prescriptionRef: 'RX-00012' });
    req.flush({ id: 7, status: 'CONVERTED' });
    // Se queda en la atención y la vuelve a leer para mostrar los cargos nuevos
    http.expectOne('/api/visits/5').flush(visit({ total: 395 }));
    await tick();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Toby tiene un presupuesto aceptado');
  });

  it('muestra las alertas de la mascota, los cargos y el insumo sin stock', () => {
    const el: HTMLElement = render(visit()).nativeElement;
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Agresivo.');
    expect(el.textContent).toContain('Alergias: Penicilina');
    expect(el.textContent).toContain('HC-00045');
    expect(el.textContent).toContain('Baño medicado');
    expect(el.textContent).toContain('30 ml de Champú clorhexidina');
    expect(el.textContent).toContain('S/ 45.00');
  });

  it('agrega un servicio con insumo controlado: exige receta antes de enviar', async () => {
    const fixture = render(visit({ charges: [], total: 0 }));
    const el: HTMLElement = fixture.nativeElement;
    const search = el.querySelector<HTMLInputElement>('#v-search')!;
    search.value = 'castra';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http
      .expectOne((r) => r.url === '/api/inventory/products')
      .flush({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    fixture.detectChanges();
    [...el.querySelectorAll('#v-results button')]
      .find((b) => b.textContent?.includes('Castración felina'))!
      .dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await tick();

    button(el, 'Registrar').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Indica el N.º de receta');

    const rx = el.querySelector<HTMLInputElement>('#line-rx-0')!;
    rx.value = 'R-001';
    rx.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(el, 'Registrar').click();
    const req = http.expectOne('/api/charges');
    expect(req.request.body).toEqual({
      visitId: 5,
      items: [
        {
          careServiceId: 11,
          productId: undefined,
          presentationId: undefined,
          quantity: 1,
          discount: 0,
          discountReason: null,
          prescriptionRef: 'R-001',
        },
      ],
    });
    req.flush({ charges: [], shortages: [] });
    http.expectOne('/api/visits/5').flush(visit());
  });

  it('en una consulta, el baño o corte no se carga: lleva a Grooming sin cerrarla', async () => {
    const fixture = render(visit({ charges: [], total: 0 }));
    const el: HTMLElement = fixture.nativeElement;
    const search = el.querySelector<HTMLInputElement>('#v-search')!;
    search.value = 'corte';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http
      .expectOne((r) => r.url === '/api/inventory/products')
      .flush({ items: [], total: 0, page: 1, pageSize: 20 });
    fixture.detectChanges();
    expect(el.querySelector('#v-results')).toBeNull();
    const note = el.querySelector('[role="note"]')!;
    expect(note.textContent).toContain('Corte de pelo se registra en Grooming');
    expect(note.querySelector('a')!.getAttribute('href')).toContain('/grooming/ingreso?petId=');
  });

  it('cerrar pide confirmación y avisa lo que queda por cobrar', async () => {
    const fixture = render(visit());
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Cerrar atención').click();
    fixture.detectChanges();
    await tick();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('S/ 45.00');
    [...dialog.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Cerrar atención'))!
      .click();
    http
      .expectOne((r) => r.method === 'POST' && r.url === '/api/visits/5/close')
      .flush(
        visit({
          status: 'CLOSED',
          closedAt: '2026-10-28T15:30:00Z',
          closedBy: { id: 1, fullName: 'Ana' },
        }),
      );
    fixture.detectChanges();
    expect(el.textContent).toContain('Cerrada');
    expect(el.querySelector<HTMLTextAreaElement>('#v-notes')!.disabled).toBe(true);
    expect(el.querySelector('#v-addendum')).not.toBeNull();
    expect(el.querySelector('#v-search')).toBeNull();
  });

  it('guarda la consulta SOAP con sus constantes y el diagnóstico', () => {
    const fixture = render(visit({ charges: [], total: 0 }));
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Anamnesis');
    expect(el.textContent).toContain('Plan y tratamiento');
    const type = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('#v-anamnesis', 'Vómitos desde ayer');
    type('#v-fc', '110');
    type('#v-tllc', '1.5');
    type('#v-dx', 'Gastritis');
    el.querySelector<HTMLInputElement>('input[formcontrolname="diagnosisDefinitive"]')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Cambios sin guardar');
    button(el, 'Guardar').click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/visits/5' });
    expect(req.request.body).toMatchObject({
      anamnesis: 'Vómitos desde ayer',
      heartRate: 110,
      capillaryRefillS: 1.5,
      respiratoryRate: null,
      diagnosis: 'Gastritis',
      diagnosisDefinitive: true,
    });
    req.flush(visit({ charges: [], total: 0, diagnosis: 'Gastritis' }));
  });

  it('en grooming no muestra el SOAP, solo signos y notas', () => {
    const el: HTMLElement = render(visit({ type: 'GROOMING' })).nativeElement;
    expect(el.textContent).not.toContain('Anamnesis');
    expect(el.querySelector('#v-fc')).toBeNull();
    expect(el.textContent).toContain('Notas del servicio');
  });

  it('registra una vacuna en la atención sin perder el SOAP sin guardar', () => {
    const fixture = render(visit({ charges: [], total: 0 }));
    const el: HTMLElement = fixture.nativeElement;
    const dx = el.querySelector<HTMLInputElement>('#v-dx')!;
    dx.value = 'Sano';
    dx.dispatchEvent(new Event('input'));
    button(el, 'Aplicar').click();
    fixture.detectChanges();
    const name = el.querySelector<HTMLInputElement>('input[maxlength="100"]')!;
    name.value = 'Séxtuple';
    name.dispatchEvent(new Event('input'));
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === '1 año')!
      .click();
    fixture.detectChanges();
    button(el, 'Registrar aplicación').click();
    const req = http.expectOne('/api/immunizations');
    expect(req.request.body).toMatchObject({
      petId: 3,
      visitId: 5,
      kind: 'VACCINE',
      name: 'Séxtuple',
    });
    expect(req.request.body.nextDueAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    req.flush({
      id: 70,
      petId: 3,
      visitId: 5,
      kind: 'VACCINE',
      name: 'Séxtuple',
      laboratory: null,
      batchNumber: null,
      appliedAt: '2026-10-28',
      nextDueAt: req.request.body.nextDueAt,
      external: false,
      externalClinic: null,
      notes: null,
      createdAt: '2026-10-28T15:10:00Z',
      voidedAt: null,
      voidReason: null,
      appliedBy: { id: 1, fullName: 'Ana', licenseNumber: 'CMVP-1' },
    });
    fixture.detectChanges();
    expect(el.textContent).toContain('CMVP CMVP-1');
    expect(el.querySelector<HTMLInputElement>('#v-dx')!.value).toBe('Sano');
  });

  it('emite una receta con un medicamento escrito a mano y recarga cargos y recetas', async () => {
    const fixture = render(visit({ charges: [], total: 0 }), 'VET');
    const el: HTMLElement = fixture.nativeElement;
    button(el, 'Nueva receta').click();
    fixture.detectChanges();
    const search = el.querySelector<HTMLInputElement>('#rx-search')!;
    search.value = 'Omeprazol 20 mg';
    search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const type = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    // Sin dosis no se envía
    button(el, 'Emitir receta').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Completa dosis, frecuencia y duración');
    type('#rx-dose-0', '1/2 cápsula');
    type('#rx-freq-0', 'Cada 24 horas');
    type('#rx-dur-0', '7 días');
    fixture.detectChanges();
    button(el, 'Emitir receta').click();
    const req = http.expectOne({ method: 'POST', url: '/api/visits/5/prescriptions' });
    expect(req.request.body).toEqual({
      notes: null,
      items: [
        {
          productId: undefined,
          presentationId: undefined,
          drug: 'Omeprazol 20 mg',
          dose: '1/2 cápsula',
          route: null,
          frequency: 'Cada 24 horas',
          duration: '7 días',
          instructions: null,
          dispenseQuantity: null,
        },
      ],
    });
    req.flush({ id: 9, code: 'RX-00001' });
    http.expectOne('/api/visits/5').flush(
      visit({
        charges: [],
        total: 0,
        prescriptions: [
          {
            id: 9,
            code: 'RX-00001',
            visitId: 5,
            notes: null,
            createdAt: '2026-10-28T15:20:00Z',
            voidedAt: null,
            voidReason: null,
            vet: { id: 1, fullName: 'Ana', licenseNumber: 'CMVP-1' },
            items: [
              {
                id: 1,
                productId: null,
                presentationId: null,
                drug: 'Omeprazol 20 mg',
                dose: '1/2 cápsula',
                route: null,
                frequency: 'Cada 24 horas',
                duration: '7 días',
                instructions: null,
                controlled: false,
                dispensedQuantity: null,
                presentation: null,
                charge: null,
              },
            ],
          },
        ],
      }),
    );
    fixture.detectChanges();
    expect(el.textContent).toContain('RX-00001');
    expect(el.textContent).toContain('1/2 cápsula · cada 24 horas · 7 días');
  });

  it('recepción no emite recetas', () => {
    const el: HTMLElement = render(visit(), 'RECEPTION').nativeElement;
    expect(el.textContent).not.toContain('Nueva receta');
  });

  it('caja ve la atención pero no la edita', () => {
    const el: HTMLElement = render(visit(), 'CASHIER').nativeElement;
    expect(el.querySelector<HTMLInputElement>('#v-reason')!.disabled).toBe(true);
    expect(el.querySelector('#v-search')).toBeNull();
    expect(el.querySelector('[aria-label="Quitar Baño medicado"]')).toBeNull();
  });

  it('convierte productos en opciones por presentación con precio', () => {
    const options = toProductOptions([
      {
        id: 4,
        code: null,
        name: 'Pipeta',
        category: 'ANTIPARASITIC',
        baseUnit: 'UNIT',
        totalStock: 3,
        minStock: 0,
        lowStock: false,
        controlled: false,
        requiresPrescription: false,
        tracksExpiry: true,
        active: true,
        nextExpiry: null,
        presentations: [
          { id: 1, name: 'Unidad', factor: 1, price: 45, barcode: null, active: true },
          { id: 2, name: 'Caja x 3', factor: 3, price: null, barcode: null, active: true },
        ],
      },
    ]);
    expect(options.map((o) => [o.description, o.unitPrice])).toEqual([['Pipeta · Unidad', 45]]);
  });

  it('muestra el contexto del paciente: peso anterior, última consulta y refuerzos vencidos', () => {
    const fixture = render(visit({ weightKg: 13.2 }));
    http.expectOne('/api/visits/5/context').flush({
      previous: {
        id: 4,
        type: 'CONSULTATION',
        openedAt: '2026-09-10T15:00:00Z',
        reason: 'Control',
        diagnosis: 'Otitis externa',
        attendedBy: 'Dr. Pérez',
      },
      previousWeight: { kg: 12, at: '2026-09-10T15:00:00Z' },
      overdue: [{ name: 'Antirrábica', kind: 'VACCINE', nextDueAt: '2026-10-01' }],
    });
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('[aria-labelledby="side-patient-title"]');
    const text = panel.textContent.replace(/\s+/g, ' ');
    // Las alergias ya están arriba en ámbar: la tarjeta no las repite
    expect(text).not.toContain('Penicilina');
    expect(text).toContain('Última consulta');
    // En celular y tablet de pie la misma tarjeta va arriba, debajo de las alertas
    expect(
      fixture.nativeElement.querySelector('[aria-labelledby="top-patient-title"]'),
    ).toBeTruthy();
    expect(text).toContain('12 kg');
    expect(text).toContain('+1.2 kg');
    expect(text).toContain('Otitis externa');
    expect(text).toContain('Antirrábica vencida el 01/10/2026');
    const link = panel.querySelector('a[href="/atenciones/4"]');
    expect(link).toBeTruthy();
  });

  it('avisa los signos vitales fuera del rango de la especie, con texto', () => {
    const fixture = render(visit());
    const el: HTMLElement = fixture.nativeElement;
    const page = fixture.componentInstance as unknown as {
      notesForm: { patchValue(v: object): void };
    };
    page.notesForm.patchValue({ temperatureC: 40.5, heartRate: 100 });
    fixture.detectChanges();
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Alta para un perro (37.5–39.2 °C)');
    expect(text).not.toContain('para un perro (60');
  });

  it('cancelar está en el menú "Más acciones", no junto a Cerrar atención', () => {
    const fixture = render(visit());
    const el: HTMLElement = fixture.nativeElement;
    expect(button(el, 'Cancelar')).toBeUndefined();
    el.querySelector<HTMLButtonElement>('[aria-label="Más acciones"]')!.click();
    fixture.detectChanges();
    const item = [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) =>
      b.textContent!.includes('Cancelar atención'),
    )!;
    expect(item).toBeTruthy();
    item.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(el.querySelector('dialog[open]')?.textContent).toContain('Cancelar atención');
  });

  it('el menú "Más acciones" se cierra con Esc', () => {
    const fixture = render(visit());
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[aria-label="Más acciones"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('recepción en una consulta: solo motivo, peso y temperatura; sin cerrar', () => {
    const fixture = render(visit(), 'RECEPTION');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('los escribe el veterinario');
    expect(el.querySelector<HTMLInputElement>('#v-reason')!.disabled).toBe(false);
    expect(el.querySelector<HTMLInputElement>('#v-weight')!.disabled).toBe(false);
    expect(el.querySelector<HTMLTextAreaElement>('#v-anamnesis')!.disabled).toBe(true);
    expect(el.querySelector<HTMLInputElement>('#v-dx')!.disabled).toBe(true);
    expect(button(el, 'Cerrar')).toBeUndefined();
    expect(button(el, 'Usar plantilla')).toBeUndefined();
  });

  it('un peso que parece error de tipeo (10 veces el anterior) se avisa sin bloquear', () => {
    const fixture = render(visit());
    http.expectOne('/api/visits/5/context').flush({
      previous: null,
      previousWeight: { kg: 24.5, at: '2026-11-16T15:00:00Z' },
      overdue: [],
    });
    const page = fixture.componentInstance as unknown as {
      notesForm: { patchValue(v: object): void };
    };
    page.notesForm.patchValue({ weightKg: 25.1 });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain('¿Seguro?');
    page.notesForm.patchValue({ weightKg: 245 });
    fixture.detectChanges();
    expect(el.textContent).toContain('¿Seguro? Antes pesaba 24.5 kg');
    expect(el.querySelector<HTMLInputElement>('#v-weight')!.disabled).toBe(false);
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('se guarda solo al dejar de escribir y no borra lo que se sigue escribiendo', async () => {
    const fixture = render(visit({ charges: [], total: 0 }));
    const el: HTMLElement = fixture.nativeElement;
    const dx = el.querySelector<HTMLInputElement>('#v-dx')!;
    dx.value = 'Gastritis';
    dx.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('Cambios sin guardar');
    await wait(AUTOSAVE_MS + 50);
    const first = http.expectOne({ method: 'PATCH', url: '/api/visits/5' });
    expect(first.request.body.diagnosis).toBe('Gastritis');
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardando…');

    // Se sigue escribiendo mientras viaja: no se pierde y se guarda en la siguiente vuelta
    dx.value = 'Gastritis aguda';
    dx.dispatchEvent(new Event('input'));
    first.flush(visit({ charges: [], total: 0, diagnosis: 'Gastritis' }));
    fixture.detectChanges();
    expect(dx.value).toBe('Gastritis aguda');
    await wait(AUTOSAVE_MS + 50);
    const second = http.expectOne({ method: 'PATCH', url: '/api/visits/5' });
    expect(second.request.body.diagnosis).toBe('Gastritis aguda');
    second.flush(visit({ charges: [], total: 0, diagnosis: 'Gastritis aguda' }));
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado');
    expect(el.textContent).not.toContain('Cambios sin guardar');
  });

  it('no se guarda solo con datos inválidos: lo avisa', async () => {
    const fixture = render(visit({ charges: [], total: 0 }));
    const el: HTMLElement = fixture.nativeElement;
    const temp = el.querySelector<HTMLInputElement>('#v-temp')!;
    temp.value = '60';
    temp.dispatchEvent(new Event('input'));
    await wait(AUTOSAVE_MS + 50);
    http.expectNone({ method: 'PATCH', url: '/api/visits/5' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Corrige lo marcado para guardar');
  });

  it('al cerrar guarda primero y muestra lo que falta revisar', async () => {
    const fixture = render(visit({ diagnosis: null, weightKg: null }));
    const el: HTMLElement = fixture.nativeElement;
    http
      .expectOne('/api/visits/5/lab-orders')
      .flush([{ id: 1, status: 'REQUESTED', items: [] }] as never);
    http.expectOne('/api/visits/5/context').flush({
      previous: null,
      previousWeight: null,
      overdue: [{ name: 'Antirrábica', kind: 'VACCINE', nextDueAt: '2026-10-01' }],
    });
    const reason = el.querySelector<HTMLInputElement>('#v-reason')!;
    reason.value = 'Control';
    reason.dispatchEvent(new Event('input'));
    button(el, 'Cerrar atención').click();
    const save = http.expectOne({ method: 'PATCH', url: '/api/visits/5' });
    expect(save.request.body.reason).toBe('Control');
    save.flush(visit({ reason: 'Control', diagnosis: null, weightKg: null }));
    fixture.detectChanges();
    await tick();
    const dialog = el.querySelector('dialog[open]')!;
    const text = dialog.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Falta el diagnóstico.');
    expect(text).toContain('No se registró el peso de hoy.');
    expect(text).toContain('1 examen espera resultado');
    expect(text).toContain('Antirrábica está vencida');
    expect(text).toContain('S/ 45.00');
    // "Completar" vuelve al campo
    [...dialog.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Completar'))!
      .click();
    fixture.detectChanges();
    expect(el.querySelector('dialog[open]')).toBeNull();
  });

  it('manda las indicaciones por WhatsApp en un clic, con lo escrito aunque no se haya guardado', () => {
    const fixture = render(visit({ diagnosis: 'Otitis externa', notes: null }));
    const el: HTMLElement = fixture.nativeElement;
    const plan = el.querySelector<HTMLTextAreaElement>('#v-notes')!;
    plan.value = 'Limpiar el oído cada día. Control en 7 días.';
    plan.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const card = el.querySelector('[aria-labelledby="owner-title"]')!;
    const link = card.querySelector<HTMLAnchorElement>('a[href^="https://wa.me/51987654321"]')!;
    const text = decodeURIComponent(link.href);
    expect(text).toContain('Hola Rosa, estas son las indicaciones para Toby');
    expect(text).toContain('Diagnóstico: Otitis externa');
    expect(text).toContain('Control en 7 días.');
    expect(card.textContent).toContain('Imprimir');
  });

  it('sugiere los diagnósticos más usados y muestra "Por cobrar" una sola vez', () => {
    const fixture = render(visit());
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne('/api/visits/diagnoses').flush(['Gastroenteritis', 'Otitis externa']);
    fixture.detectChanges();
    const options = [...el.querySelectorAll<HTMLOptionElement>('#v-dx-list option')];
    expect(options.map((o) => o.value)).toEqual(['Gastroenteritis', 'Otitis externa']);
    expect(el.querySelector('#v-dx')!.getAttribute('list')).toBe('v-dx-list');
    const charges = el.querySelector('[aria-labelledby="charges-title"]')!;
    expect(charges.textContent!.match(/Por cobrar/g)).toHaveLength(1);
  });
});
