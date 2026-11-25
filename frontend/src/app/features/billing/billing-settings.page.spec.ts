import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { BillingSettings } from '../../core/services/billing.models';
import { tick } from '../../shared/testing';
import { BillingSettingsPage } from './billing-settings.page';

const saved: BillingSettings = {
  enabled: true,
  provider: 'SIMULATED',
  production: false,
  legalName: 'Veterinaria Demo S.A.C.',
  fiscalAddress: null,
  ubigeo: null,
  apiUrl: null,
  hasToken: false,
  hasLookupToken: false,
  boletaSeries: 'B001',
  facturaSeries: 'F001',
  boletaCreditSeries: 'BC01',
  facturaCreditSeries: 'FC01',
  missing: [],
};

describe('BillingSettingsPage', () => {
  let http: HttpTestingController;

  async function render(settings = saved, support = true) {
    TestBed.configureTestingModule({
      imports: [BillingSettingsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 1,
      fullName: support ? 'Soporte técnico' : 'Mitchel Gómez',
      email: 'a@uywa.pe',
      role: 'ADMIN',
      licenseNumber: null,
      mustChangePassword: false,
      support,
      clinic: { id: 1, name: 'Huellitas', logoUrl: null },
    });
    const fixture = TestBed.createComponent(BillingSettingsPage);
    fixture.detectChanges();
    http.expectOne('/api/billing/settings').flush(settings);
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const set = (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    /** Guarda; si pide confirmar (series, proveedor, producción), confirma */
    const submit = () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      [...el.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Confirmar y guardar'))
        ?.click();
    };
    return { fixture, el, set, submit };
  }

  afterEach(() => http.verify());

  it('al elegir Nubefact pide ruta y token; el token guardado no se reenvía si no se cambia', async () => {
    const { fixture, el, set, submit } = await render({
      ...saved,
      provider: 'NUBEFACT',
      apiUrl: 'https://api.nubefact.com/x',
      hasToken: true,
    });
    expect(el.querySelector<HTMLInputElement>('#bill-token')!.placeholder).toContain('Guardado');
    set('#s-boletaSeries', 'b002');
    submit();
    const req = http.expectOne({ method: 'PUT', url: '/api/billing/settings' });
    expect(req.request.body).toMatchObject({
      provider: 'NUBEFACT',
      apiToken: null,
      boletaSeries: 'B002',
    });
    req.flush({ ...saved, provider: 'NUBEFACT', boletaSeries: 'B002' });
    fixture.detectChanges();
  });

  it('al elegir Lucode pide solo el token (sin ruta) y lo guarda con producción apagada', async () => {
    const { fixture, el, set, submit } = await render();
    const lucode = el.querySelector<HTMLInputElement>('input[value="LUCODE"]')!;
    lucode.click();
    fixture.detectChanges();
    expect(el.querySelector('#bill-url')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('#bill-token')!.placeholder).toContain(
      'Organizaciones',
    );
    expect(el.textContent).toContain('Al contratar Lucode');
    set('#bill-token', ' tok-lucode ');
    submit();
    const req = http.expectOne({ method: 'PUT', url: '/api/billing/settings' });
    expect(req.request.body).toMatchObject({
      provider: 'LUCODE',
      apiUrl: null,
      apiToken: 'tok-lucode',
      production: false,
    });
    req.flush({ ...saved, provider: 'LUCODE', hasToken: true });
    fixture.detectChanges();
  });

  it('al elegir Mifact pide dirección fiscal y ubigeo; sin ruta usa el demo', async () => {
    const { fixture, el, set, submit } = await render();
    el.querySelector<HTMLInputElement>('input[value="MIFACT"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#bill-url')!.placeholder).toContain('demo');
    expect(el.textContent).toContain('Al contratar Mifact');
    set('#bill-token', 'tok-mifact');
    set('#bill-address', ' Av. Los Olivos 123, Lima ');
    set('#bill-ubigeo', '1501');
    submit();
    http.expectNone('/api/billing/settings');
    set('#bill-ubigeo', '150101');
    submit();
    const req = http.expectOne({ method: 'PUT', url: '/api/billing/settings' });
    expect(req.request.body).toMatchObject({
      provider: 'MIFACT',
      apiUrl: null,
      apiToken: 'tok-mifact',
      fiscalAddress: 'Av. Los Olivos 123, Lima',
      ubigeo: '150101',
    });
    req.flush({ ...saved, provider: 'MIFACT', hasToken: true, ubigeo: '150101' });
    fixture.detectChanges();
  });

  it('muestra lo que falta para activar con el PSE y no deja una serie mal escrita', async () => {
    const { el, set, submit } = await render({
      ...saved,
      enabled: false,
      provider: 'NUBEFACT',
      missing: ['el token del PSE'],
    });
    expect(el.textContent).toContain('Para activar con el PSE falta');
    expect(el.textContent).toContain('el token del PSE');
    set('#s-facturaSeries', 'B001');
    el.querySelector<HTMLInputElement>('#s-facturaSeries')!.dispatchEvent(new Event('blur'));
    submit();
    http.expectNone('/api/billing/settings');
  });

  it('el dueño ve todo bloqueado y solo actualiza el token, que se prueba antes de guardar', async () => {
    const { fixture, el } = await render(
      {
        ...saved,
        enabled: true,
        provider: 'MIFACT',
        hasToken: true,
        health: {
          state: 'TOKEN',
          checkedAt: '2026-11-18T11:00:00Z',
          since: '2026-11-18T06:00:00Z',
          error: 'El token de Mifact venció o no es válido',
        },
      },
      false,
    );
    expect(el.textContent).toContain('Solo soporte técnico cambia esta configuración');
    // La revisión automática dice cómo está la conexión
    expect(el.textContent).toContain('Conexión con Mifact');
    expect(el.textContent).toContain('El token no funciona');
    expect(el.textContent).toContain('Se revisa sola cada 6 horas');
    expect(el.querySelector<HTMLInputElement>('input[value="MIFACT"]')!.disabled).toBe(true);
    expect(
      [...el.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Guardar'),
    ).toBe(false);
    const token = el.querySelector<HTMLInputElement>('#new-token')!;
    token.value = 'token-nuevo-de-mifact';
    token.dispatchEvent(new Event('input'));
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Probar y guardar'))!
      .click();
    const req = http.expectOne({ method: 'PUT', url: '/api/billing/settings/token' });
    expect(req.request.body).toEqual({ apiToken: 'token-nuevo-de-mifact' });
    req.flush({
      ...saved,
      enabled: true,
      provider: 'MIFACT',
      hasToken: true,
      health: { state: 'OK', checkedAt: '2026-11-18T12:00:00Z', since: null, error: null },
    });
    // El aviso rojo se apaga enseguida
    http.expectOne('/api/notifications').flush({ alerts: [], events: [], banners: [] });
    fixture.detectChanges();
    expect(el.textContent).toContain('Funciona');
    expect(el.textContent).not.toContain('El token no funciona');
  });
});
