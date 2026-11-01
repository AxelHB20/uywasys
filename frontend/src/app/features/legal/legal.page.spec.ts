import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LegalPage } from './legal.page';

describe('LegalPage', () => {
  function render(doc: 'terminos' | 'privacidad') {
    TestBed.configureTestingModule({ imports: [LegalPage], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(LegalPage);
    fixture.componentRef.setInput('doc', doc);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('la política de privacidad explica quién es responsable y el envío al extranjero', () => {
    const el = render('privacidad');
    expect(el.querySelector('h1')!.textContent).toContain('Política de privacidad');
    expect(el.textContent).toContain('016-2024-JUS');
    expect(el.textContent).toContain('fuera del Perú');
    expect(el.textContent).toContain('Actualizado el 28/10/2026');
    expect(el.querySelector('[aria-current="page"]')!.textContent).toContain('Privacidad');
  });

  it('los términos aclaran que la nota de venta no es comprobante de pago', () => {
    const el = render('terminos');
    expect(el.querySelector('h1')!.textContent).toContain('Términos del servicio');
    expect(el.textContent).toContain('no son comprobantes de pago');
  });
});
