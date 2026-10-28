import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ImportClientsPage } from './import-clients.page';

const preview = {
  rows: [
    {
      row: 2,
      key: 'DNI:1',
      client: { docType: 'DNI', docNumber: '45678912', name: 'Rosa', phone: '987654321' },
      pet: { name: 'Toby', species: 'DOG' },
      status: 'ok',
      errors: [],
    },
    {
      row: 3,
      key: 'DNI:2',
      client: { docType: 'DNI', docNumber: '123', name: 'Mal', phone: '812345678' },
      pet: null,
      status: 'error',
      errors: ['El DNI debe tener 8 dígitos'],
    },
  ],
  summary: { rows: 2, ok: 1, exists: 0, errors: 1, clients: 1, pets: 1 },
};

describe('ImportClientsPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ImportClientsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function chooseFile(el: HTMLElement, name: string, size = 100) {
    const input = el.querySelector<HTMLInputElement>('#import-file')!;
    const file = new File([new Uint8Array(size)], name);
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
  }

  it('rechaza archivos que no son .xlsx antes de subirlos', () => {
    const fixture = TestBed.createComponent(ImportClientsPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Ya tengo mi archivo'))!
      .click();
    fixture.detectChanges();
    chooseFile(el, 'clientes.csv');
    fixture.detectChanges();
    expect(el.textContent).toContain('Elige un archivo de Excel (.xlsx)');
  });

  it('revisa, muestra los errores por fila y solo importa con la declaración de consentimiento', () => {
    const fixture = TestBed.createComponent(ImportClientsPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const click = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(text),
      )!;

    click('Ya tengo mi archivo').click();
    fixture.detectChanges();
    chooseFile(el, 'clientes.xlsx');
    fixture.detectChanges();
    click('Revisar archivo').click();
    http.expectOne('/api/clients/import/preview').flush(preview);
    fixture.detectChanges();

    expect(el.textContent).toContain('El DNI debe tener 8 dígitos');
    const importButton = click('Importar 1 cliente');
    expect(importButton.disabled).toBe(true);

    el.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    fixture.detectChanges();
    expect(importButton.disabled).toBe(false);
    importButton.click();
    const req = http.expectOne('/api/clients/import');
    expect((req.request.body as FormData).get('consentDeclared')).toBe('true');
    req.flush({ clients: 1, pets: 1, skipped: 0, errors: 1 });
    fixture.detectChanges();
    expect(el.textContent).toContain('Importación terminada');
  });
});
