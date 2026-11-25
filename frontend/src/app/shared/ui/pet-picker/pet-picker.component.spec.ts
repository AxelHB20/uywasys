import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PetPickerComponent, PickedPet } from './pet-picker.component';

const client = {
  id: 7,
  number: 12,
  name: 'Fiorella Huamán Torres',
  docType: 'DNI',
  docNumber: '45399577',
  phone: '971867002',
  active: true,
  lastVisit: null,
  pets: [
    {
      id: 1,
      number: 69,
      name: 'Algodón',
      species: 'GUINEA_PIG',
      sex: 'MALE',
      breed: 'Peruano',
      birthDate: null,
      aggressive: false,
      hasAllergies: false,
      active: true,
    },
    {
      id: 2,
      number: 70,
      name: 'Cony',
      species: 'DOG',
      sex: 'FEMALE',
      breed: 'Poodle',
      birthDate: null,
      aggressive: true,
      aggressiveNote: 'Usar bozal',
      hasAllergies: true,
      active: true,
    },
  ],
};

describe('PetPickerComponent', () => {
  async function render(q: string) {
    TestBed.configureTestingModule({
      imports: [PetPickerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PetPickerComponent);
    const picked: (PickedPet | null)[] = [];
    fixture.componentInstance.picked.subscribe((p) => picked.push(p));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector<HTMLInputElement>('input')!;
    input.value = q;
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    return { fixture, el, http, input, picked };
  }

  it('muestra el DNI y el celular del dueño y los datos y avisos de cada mascota', async () => {
    const { fixture, el, http, picked } = await render('77');
    http.expectOne((r) => r.url === '/api/clients').flush({ items: [client], total: 8 });
    fixture.detectChanges();
    expect(el.textContent).toContain('DNI 45399577');
    expect(el.textContent).toContain('971 867 002');
    expect([...el.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['77']);
    expect(el.textContent).toContain('Cuy · Macho · Peruano');
    expect(el.textContent).toContain('Perro · Hembra · Poodle');
    expect(el.textContent).toContain('Agresivo');
    expect(el.textContent).toContain('Hay 7 clientes más');

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Cony'))!.click();
    fixture.detectChanges();
    expect(picked[0]).toMatchObject({
      petId: 2,
      petName: 'Cony',
      clientName: 'Fiorella Huamán Torres',
    });
    expect(el.textContent).toContain('HC-00070');
    expect(el.textContent).toContain('Usar bozal');
    expect(el.textContent).toContain('Tiene alergias');
  });

  it('Enter elige si hay una sola mascota posible', async () => {
    const { fixture, http, input, picked } = await render('algodon');
    http
      .expectOne((r) => r.url === '/api/clients')
      .flush({ items: [{ ...client, pets: [client.pets[0]] }], total: 1 });
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(picked[0]?.petName).toBe('Algodón');
  });
});
