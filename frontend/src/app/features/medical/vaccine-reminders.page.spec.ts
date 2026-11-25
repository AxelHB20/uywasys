import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { DueImmunization } from '../../core/services/medical.models';
import { tick } from '../../shared/testing';
import { VaccineRemindersPage } from './vaccine-reminders.page';

const due = (id: number, pet: string, extra: Partial<DueImmunization> = {}): DueImmunization => ({
  id,
  kind: 'VACCINE',
  name: 'Antirrábica',
  appliedAt: '2025-11-12',
  nextDueAt: '2026-11-12',
  daysLeft: 2,
  pet: { id: id + 100, number: id, name: pet, species: 'DOG' },
  client: { id: id + 200, name: `Dueño ${pet}`, phone: '987654321' },
  reminded: [],
  autoNotice: false,
  ...extra,
});

describe('VaccineRemindersPage (avisos a los dueños)', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  it('cuenta lo avisado, abre el siguiente WhatsApp y lo marca', async () => {
    TestBed.configureTestingModule({
      imports: [VaccineRemindersPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).user.set({
      id: 9,
      fullName: 'Carmen',
      email: 'c@uywa.pe',
      role: 'RECEPTION',
      mustChangePassword: false,
      clinic: { id: 1, name: 'Vet Sol', logoUrl: null },
    } as never);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const fixture = TestBed.createComponent(VaccineRemindersPage);
    fixture.detectChanges();
    await tick();
    http
      .expectOne((r) => r.url === '/api/immunizations/due')
      .flush([
        due(1, 'Toby', {
          reminded: [{ channel: 'WHATSAPP', sentAt: new Date().toISOString(), by: 'Ana' }],
        }),
        due(2, 'Lola', { autoNotice: true }),
        due(3, 'Rocky'),
      ]);
    await tick();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const text = () => el.textContent!.replace(/\s+/g, ' ');
    expect(text()).toContain('Faltan 2 por avisar');
    expect(text()).toContain('A 1 les llega solo al celular');
    expect(text()).toContain('Le llega solo');
    expect(text()).toContain('Avisado hoy');

    // El siguiente es Rocky: Lola recibe el aviso en su celular
    const next = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Avisar a Dueño'),
    )!;
    expect(next.textContent).toContain('(Rocky)');
    next.click();
    expect(open.mock.calls[0][0]).toContain('https://wa.me/51987654321');
    const req = http.expectOne('/api/reminders/sent');
    expect(req.request.body).toEqual({ kind: 'VACCINE', targetId: 3 });
    req.flush([{ channel: 'WHATSAPP', sentAt: new Date().toISOString(), by: 'Carmen' }]);
    fixture.detectChanges();
    expect(text()).toContain('Faltan 1 por avisar');
    open.mockRestore();
  });
});
