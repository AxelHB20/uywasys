import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';

function context(role: string): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 1, clinicId: 1, role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('deja pasar cuando el endpoint no exige rol', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(context('GROOMER'))).toBe(
      true,
    );
  });

  it('deja pasar a un rol permitido', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['ADMIN', 'CASHIER']),
    } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(context('CASHIER'))).toBe(
      true,
    );
  });

  it('responde 403 a un rol sin permiso', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['ADMIN']),
    } as unknown as Reflector;
    expect(() =>
      new RolesGuard(reflector).canActivate(context('GROOMER')),
    ).toThrow(ForbiddenException);
  });
});
