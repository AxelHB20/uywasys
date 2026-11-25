import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginPage, safeReturnUrl } from './login.page';

describe('LoginPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(passwordReset = false) {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    http.expectOne('/api/auth/options').flush({ passwordReset });
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

  it('muestra los errores de validación sin llamar a la API', async () => {
    const { fixture, el, submit } = render();
    submit();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ingresa tu correo');
    expect(el.textContent).toContain('Ingresa tu contraseña');
    http.expectNone('/api/auth/login');
  });

  it('envía el formulario y entra al sistema', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { fixture, type, submit } = render();
    type('#email', 'ana@uywa.pe');
    type('#password', 'ClaveSegura123');
    submit();
    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({ email: 'ana@uywa.pe', password: 'ClaveSegura123' });
    req.flush({
      user: {
        id: 1,
        fullName: 'Ana',
        email: 'ana@uywa.pe',
        role: 'ADMIN',
        licenseNumber: null,
        mustChangePassword: false,
        clinic: { id: 1, name: 'Demo', logoUrl: null },
      },
    });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('muestra el mensaje del servidor cuando la cuenta está bloqueada', async () => {
    const { fixture, el, type, submit } = render();
    type('#email', 'ana@uywa.pe');
    type('#password', 'mala');
    submit();
    http.expectOne('/api/auth/login').flush(
      {
        message: 'Cuenta bloqueada por varios intentos fallidos. Intenta de nuevo en 15 minutos',
      },
      { status: 423, statusText: 'Locked' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Cuenta bloqueada');
  });

  it('solo acepta rutas internas para volver después del login', () => {
    expect(safeReturnUrl('/inventario')).toBe('/inventario');
    expect(safeReturnUrl('//sitio-malicioso.com')).toBe('/dashboard');
    expect(safeReturnUrl('https://sitio-malicioso.com')).toBe('/dashboard');
    expect(safeReturnUrl(undefined)).toBe('/dashboard');
  });

  it('ofrece "¿Olvidaste tu contraseña?" solo si el servidor puede enviar correos', () => {
    let { el } = render(false);
    expect(el.querySelector('a[href^="/recuperar"]')).toBeNull();
    expect(el.textContent).toContain('Pídele al administrador');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    ({ el } = render(true));
    expect(el.querySelector('a[href^="/recuperar"]')?.textContent).toContain(
      '¿Olvidaste tu contraseña?',
    );
  });
});
