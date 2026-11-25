import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Public } from '../common/auth/public.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import { PortalService } from './portal.service.js';
import type { PortalLinkStatus, PortalView } from './portal.service.js';

/** El personal crea, consulta y revoca el enlace del portal de cada cliente. */
@Controller('clients/:id/portal')
export class PortalLinksController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PortalLinkStatus> {
    return this.portal.status(user.clinicId, id);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<{ token: string; expiresAt: Date }> {
    return this.portal.create(user, id, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<void> {
    return this.portal.revoke(user, id, req.ip);
  }
}

/** Lo que ve el dueño con su enlace (sin sesión). Limitado para que no se puedan probar tokens. */
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  view(@Param('token') token: string): Promise<PortalView> {
    return this.portal.view(token);
  }

  /** Calendario para suscribirse desde Google, iPhone u Outlook (refuerzos y citas con alarma) */
  @Get(':token/calendario.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="mascotas.ics"')
  @Header('Cache-Control', 'private, max-age=3600')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  calendar(@Param('token') token: string): Promise<string> {
    return this.portal.calendar(token);
  }

  @Get(':token/manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  manifest(@Param('token') token: string): Promise<Record<string, unknown>> {
    return this.portal.manifest(token);
  }

  @Get(':token/logo')
  @Header('Cache-Control', 'private, max-age=3600')
  async logo(@Param('token') token: string): Promise<StreamableFile> {
    const { data, mime } = await this.portal.logo(token);
    return new StreamableFile(data, {
      type: mime,
      disposition: 'inline',
      length: data.length,
    });
  }
}
