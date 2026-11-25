import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { AuditService } from '../common/audit/audit.service.js';
import type { ConfigService } from '@nestjs/config';
import type { MailService } from '../common/mail/mail.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  AuthService,
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
} from './auth.service.js';

const PASSWORD = 'ClaveSegura123';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    clinicId: 1,
    fullName: 'Ana Quispe',
    email: 'ana@uywa.pe',
    passwordHash: HASH,
    role: 'ADMIN',
    licenseNumber: null,
    active: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    clinic: {
      id: 1,
      name: 'Veterinaria Demo',
      logoMime: null,
      logoUpdatedAt: null,
      active: true,
    },
    ...overrides,
  };
}

function setup(user: ReturnType<typeof buildUser> | null) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('token-firmado') };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    audit as unknown as AuditService,
    { enabled: false, send: vi.fn() } as unknown as MailService,
    { get: vi.fn() } as unknown as ConfigService,
  );
  return { service, prisma, jwt, audit };
}

describe('AuthService.login', () => {
  it('inicia sesión con la contraseña correcta y reinicia los intentos fallidos', async () => {
    const { service, prisma, audit } = setup(
      buildUser({ failedLoginAttempts: 3 }),
    );
    const result = await service.login('ANA@uywa.pe ', PASSWORD);

    expect(result.token).toBe('token-firmado');
    expect(result.user).toEqual({
      id: 7,
      fullName: 'Ana Quispe',
      email: 'ana@uywa.pe',
      role: 'ADMIN',
      licenseNumber: null,
      clinic: { id: 1, name: 'Veterinaria Demo', logoUrl: null },
    });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ana@uywa.pe' } }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login' }),
    );
  });

  it('rechaza un correo que no existe con el mismo mensaje que una contraseña incorrecta', async () => {
    const { service } = setup(null);
    await expect(service.login('nadie@uywa.pe', 'x')).rejects.toThrow(
      'Correo o contraseña incorrectos',
    );
  });

  it('suma un intento fallido con la contraseña incorrecta', async () => {
    const { service, prisma } = setup(buildUser({ failedLoginAttempts: 1 }));
    await expect(service.login('ana@uywa.pe', 'mala')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failedLoginAttempts: 2, lockedUntil: null },
      }),
    );
  });

  it(`bloquea la cuenta ${LOCK_MINUTES} minutos al llegar a ${MAX_FAILED_ATTEMPTS} intentos fallidos`, async () => {
    const { service, prisma, audit } = setup(
      buildUser({ failedLoginAttempts: MAX_FAILED_ATTEMPTS - 1 }),
    );
    await expect(service.login('ana@uywa.pe', 'mala')).rejects.toMatchObject({
      status: HttpStatus.LOCKED,
    });

    const data = prisma.user.update.mock.calls[0][0].data as {
      failedLoginAttempts: number;
      lockedUntil: Date;
    };
    expect(data.failedLoginAttempts).toBe(0);
    const minutes = (data.lockedUntil.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(LOCK_MINUTES - 1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.locked' }),
    );
  });

  it('no deja entrar a una cuenta bloqueada aunque la contraseña sea correcta', async () => {
    const { service, jwt } = setup(
      buildUser({ lockedUntil: new Date(Date.now() + 5 * 60_000) }),
    );
    await expect(service.login('ana@uywa.pe', PASSWORD)).rejects.toMatchObject({
      status: HttpStatus.LOCKED,
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('no deja entrar a una cuenta desactivada', async () => {
    const { service, jwt } = setup(buildUser({ active: false }));
    await expect(service.login('ana@uywa.pe', PASSWORD)).rejects.toThrow(
      'Tu cuenta está desactivada',
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
