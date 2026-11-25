import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { SignaturePadComponent } from '../../shared/ui/signature-pad/signature-pad.component';
import { ConsentSignPage } from './consent-sign.page';

const card = {
  clinic: { name: 'Vet Sur', address: null, phone: null, logoUrl: null },
  pet: {
    id: 3,
    number: 3,
    name: 'Toby',
    species: 'DOG',
    client: { id: 9, name: 'Rosa Quispe', phone: '987654321' },
  },
  items: [],
};
const client = {
  id: 9,
  name: 'Rosa Quispe',
  docNumber: '45678912',
  authorized: [{ id: 4, name: 'Luis Quispe', dni: '41234567', phone: null, relation: 'Hijo' }],
};
const TEXT =
  'Yo, Rosa Quispe, en mi calidad de propietaria de Toby, autorizo la castración. '.repeat(2);

describe('ConsentSignPage (consentimiento informado)', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  it('prepara el texto, elige al firmante y guarda la firma', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    TestBed.configureTestingModule({
      imports: [ConsentSignPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ConsentSignPage);
    fixture.componentRef.setInput('id', '3');
    fixture.componentRef.setInput('atencion', '21');
    fixture.detectChanges();
    http.expectOne('/api/pets/3/immunization-card').flush(card);
    http.expectOne('/api/clients/9').flush(client);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const button = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(text),
      )!;
    const type = (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };

    // Sin texto ni firma no se guarda
    button('Guardar consentimiento').click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Prepara el texto');
    expect(el.textContent).toContain('Falta la firma');

    type('#c-procedure', 'Castración');
    button('Preparar texto').click();
    const tpl = http.expectOne((r) => r.url === '/api/consents/template');
    expect(tpl.request.params.get('type')).toBe('SURGERY');
    expect(tpl.request.params.get('procedure')).toBe('Castración');
    tpl.flush({ title: 'Consentimiento informado para cirugía', text: TEXT });
    fixture.detectChanges();
    expect(el.querySelector<HTMLTextAreaElement>('#c-text')!.value).toBe(TEXT);

    // Firma el hijo autorizado
    button('Luis Quispe').click();
    fixture.debugElement
      .query(By.directive(SignaturePadComponent))
      .componentInstance.changed.emit('data:image/png;base64,iVBORw0KGgo=');
    el.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    fixture.detectChanges();
    button('Guardar consentimiento').click();

    const req = http.expectOne({ method: 'POST', url: '/api/consents' });
    expect(req.request.body).toEqual({
      petId: 3,
      visitId: 21,
      type: 'SURGERY',
      procedure: 'Castración',
      text: TEXT.trim(),
      signerName: 'Luis Quispe',
      signerDocument: '41234567',
      signerRelation: 'Hijo',
      signature: 'data:image/png;base64,iVBORw0KGgo=',
    });
    req.flush({ id: 5, code: 'CI-00001' });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/consentimientos', 5], { replaceUrl: true });
  });
});
