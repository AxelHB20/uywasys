import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { PortalView } from '../../core/services/portal.models';
import { addDays } from '../../core/services/medical.models';
import { limaToday } from '../../shared/utils/dates';
import { tick } from '../../shared/testing';
import { PortalPage } from './portal.page';

const today = limaToday();
const view = (): PortalView => ({
  clinic: { name: 'Vet Sol', address: 'Av. Lima 245', phone: '987000111', hasLogo: false },
  ownerFirstName: 'Rosa',
  expiresAt: '2027-05-03T15:00:00Z',
  showRecords: true,
  pets: [
    {
      id: 1,
      number: 30,
      name: 'Toby',
      species: 'DOG',
      breed: 'Mestizo',
      sex: 'MALE',
      neutered: true,
      birthDate: '2023-01-10',
      birthDateEstimated: false,
      weightKg: 12.5,
      microchip: null,
      immunizations: [
        {
          id: 5,
          kind: 'VACCINE',
          name: 'Séxtuple',
          laboratory: 'Zoetis',
          batchNumber: 'L1',
          appliedAt: addDays(today, -350),
          nextDueAt: addDays(today, 15),
          external: false,
          externalClinic: null,
          appliedBy: 'Dra. Lucía',
          licenseNumber: '08451',
        },
      ],
      appointments: [],
      prescriptions: [],
    },
    {
      id: 2,
      number: 31,
      name: 'Michi',
      species: 'CAT',
      breed: null,
      sex: null,
      neutered: false,
      birthDate: null,
      birthDateEstimated: false,
      weightKg: null,
      microchip: null,
      immunizations: [],
      appointments: [],
      prescriptions: [],
    },
  ],
});

describe('PortalPage (portal del dueño)', () => {
  let http: HttpTestingController;

  async function render(respond: (url: string) => void) {
    TestBed.configureTestingModule({
      imports: [PortalPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PortalPage);
    fixture.componentRef.setInput('token', 'tok_abcdefghijklmnopqrstuvwxyz');
    fixture.detectChanges();
    respond('/api/portal/tok_abcdefghijklmnopqrstuvwxyz');
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('saluda, muestra el carnet, avisa el refuerzo que toca y no se indexa', async () => {
    const fixture = await render((url) => http.expectOne(url).flush(view()));
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Hola, Rosa');
    expect(text).toContain('Séxtuple');
    expect(text).toContain('CMVP 08451');
    expect(text).toContain('Le toca pronto a Toby');
    expect(text).toContain('En 15 días');
    expect(TestBed.inject(Meta).getTag('name="robots"')?.content).toBe('noindex, nofollow');
    // Cambiar de mascota
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Toby', 'Michi']);
    tabs[1].click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Todavía no hay vacunas registradas');
  });

  it('sin carnet: solo próximas dosis, calendario para el celular y su propio manifiesto', async () => {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.webmanifest';
    document.head.appendChild(manifest);
    const fixture = await render((url) =>
      http.expectOne(url).flush({ ...view(), showRecords: false }),
    );
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Próximas vacunas y desparasitaciones');
    expect(text).toContain('El carnet de vacunación te lo entrega la clínica');
    expect(text).not.toContain('Carnet de vacunación');
    expect(text).not.toContain('CMVP 08451');
    // En este navegador de prueba no hay notificaciones: se ofrece el calendario
    expect(text).toContain('Este navegador no permite avisos');
    const links = [...el.querySelectorAll<HTMLAnchorElement>('a')].map((a) => a.href);
    const webcal = links.find((h) => h.startsWith('webcal:'))!;
    expect(webcal).toContain('/api/portal/tok_abcdefghijklmnopqrstuvwxyz/calendario.ics');
    expect(links).toContain(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    );
    expect(manifest.getAttribute('href')).toBe(
      '/api/portal/tok_abcdefghijklmnopqrstuvwxyz/manifest.webmanifest',
    );
    fixture.destroy();
    expect(manifest.getAttribute('href')).toBe('/manifest.webmanifest');
    manifest.remove();
  });

  it('un enlace vencido explica qué hacer', async () => {
    const fixture = await render((url) =>
      http
        .expectOne(url)
        .flush(
          { message: 'Este enlace no es válido o ya venció. Pide uno nuevo a tu veterinaria.' },
          { status: 404, statusText: 'Not Found' },
        ),
    );
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Enlace no disponible');
    expect(text).toContain('Pide uno nuevo');
  });
});
