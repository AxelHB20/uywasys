import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionService } from '../../core/auth/session.service';
import { TeamMember } from '../../core/services/users.service';
import { stubDialog, tick } from '../../shared/testing';
import { UsersPage } from './users.page';

const base: Omit<TeamMember, 'id' | 'fullName' | 'email' | 'role'> = {
  licenseNumber: null,
  commissionPercent: null,
  active: true,
  mustChangePassword: false,
  locked: false,
  lastLoginAt: null,
};

const members: TeamMember[] = [
  {
    ...base,
    id: 1,
    fullName: 'Ana Quispe',
    email: 'ana@uywa.pe',
    role: 'ADMIN',
    lastLoginAt: '2026-10-27T14:00:00Z',
  },
  {
    ...base,
    id: 2,
    fullName: 'Luis Mamani',
    email: 'luis@uywa.pe',
    role: 'VET',
    licenseNumber: '4521',
    mustChangePassword: true,
  },
  {
    ...base,
    id: 3,
    fullName: 'Rosa Huamán',
    email: 'rosa@uywa.pe',
    role: 'CASHIER',
    active: false,
  },
];

describe('UsersPage', () => {
  let http: HttpTestingController;

  beforeAll(stubDialog);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UsersPage],
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
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    http.expectOne('/api/users').flush(members);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('lista al equipo con su estado y no deja desactivarse a uno mismo', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('(tú)');
    expect(rows[0].textContent).not.toContain('Desactivar');
    expect(rows[1].textContent).toContain('Clave temporal');
    expect(rows[1].textContent).toContain('CMVP 4521');
    expect(rows[2].textContent).toContain('Inactivo');
    expect(rows[2].textContent).toContain('Activar');
  });

  it('exige colegiatura para veterinarios y muestra la clave temporal al crear', async () => {
    const { fixture, el } = await render();
    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Nuevo usuario'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const set = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
      fixture.detectChanges();
    };
    set('u-name', 'Carla Rojas');
    set('u-email', 'Carla@Uywa.pe');
    set('u-role', 'VET');
    el.querySelector<HTMLFormElement>('#user-form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(el.textContent).toContain('La colegiatura es obligatoria');
    http.expectNone('/api/users');

    set('u-license', '7788');
    el.querySelector<HTMLFormElement>('#user-form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/users' });
    expect(req.request.body).toEqual({
      fullName: 'Carla Rojas',
      email: 'carla@uywa.pe',
      role: 'VET',
      licenseNumber: '7788',
      commissionPercent: null,
    });
    req.flush({
      user: {
        ...base,
        id: 4,
        fullName: 'Carla Rojas',
        email: 'carla@uywa.pe',
        role: 'VET',
        licenseNumber: '7788',
        mustChangePassword: true,
      },
      temporaryPassword: 'Kvtr-Pmhd-Wxza',
    });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Kvtr-Pmhd-Wxza');
    expect(el.querySelectorAll('tbody tr').length).toBe(4);
  });

  it('desactiva a un usuario después de confirmar', async () => {
    const { fixture, el } = await render();
    const row = el.querySelectorAll('tbody tr')[1];
    (
      Array.from(row.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Desactivar'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('ya no podrá ingresar');

    const confirm = Array.from(el.querySelectorAll('dialog[open] button')).find(
      (b) => b.textContent?.trim() === 'Desactivar',
    ) as HTMLButtonElement;
    confirm.click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/users/2' });
    expect(req.request.body).toEqual({ active: false });
    req.flush({ ...members[1], active: false });
    await tick();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')[1].textContent).toContain('Inactivo');
  });
});
