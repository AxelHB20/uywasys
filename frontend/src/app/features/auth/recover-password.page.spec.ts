import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RecoverPasswordPage } from './recover-password.page';

describe('RecoverPasswordPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RecoverPasswordPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function render(token?: string) {
    const fixture = TestBed.createComponent(RecoverPasswordPage);
    if (token) fixture.componentRef.setInput('token', token);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = () =>
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    return { fixture, el, type, submit };
  }

  it('pide el enlace y muestra siempre el mismo mensaje (revisa también Spam)', () => {
    const { fixture, el, type, submit } = render();
    submit();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ingresa tu correo');
    http.expectNone('/api/auth/forgot');
    type('#rp-email', 'rosa@clinica.pe');
    submit();
    const req = http.expectOne('/api/auth/forgot');
    expect(req.request.body).toEqual({ email: 'rosa@clinica.pe' });
    req.flush({ ok: true });
    fixture.detectChanges();
    expect(el.textContent).toContain('Revisa tu correo');
    expect(el.textContent).toContain('rosa@clinica.pe');
    expect(el.textContent).toContain('Spam');
  });

  it('con el enlace crea la contraseña nueva y vuelve al ingreso', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { fixture, el, type, submit } = render('t'.repeat(43));
    type('#rp-next', 'ClaveNueva456');
    type('#rp-confirm', 'ClaveNueva457');
    submit();
    fixture.detectChanges();
    expect(el.textContent).toContain('Las contraseñas no coinciden');
    http.expectNone('/api/auth/reset');
    type('#rp-confirm', 'ClaveNueva456');
    submit();
    const req = http.expectOne('/api/auth/reset');
    expect(req.request.body).toEqual({ token: 't'.repeat(43), password: 'ClaveNueva456' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { restablecida: 1 },
      replaceUrl: true,
    });
  });

  it('si el enlace venció lo dice y ofrece pedir otro', () => {
    const { fixture, el, type, submit } = render('t'.repeat(43));
    type('#rp-next', 'ClaveNueva456');
    type('#rp-confirm', 'ClaveNueva456');
    submit();
    http
      .expectOne('/api/auth/reset')
      .flush(
        {
          message: 'El enlace venció o ya se usó. Pide uno nuevo desde "¿Olvidaste tu contraseña?"',
        },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('venció');
    expect(el.querySelector('[role="alert"] a')?.textContent).toContain('Pedir un enlace nuevo');
  });
});
