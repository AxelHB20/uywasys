import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PetHistory } from '../../core/services/visits.models';
import { PetHistoryPage } from './pet-history.page';

const history: PetHistory = {
  clinic: { name: 'Huellitas', address: 'Av. Lima 123', phone: '014445555', logoUrl: null },
  pet: {
    id: 3,
    number: 45,
    name: 'Toby',
    species: 'DOG',
    breed: 'Mestizo',
    sex: 'MALE',
    birthDate: null,
    allergies: 'Penicilina',
  },
  client: { id: 7, name: 'Rosa Quispe', phone: '987654321' },
  weights: [
    { at: '2026-09-10T15:00:00Z', kg: 12 },
    { at: '2026-10-28T15:00:00Z', kg: 12.4 },
  ],
  visits: [
    {
      id: 5,
      type: 'CONSULTATION',
      status: 'CLOSED',
      openedAt: '2026-10-28T15:00:00Z',
      closedAt: '2026-10-28T15:40:00Z',
      reason: 'Vómitos',
      weightKg: 12.4,
      temperatureC: 39.4,
      anamnesis: 'Desde ayer',
      heartRate: 110,
      respiratoryRate: null,
      capillaryRefillS: null,
      mucosa: 'Rosadas',
      hydration: null,
      bodyCondition: 5,
      physicalExam: null,
      diagnosis: 'Gastritis',
      diagnosisDefinitive: false,
      notes: 'Dieta blanda',
      attendedBy: { id: 1, fullName: 'Dra. Ana' },
      addenda: [
        {
          id: 1,
          text: 'La temperatura era 39.1',
          createdAt: '2026-10-29T15:00:00Z',
          author: { id: 1, fullName: 'Dra. Ana' },
        },
      ],
      immunizations: [],
      prescriptions: [
        {
          id: 9,
          code: 'RX-00009',
          visitId: 5,
          notes: null,
          createdAt: '2026-10-28T15:30:00Z',
          voidedAt: null,
          voidReason: null,
          vet: { id: 1, fullName: 'Dra. Ana', licenseNumber: '123' },
          items: [
            {
              id: 1,
              productId: null,
              presentationId: null,
              drug: 'Omeprazol 20 mg',
              dose: '1 cápsula',
              route: 'Oral',
              frequency: 'cada 24 h',
              duration: '5 días',
              instructions: null,
              controlled: false,
              dispensedQuantity: null,
              presentation: null,
              charge: null,
            },
          ],
        },
      ],
    },
  ],
};

describe('PetHistoryPage (historia completa imprimible)', () => {
  it('muestra cada consulta con su SOAP, receta y adendas', () => {
    TestBed.configureTestingModule({
      imports: [PetHistoryPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PetHistoryPage);
    fixture.componentRef.setInput('id', '3');
    fixture.detectChanges();
    http.expectOne('/api/visits/pet/3/history').flush(history);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('HC-00045');
    expect(text).toContain('Alergias: Penicilina');
    expect(text).toContain('Motivo: Vómitos');
    expect(text).toContain('O: Peso 12.4 kg · T° 39.4 °C · FC 110 lpm · mucosas rosadas · CC 5/9');
    expect(text).toContain('A: Gastritis (presuntivo)');
    expect(text).toContain('P: Dieta blanda');
    expect(text).toContain('Omeprazol 20 mg: 1 cápsula, oral, cada 24 h, 5 días');
    expect(text).toContain('La temperatura era 39.1');
    expect(text).toContain('Ley 29733');
    http.verify();
  });
});
