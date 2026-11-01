import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BillingSettings } from '../../core/services/billing.models';
import { tick } from '../../shared/testing';
import { BillingSettingsPage } from './billing-settings.page';

const saved: BillingSettings = {
  enabled: true,
  provider: 'SIMULATED',
  production: false,
  legalName: 'Veterinaria Demo S.A.C.',
  apiUrl: null,
  hasToken: false,
  boletaSeries: 'B001',
  facturaSeries: 'F001',
  boletaCreditSeries: 'BC01',
  facturaCreditSeries: 'FC01',
  missing: [],
};

describe('BillingSettingsPage', () => {
  let http: HttpTestingController;

  async function render(settings = saved) {
    TestBed.configureTestingModule({
      imports: [BillingSettingsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
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
    return { fixture, el, set };
  }

  afterEach(() => http.verify());

  it('al elegir Nubefact pide ruta y token; el token guardado no se reenvía si no se cambia', async () => {
    const { fixture, el, set } = await render({
      ...saved,
      provider: 'NUBEFACT',
      apiUrl: 'https://api.nubefact.com/x',
      hasToken: true,
    });
    expect(el.querySelector<HTMLInputElement>('#bill-token')!.placeholder).toContain('Guardado');
    set('#s-boletaSeries', 'b002');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'PUT', url: '/api/billing/settings' });
    expect(req.request.body).toMatchObject({
      provider: 'NUBEFACT',
      apiToken: null,
      boletaSeries: 'B002',
    });
    req.flush({ ...saved, provider: 'NUBEFACT', boletaSeries: 'B002' });
    fixture.detectChanges();
  });

  it('muestra lo que falta para activar con el PSE y no deja una serie mal escrita', async () => {
    const { el, set } = await render({
      ...saved,
      enabled: false,
      provider: 'NUBEFACT',
      missing: ['el token del PSE'],
    });
    expect(el.textContent).toContain('Para activar con el PSE falta');
    expect(el.textContent).toContain('el token del PSE');
    set('#s-facturaSeries', 'B001');
    el.querySelector<HTMLInputElement>('#s-facturaSeries')!.dispatchEvent(new Event('blur'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectNone('/api/billing/settings');
  });
});
