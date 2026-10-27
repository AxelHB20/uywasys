import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const admin: AuthUser = { id: 1, clinicId: 10, role: 'ADMIN' };

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    fullName: 'Luis Rojas',
    email: 'luis@uywa.pe',
    role: 'RECEPTION',
    licenseNumber: null,
    active: true,
    mustChangePassword: false,
    lockedUntil: null,
    lastLoginAt: null,
    ...overrides,
  };
}

function setup(target: ReturnType<typeof member> | null, otherAdmins = 1) {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(target),
      count: vi.fn().mockResolvedValue(otherAdmins),
      update: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...target, ...data }),
        ),
    },
  };
  const audit = { log: vi.fn() };
  return {
    service: new UsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    prisma,
    audit,
  };
}

describe('UsersService', () => {
  it('no deja que el administrador se desactive a sí mismo', async () => {
    const { service } = setup(member({ id: 1, role: 'ADMIN' }));
    await expect(
      service.update(admin, 1, { active: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no deja la clínica sin un administrador activo', async () => {
    const { service } = setup(member({ id: 3, role: 'ADMIN' }), 0);
    await expect(
      service.update(admin, 3, { role: 'VET', licenseNumber: '1234' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('permite quitar el rol de administrador si queda otro activo', async () => {
    const { service, audit } = setup(member({ id: 3, role: 'ADMIN' }), 1);
    const updated = await service.update(admin, 3, { role: 'CASHIER' });
    expect(updated.role).toBe('CASHIER');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.update' }),
    );
  });

  it('exige la colegiatura al convertir a alguien en veterinario', async () => {
    const { service } = setup(member());
    await expect(service.update(admin, 2, { role: 'VET' })).rejects.toThrow(
      'colegiatura',
    );
  });

  it('registra la desactivación en la bitácora', async () => {
    const { service, audit } = setup(member());
    await service.update(admin, 2, { active: false });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deactivate' }),
    );
  });

  it('no busca usuarios fuera de la clínica del administrador', async () => {
    const { service, prisma } = setup(null);
    await expect(
      service.update(admin, 99, { fullName: 'Otro' }),
    ).rejects.toThrow('El usuario no existe');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, clinicId: 10 } }),
    );
  });

  it('no restablece la propia contraseña desde la gestión de usuarios', async () => {
    const { service } = setup(member({ id: 1 }));
    await expect(service.resetPassword(admin, 1)).rejects.toThrow(
      'Cambiar contraseña',
    );
  });
});
