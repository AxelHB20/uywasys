import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit/audit.service.js';
import type { SessionPayload } from '../common/auth/auth-user.js';
import { hashPassword } from '../common/security/passwords.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SESSION_CLINIC_SELECT,
  SessionUser,
  toSessionUser,
} from './session-user.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

/** Hash de relleno: si el correo no existe se compara igual, para no revelar qué correos están registrados. */
const DUMMY_HASH = bcrypt.hashSync('uywa-correo-inexistente', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    ip?: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        clinic: { select: { ...SESSION_CLINIC_SELECT, active: true } },
      },
    });

    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw lockedAccount(minutesUntil(user.lockedUntil, now));
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      const attempts = user.failedLoginAttempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lock ? 0 : attempts,
          lockedUntil: lock
            ? new Date(now.getTime() + LOCK_MINUTES * 60_000)
            : null,
        },
      });
      await this.audit.log({
        clinicId: user.clinicId,
        userId: user.id,
        entity: 'user',
        entityId: user.id,
        ip,
        action: lock ? 'auth.locked' : 'auth.login_failed',
      });
      throw lock ? lockedAccount(LOCK_MINUTES) : invalidCredentials();
    }

    if (!user.active || !user.clinic.active) {
      throw new UnauthorizedException(
        'Tu cuenta está desactivada. Habla con el administrador de la clínica',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
    });
    await this.audit.log({
      clinicId: user.clinicId,
      userId: user.id,
      entity: 'user',
      entityId: user.id,
      ip,
      action: 'auth.login',
    });

    const payload: SessionPayload = {
      sub: user.id,
      clinicId: user.clinicId,
      role: user.role,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: toSessionUser(user),
    };
  }

  async me(userId: number): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { clinic: { select: SESSION_CLINIC_SELECT } },
    });
    if (!user) throw new NotFoundException('El usuario no existe');
    return toSessionUser(user);
  }

  /** Cambia la contraseña del propio usuario. Si tenía una clave temporal, deja de estar obligado a cambiarla. */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip?: string,
  ): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('El usuario no existe');

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta de la actual',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      },
    });
    await this.audit.log({
      clinicId: user.clinicId,
      userId,
      entity: 'user',
      entityId: userId,
      ip,
      action: 'auth.password_change',
    });
    return this.me(userId);
  }
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException('Correo o contraseña incorrectos');
}

function lockedAccount(minutes: number): HttpException {
  return new HttpException(
    `Cuenta bloqueada por varios intentos fallidos. Intenta de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`,
    HttpStatus.LOCKED,
  );
}

function minutesUntil(date: Date, now: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 60_000));
}
