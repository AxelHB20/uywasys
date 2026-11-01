import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { GroomingCheckInPage } from './check-in.page';

const bath = {
  id: 11,
  name: 'Baño completo',
  category: 'GROOMING',
  price: 35,
  igv: 'TAXED',
  durationMin: 60,
  active: true,
  supplies: [],
  sizePrices: [{ size: 'MEDIUM', price: 45 }],
};
const nails = { ...bath, id: 12, name: 'Corte de uñas', price: 10, sizePrices: [] };
const consult = { ...bath, id: 13, name: 'Consulta', category: 'CONSULTATION' };
const card = {
  clinic: { name: 'Vet Sur', address: null, phone: null, logoUrl: null },
  pet: {
    id: 3,
    number: 3,
    name: 'Copito',
    species: 'DOG',
    breed: 'Shih Tzu',
    weightKg: 6,
    aggressive: true,
    aggressiveNote: 'Muerde al cortar uñas',
    allergies: null,
    client: { id: 9, name: 'Rosa Quispe', phone: '987654321' },
  },
  items: [],
};

describe('GroomingCheckInPage (ingreso)', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  it('suma al precio del tamaño, trae lo de la última vez y registra el ingreso', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    TestBed.configureTestingModule({
      imports: [GroomingCheckInPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(GroomingCheckInPage);
    fixture.componentRef.setInput('petId', '3');
    fixture.componentRef.setInput('cola', '44');
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne((r) => r.url === '/api/care-services').flush([bath, nails, consult]);
    http.expectOne('/api/grooming/groomers').flush([{ id: 5, fullName: 'Pepe Groomer' }]);
    await fixture.whenStable();
    http.expectOne('/api/pets/3/immunization-card').flush(card);
    http
      .expectOne('/api/pets/3/grooming')
      .flush([{ id: 1, status: 'DELIVERED', size: 'MEDIUM', instructions: 'Corte cachorro' }]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Muerde al cortar uñas');
    expect(el.textContent).not.toContain('Consulta');
    expect(el.querySelector('[data-size="MEDIUM"]')!.getAttribute('aria-checked')).toBe('true');

    const click = (selector: string) => el.querySelector<HTMLElement>(selector)!.click();
    const byText = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(text),
      )!;
    // Sin servicios no se registra
    byText('Registrar ingreso').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Elige al menos un servicio');

    click('[data-service="11"]');
    click('[data-service="12"]');
    byText('Como la última vez').click();
    byText('Pulgas').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('S/ 55.00');

    byText('Registrar ingreso').click();
    const req = http.expectOne({ method: 'POST', url: '/api/grooming' });
    expect(req.request.body).toMatchObject({
      petId: 3,
      queueEntryId: 44,
      size: 'MEDIUM',
      groomerId: null,
      services: [
        { careServiceId: 11, quantity: 1 },
        { careServiceId: 12, quantity: 1 },
      ],
      fleas: true,
      aggressive: true,
      instructions: 'Corte cachorro',
      transport: 'NONE',
      transportAddress: null,
      signature: null,
      signerName: null,
    });
    req.flush({ id: 7, code: 'GR-00007', pet: { name: 'Copito' } });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/grooming']);
  });
});
