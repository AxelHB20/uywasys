import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AllowTemporaryPassword } from '../common/auth/allow-temporary-password.decorator.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Public } from '../common/auth/public.decorator.js';
import { SESSION_COOKIE } from '../common/auth/auth-user.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import type { SessionUser } from './session-user.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Inicia sesión. El token viaja en una cookie httpOnly que JavaScript no puede leer.
   * Además del bloqueo por cuenta, cada conexión tiene pocos intentos por minuto: así nadie
   * prueba contraseñas en muchas cuentas ni bloquea a propósito la del administrador.
   */
  @Public()
  @Throttle({ default: { limit: loginRateLimit, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SessionUser }> {
    const { token, user } = await this.auth.login(
      dto.email,
      dto.password,
      req.ip,
    );
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
    return { user };
  }

  /** Usuario de la sesión actual (lo usa el frontend al abrir la app). */
  @AllowTemporaryPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.me(user.id);
  }

  /** Cambia la contraseña del usuario actual (obligatorio si entró con una clave temporal). */
  @AllowTemporaryPassword()
  @Patch('password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    const result = await this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      req.ip,
    );
    // Las demás sesiones quedan cerradas; esta sigue con un token de la versión nueva
    res.cookie(SESSION_COOKIE, result.token, this.cookieOptions());
    return result.user;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    res.clearCookie(SESSION_COOKIE, options);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<boolean>('COOKIE_SECURE', false),
      path: '/',
      maxAge: this.config.get<number>('SESSION_HOURS', 8) * 60 * 60 * 1000,
    };
  }
}

/** Se lee al momento (ConfigModule ya cargó el .env en process.env). */
function loginRateLimit(): number {
  const value = Number(process.env.LOGIN_RATE_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : 10;
}
