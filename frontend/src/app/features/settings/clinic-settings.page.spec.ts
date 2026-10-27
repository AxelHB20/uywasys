import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionService } from '../../core/auth/session.service';
import { tick } from '../../shared/testing';
import { ClinicSettingsPage } from './clinic-settings.page';

const profile = {
  id: 1,
  name: 'Veterinaria San Martín',
  ruc: null,
  address: null,
  phone: null,
  email: null,
  logoUrl: null,
};

describe('ClinicSettingsPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ClinicSettingsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: 'Ana Quispe',
      email: 'ana@uywa.pe',
      role: 'ADMIN',
      licenseNumber: null,
      mustChangePassword: false,
      clinic: { id: 1, name: 'Veterinaria San Martín', logoUrl: null },
    });
  });

  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(ClinicSettingsPage);
    fixture.detectChanges();
    http.expectOne('/api/clinic').flush(profile);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const set = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
    };
    const submit = () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    };
    return { fixture, el, set, submit };
  }

  it('no guarda un RUC con dígito verificador incorrecto', async () => {
    const { el, set, submit } = await render();
    set('ruc', '20123456788');
    submit();
    expect(el.textContent).toContain('El RUC no es válido');
    http.expectNone({ method: 'PATCH', url: '/api/clinic' });
  });

  it('guarda los datos y actualiza el nombre que muestra el menú', async () => {
    const { set, submit } = await render();
    set('name', 'Clínica Uywa Chosica');
    set('ruc', '20100070970');
    set('phone', '987 654 321');
    submit();
    const req = http.expectOne({ method: 'PATCH', url: '/api/clinic' });
    expect(req.request.body).toMatchObject({
      name: 'Clínica Uywa Chosica',
      ruc: '20100070970',
      address: null,
    });
    req.flush({
      ...profile,
      name: 'Clínica Uywa Chosica',
      ruc: '20100070970',
      phone: '987 654 321',
    });
    await tick();
    expect(TestBed.inject(SessionService).clinicName()).toBe('Clínica Uywa Chosica');
  });
});
