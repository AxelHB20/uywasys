import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { tick } from '../../shared/testing';
import { NewClientPage } from './new-client.page';

describe('NewClientPage (registro rápido)', () => {
  let http: HttpTestingController;

  function render(buscar?: string) {
    TestBed.configureTestingModule({
      imports: [NewClientPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NewClientPage);
    if (buscar) fixture.componentRef.setInput('buscar', buscar);
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
    expect(navigate).toHaveBeenCalledWith(['/clientes', 7], { replaceUrl: true });
  });

  it('llega con lo que se buscó en la cola: DNI, celular o nombre ya escritos', () => {
    const value = (f: ReturnType<typeof render>, sel: string) =>
      (f.nativeElement as HTMLElement).querySelector<HTMLInputElement>(sel)!.value;
    let f = render('45677912');
    expect(f.componentInstance['form'].controls.docNumber.value).toBe('45677912');
    TestBed.resetTestingModule();
    f = render('960 477 990');
    expect(f.componentInstance['form'].controls.phone.value).toBe('960477990');
    TestBed.resetTestingModule();
    f = render('Gabriela Medina');
    expect(f.componentInstance['form'].controls.name.value).toBe('Gabriela Medina');
    void value;
  });

  const wait = () => new Promise((r) => setTimeout(r, 350));

  it('el DNI llena el nombre (y no pisa lo escrito a mano)', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const doc = el.querySelector<HTMLInputElement>('#c-doc')!;
    doc.value = '45678912';
    doc.dispatchEvent(new Event('input'));
    await wait();
    http.expectOne((r) => r.url === '/api/clients/lookup').flush({ client: null });
    http
      .expectOne((r) => r.url === '/api/billing/lookup' && r.params.get('type') === 'DNI')
      .flush({
        name: 'MARÍA ELENA TORRES QUISPE',
        address: null,
        status: null,
        condition: null,
        source: 'APISPERU',
      });
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#c-name')!.value).toBe('MARÍA ELENA TORRES QUISPE');
    expect(el.textContent).toContain('Encontrado con el DNI');

    // Corregido a mano: otro DNI ya no lo cambia
    type(el, '#c-name', 'María Torres');
    http.match((r) => r.url === '/api/clients/lookup').forEach((r) => r.flush({ client: null }));
    doc.value = '45678913';
    doc.dispatchEvent(new Event('input'));
    await wait();
    http.match((r) => r.url === '/api/clients/lookup').forEach((r) => r.flush({ client: null }));
    http.expectNone('/api/billing/lookup');
    expect(el.querySelector<HTMLInputElement>('#c-name')!.value).toBe('María Torres');
  });

  it('avisa si el celular ya es de otro cliente, sin bloquear', async () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const phone = el.querySelector<HTMLInputElement>('#c-phone')!;
    phone.value = '948 640 232';
    phone.dispatchEvent(new Event('input'));
    await wait();
    http
      .expectOne(
        (r) => r.url === '/api/clients/lookup-phone' && r.params.get('phone') === '948640232',
      )
      .flush({ client: { id: 20, name: 'Jimena Mamani', active: true, pets: ['Oreo', 'Oso'] } });
    fixture.detectChanges();
    const alert = [...el.querySelectorAll('[role="alert"]')].find((a) =>
      a.textContent?.includes('celular'),
    )!;
    expect(alert.textContent).toContain('Jimena Mamani');
    expect(alert.textContent).toContain('(Oreo, Oso)');
    expect(alert.querySelector('a[href="/clientes/20"]')).not.toBeNull();
  });
});
