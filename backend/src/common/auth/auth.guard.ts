import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthUser, SESSION_COOKIE, SessionPayload } from './auth-user.js';
import { ALLOW_TEMPORARY_PASSWORD_KEY } from './allow-temporary-password.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * Guard global: toda la API exige sesión salvo los endpoints con @Public().
 * Revisa la base de datos en cada petición para que una cuenta desactivada
 * o un cambio de rol surta efecto de inmediato, sin esperar a que venza la sesión.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (!token) throw new UnauthorizedException('Inicia sesión para continuar');

    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException(
        'Tu sesión expiró. Inicia sesión de nuevo',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        clinicId: true,
        role: true,
        active: true,
        mustChangePassword: true,
        sessionVersion: true,
        clinic: { select: { active: true } },
      },
    });
    if (!user || !user.active || !user.clinic.active) {
      throw new UnauthorizedException('Tu cuenta no está activa');
    }
    // Tokens firmados antes de existir la versión cuentan como versión 0
    if ((payload.sv ?? 0) !== user.sessionVersion) {
      throw new UnauthorizedException(
        'Tu contraseña cambió. Inicia sesión de nuevo',
      );
    }

    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_TEMPORARY_PASSWORD_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed)
        throw new ForbiddenException(
          'Cambia tu contraseña temporal para continuar',
        );
    }

    req.user = { id: user.id, clinicId: user.clinicId, role: user.role };
    return true;
  }
}
