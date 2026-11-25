import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Public } from '../common/auth/public.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import type { ReminderMark } from './reminder-marks.js';
import {
  MarkReminderDto,
  PushSubscribeDto,
  PushUnsubscribeDto,
} from './reminders.dto.js';
import { RemindersService } from './reminders.service.js';
import type { TomorrowAppointment } from './reminders.service.js';

/** Recepción: citas de mañana por avisar y marcar lo que ya se avisó por WhatsApp. */
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('appointments')
  tomorrow(@CurrentUser() user: AuthUser): Promise<TomorrowAppointment[]> {
    return this.reminders.tomorrow(user.clinicId);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post('sent')
  @HttpCode(HttpStatus.OK)
  mark(
    @CurrentUser() user: AuthUser,
    @Body() dto: MarkReminderDto,
  ): Promise<ReminderMark[]> {
    return this.reminders.markSent(user, dto);
  }
}

/** Portal del dueño: activar o quitar los avisos al celular (sin sesión, con su enlace). */
@Public()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('portal')
export class PortalNoticesController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('avisos/clave')
  @Header('Cache-Control', 'public, max-age=86400')
  async key(): Promise<{ publicKey: string }> {
    return { publicKey: await this.reminders.publicKey() };
  }

  @Post(':token/avisos')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(
    @Param('token') token: string,
    @Body() dto: PushSubscribeDto,
  ): Promise<void> {
    return this.reminders.subscribe(token, dto);
  }

  @Post(':token/avisos/quitar')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(
    @Param('token') token: string,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<void> {
    return this.reminders.unsubscribe(token, dto.endpoint);
  }
}
