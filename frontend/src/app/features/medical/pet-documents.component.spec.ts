import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { Attachment } from '../../core/services/documents.models';
import { PetDocumentsComponent } from './pet-documents.component';

const lab: Attachment = {
  id: 7,
  petId: 3,
  visitId: 21,
  kind: 'LAB',
  title: 'Hemograma',
  fileName: 'hemograma.pdf',
  mime: 'application/pdf',
  size: 120_000,
  createdAt: '2026-10-29T15:00:00.000Z',
  voidedAt: null,
  voidReason: null,
  createdBy: { id: 1, fullName: 'Ana' },
};

describe('PetDocumentsComponent (archivos y consentimientos)', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  function render(role: 'VET' | 'RECEPTION' | 'CASHIER') {
    TestBed.configureTestingModule({
      imports: [PetDocumentsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({ id: 1, fullName: 'Ana', role } as never);
    const fixture = TestBed.createComponent(PetDocumentsComponent);
    fixture.componentRef.setInput('petId', 3);
    fixture.componentRef.setInput('visitId', 21);
    fixture.detectChanges();
    http.expectOne('/api/pets/3/attachments').flush([lab]);
    http.expectOne('/api/pets/3/consents').flush([
      {
        id: 5,
        code: 'CI-00001',
        title: 'Consentimiento informado para cirugía',
        type: 'SURGERY',
        procedure: 'Castración',
        visitId: 21,
        signerName: 'Rosa Quispe',
        signedAt: '2026-10-29T15:10:00.000Z',
        vet: { id: 1, fullName: 'Ana' },
        voidedAt: null,
        voidReason: null,
      },
    ]);
    fixture.detectChanges();
    return fixture;
  }

  it('lista archivos y consentimientos; sube un PDF enlazado a la atención', () => {
    const fixture = render('VET');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Hemograma');
    expect(el.textContent).toContain('CI-00001');
    expect(el.querySelector('a[href*="mascotas/3/consentimiento"]')).not.toBeNull();

    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Subir archivo'))!
      .click();
    fixture.detectChanges();
    const file = new File(['%PDF-1.4'], 'Rx tórax.pdf', { type: 'application/pdf' });
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#doc-title')!.value).toBe('Rx tórax');

    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/pets/3/attachments' });
    const body = req.request.body as FormData;
    expect(body.get('kind')).toBe('LAB');
    expect(body.get('title')).toBe('Rx tórax');
    expect(body.get('visitId')).toBe('21');
    expect(body.get('file')).toBeInstanceOf(File);
    req.flush({ ...lab, id: 8, title: 'Rx tórax' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Rx tórax');
  });

  it('recepción sube archivos pero no toma consentimientos; caja solo mira', () => {
    let el: HTMLElement = render('RECEPTION').nativeElement;
    expect(el.querySelector('a[href*="mascotas/3/consentimiento"]')).toBeNull();
    expect(el.textContent).toContain('Subir archivo');
    http.verify();
    TestBed.resetTestingModule();
    el = render('CASHIER').nativeElement;
    expect(el.textContent).not.toContain('Subir archivo');
  });
});
