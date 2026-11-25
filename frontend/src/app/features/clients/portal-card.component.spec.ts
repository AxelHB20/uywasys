import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { stubDialog, tick } from '../../shared/testing';
import { PortalCardComponent } from './portal-card.component';

describe('PortalCardComponent (enlace del portal)', () => {
  let http: HttpTestingController;
  beforeAll(stubDialog);

  async function render(canEdit = true) {
    TestBed.configureTestingModule({
      imports: [PortalCardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PortalCardComponent);
    fixture.componentRef.setInput('clientId', 7);
    fixture.componentRef.setInput('clientName', 'Rosa Quispe');
    fixture.componentRef.setInput('phone', '987654321');
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.detectChanges();
    http.expectOne('/api/clients/7/portal').flush({
      active: false,
      createdAt: null,
      expiresAt: null,
      lastViewedAt: null,
      viewCount: 0,
      createdBy: null,
    });
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('crea el enlace y lo deja listo para copiar o mandar por WhatsApp', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Crear y enviar enlace'))!
      .click();
    http
      .expectOne((r) => r.method === 'POST' && r.url === '/api/clients/7/portal')
      .flush({ token: 'abcdefghijklmnopqrstuvwxyz012345', expiresAt: '2027-05-03T00:00:00Z' });
    await tick();
    http.expectOne('/api/clients/7/portal').flush({
      active: true,
      createdAt: '2026-11-04T00:00:00Z',
      expiresAt: '2027-05-03T00:00:00Z',
      lastViewedAt: null,
      viewCount: 0,
      createdBy: 'Ana',
    });
    await tick();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#portal-url')!;
    expect(input.value).toMatch(/\/p\/abcdefghijklmnopqrstuvwxyz012345$/);
    const wa = el.querySelector<HTMLAnchorElement>('a[href^="https://wa.me/51987654321"]')!;
    expect(decodeURIComponent(wa.href)).toContain('Hola Rosa');
    expect(el.textContent).toContain('Enlace activo hasta');
  });

  it('caja solo ve el estado, sin botones', async () => {
    const el: HTMLElement = (await render(false)).nativeElement;
    expect(el.textContent).not.toContain('Crear y enviar enlace');
  });
});
