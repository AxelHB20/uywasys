import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NotificationsService } from '../../services/notifications.service';
import { SystemBanner } from '../../services/notifications.models';
import { SystemBannersComponent } from './system-banners.component';

const stopped: SystemBanner = {
  id: 'billing:TOKEN:2026-11-18T11:00:00.000Z',
  tone: 'danger',
  title: 'La facturación está detenida',
  detail: 'El token de Mifact no funciona desde las 06:00. Puedes seguir cobrando.',
  action: { label: 'Actualizar token', link: '/comprobantes/configuracion' },
  dismissible: false,
};
const offline: SystemBanner = {
  id: 'billing:UNREACHABLE:x',
  tone: 'warning',
  title: 'Sin conexión con Mifact',
  detail: 'Los comprobantes se reintentan solos.',
  dismissible: true,
};

describe('SystemBannersComponent', () => {
  function render(banners: SystemBanner[]) {
    TestBed.configureTestingModule({
      imports: [SystemBannersComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(NotificationsService).banners.set(banners);
    const fixture = TestBed.createComponent(SystemBannersComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => localStorage.removeItem('uywa.banners-hidden'));

  it('sin problemas no muestra nada', () => {
    const { el } = render([]);
    expect(el.querySelector('section')).toBeNull();
  });

  it('el rojo va primero, se anuncia como alerta, lleva su acción y no se puede ocultar', () => {
    const { fixture, el } = render([offline, stopped]);
    const sections = el.querySelectorAll('section');
    expect(sections).toHaveLength(1);
    expect(sections[0].getAttribute('role')).toBe('alert');
    expect(sections[0].textContent).toContain('La facturación está detenida');
    const link = sections[0].querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/comprobantes/configuracion');
    expect(link.textContent?.trim()).toBe('Actualizar token');
    expect(sections[0].querySelector('[aria-label^="Ocultar"]')).toBeNull();

    // "+1 aviso" abre el resto
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('+1 aviso'))!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('section')).toHaveLength(2);
    expect(el.querySelectorAll('section')[1].getAttribute('role')).toBe('status');
  });

  it('el ámbar se oculta hasta mañana y lo recuerda', () => {
    const { fixture, el } = render([offline]);
    el.querySelector<HTMLButtonElement>('[aria-label^="Ocultar hasta mañana"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('section')).toBeNull();
    expect(localStorage.getItem('uywa.banners-hidden')).toContain(offline.id);
  });
});
