import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { CareService } from '../../core/services/inventory.models';
import { Charge, VisitDetail } from '../../core/services/visits.models';
import { stubDialog, tick } from '../../shared/testing';
import { toProductOptions } from '../../shared/catalog/catalog-options';
import { VisitPage } from './visit.page';

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
    } as never);
    const fixture = TestBed.createComponent(VisitPage);
    fixture.componentRef.setInput('id', '5');
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/care-services').flush([castration]);
    http.expectOne('/api/visits/5').flush(data);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    // Presupuestos aceptados de la mascota (se piden al cargar una atención abierta)
    http.match((r) => r.url === '/api/estimates').forEach((r) => r.flush([]));
    // Archivos y consentimientos de la mascota
    http
      .match((r) => /^\/api\/pets\/\d+\/(attachments|consents)$/.test(r.url))
      .forEach((r) => r.flush([]));
    http.verify();
  });

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => !b.closest('dialog') && b.textContent?.trim().startsWith(text),
    )!;

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
});
