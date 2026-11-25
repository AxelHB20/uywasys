import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit/audit.service.js';
import { MailService } from '../common/mail/mail.service.js';
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
/** "¿Olvidaste tu contraseña?": el enlace vale 30 minutos; como máximo 3 pedidos por hora y cuenta */
export const RESET_MINUTES = 30;
export const RESET_PER_HOUR = 3;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** Hash de relleno: si el correo no existe se compara igual, para no revelar qué correos están registrados. */
const DUMMY_HASH = bcrypt.hashSync('uywa-correo-inexistente', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Lo que la pantalla de ingreso necesita saber antes de iniciar sesión */
  options(): { passwordReset: boolean } {
    return { passwordReset: this.mail.enabled };
  }

  /**
   * Pide un enlace para crear una contraseña nueva. Siempre responde lo mismo, exista o no el
   * correo, para no revelar quién tiene cuenta. Solo se envía a cuentas activas de clínicas activas.
   */
  async requestPasswordReset(email: string, ip?: string): Promise<void> {
    if (!this.mail.enabled) return;
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { clinic: { select: { name: true, active: true } } },
    });
    if (!user || !user.active || !user.clinic.active) return;

    const now = new Date();
    const recent = await this.prisma.passwordReset.count({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(now.getTime() - 3_600_000) },
      },
    });
    if (recent >= RESET_PER_HOUR) return;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000),
        ip: ip?.slice(0, 64),
      },
    });
    const base = (
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('CORS_ORIGIN')?.split(',')[0] ||
      'http://localhost:4200'
    ).replace(/\/+$/, '');
    const link = `${base}/recuperar?token=${token}`;
    const firstName = user.fullName.split(' ')[0];
    await this.mail.send({
      to: user.email,
      subject: `Crea tu nueva contraseña · ${user.clinic.name}`,
      text: [
        `Hola, ${firstName}:`,
        '',
        `Pediste crear una nueva contraseña para entrar a ${user.clinic.name}.`,
        `Abre este enlace (vale ${RESET_MINUTES} minutos y sirve una sola vez):`,
        link,
        '',
        'Si no fuiste tú, ignora este correo: tu contraseña no cambia.',
      ].join('\n'),
      html: resetEmailHtml(firstName, user.clinic.name, link),
    });
    await this.audit.log({
      clinicId: user.clinicId,
      userId: user.id,
      entity: 'user',
      entityId: user.id,
      ip,
      action: 'auth.reset_requested',
    });
  }

  /**
   * Crea la contraseña nueva con el enlace del correo. Desbloquea la cuenta, quita la clave
   * temporal y cierra las sesiones abiertas en otros equipos. El enlace no se puede volver a usar.
   */
  async resetPassword(
    token: string,
    password: string,
    ip?: string,
  ): Promise<void> {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: { clinic: { select: { active: true } } } } },
    });
    const now = new Date();
    if (
      !reset ||
      reset.usedAt ||
      reset.expiresAt <= now ||
      !reset.user.active ||
      !reset.user.clinic.active
    )
      throw new BadRequestException(
        'El enlace venció o ya se usó. Pide uno nuevo desde "¿Olvidaste tu contraseña?"',
      );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: await hashPassword(password),
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      }),
      // Este enlace y cualquier otro pendiente de la misma cuenta dejan de servir
      this.prisma.passwordReset.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: now },
      }),
    ]);
    await this.audit.log({
      clinicId: reset.user.clinicId,
      userId: reset.userId,
      entity: 'user',
      entityId: reset.userId,
      ip,
      action: 'auth.password_reset',
    });
  }

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

    return { token: await this.sign(user), user: toSessionUser(user) };
  }

  private sign(user: {
    id: number;
    clinicId: number;
    role: SessionPayload['role'];
    sessionVersion: number;
  }): Promise<string> {
    const payload: SessionPayload = {
      sub: user.id,
      clinicId: user.clinicId,
      role: user.role,
      sv: user.sessionVersion,
    };
    return this.jwt.signAsync(payload);
  }

  async me(userId: number): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { clinic: { select: SESSION_CLINIC_SELECT } },
    });
    if (!user) throw new NotFoundException('El usuario no existe');
    return toSessionUser(user);
  }

  /**
   * Cambia la contraseña del propio usuario. Si tenía una clave temporal, deja de estar obligado
   * a cambiarla. Las sesiones abiertas en otros equipos se cierran; esta recibe un token nuevo.
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip?: string,
  ): Promise<{ token: string; user: SessionUser }> {
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

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
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
    return { token: await this.sign(updated), user: await this.me(userId) };
  }
}

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function resetEmailHtml(
  firstName: string,
  clinic: string,
  link: string,
): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:13px;color:#475569">${esc(clinic)}</p>
<h1 style="margin:0 0 16px;font-size:22px">Crea tu nueva contraseña</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Hola, ${esc(firstName)}. Pediste crear una nueva contraseña para entrar al sistema.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#4446c8;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 24px;border-radius:12px">Crear nueva contraseña</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.5">El enlace vale ${RESET_MINUTES} minutos y sirve una sola vez.</p>
<p style="margin:0;font-size:13px;color:#475569;line-height:1.5">Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>
</td></tr></table></td></tr></table></body></html>`;
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
