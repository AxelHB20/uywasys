import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { tick } from '../../shared/testing';
import { NewClientPage } from './new-client.page';

describe('NewClientPage (registro rápido)', () => {
  let http: HttpTestingController;

  function render() {
    TestBed.configureTestingModule({
      imports: [NewClientPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NewClientPage);
    fixture.detectChanges();
    http
      .expectOne('/api/clients/consent')
      .flush({ version: 'v1', text: 'Texto Ley 29733', marketingText: 'Promos' });
    return fixture;
  }

  function type(el: HTMLElement, selector: string, value: string) {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
  }

  function check(el: HTMLElement, selector: string) {
    el.querySelector<HTMLInputElement>(selector)!.click();
  }

  afterEach(() => http.verify());

  it('sin consentimiento no envía nada y marca los errores', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Sin la autorización del cliente no se puede registrar');
    expect(el.textContent).toContain('Elige la especie');
    http.expectNone('/api/clients');
  });

  it('avisa si el DNI ya está registrado', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    type(el, '#c-doc', '45678912');
    http
      .expectOne((r) => r.url === '/api/clients/lookup' && r.params.get('docNumber') === '45678912')
      .flush({ client: { id: 7, name: 'Rosa Quispe', phone: '987654321', active: true } });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('#duplicate-alert')?.textContent).toContain('Rosa Quispe');
  });

  it('guarda cliente y mascota y la pone en cola', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    type(el, '#c-doc', '45678912');
    http.expectOne((r) => r.url === '/api/clients/lookup').flush({ client: null });
    type(el, '#c-name', 'Rosa Quispe');
    type(el, '#c-phone', '987 654 321');
    type(el, '#new-pet-name', 'Toby');
    [...el.querySelectorAll('label')]
      .find((label) => label.textContent?.trim() === 'Perro')!
      .querySelector('input')!
      .click();
    type(el, '#v-reason', 'Vacuna');
    check(el, 'input[formcontrolname="consent"]');
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const create = http.expectOne((r) => r.method === 'POST' && r.url === '/api/clients');
    expect(create.request.body).toMatchObject({
      docType: 'DNI',
      docNumber: '45678912',
      phone: '987654321',
      consent: true,
      pet: { name: 'Toby', species: 'DOG' },
    });
    create.flush({ id: 7, name: 'Rosa Quispe', pets: [{ id: 3, name: 'Toby' }] });

    const queue = http.expectOne('/api/queue');
    expect(queue.request.body).toEqual({ petId: 3, urgent: false, reason: 'Vacuna' });
    queue.flush({});
    expect(navigate).toHaveBeenCalledWith(['/clientes', 7]);
  });
});
