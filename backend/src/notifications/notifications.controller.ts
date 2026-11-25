import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { NotificationsService } from './notifications.service.js';
import type { NotificationsView } from './notifications.service.js';

/** Campana: pendientes y lo que pasó hoy según el rol. Cualquier usuario con sesión. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  view(@CurrentUser() user: AuthUser): Promise<NotificationsView> {
    return this.notifications.view(user);
  }

  @Post('seen')
  @HttpCode(HttpStatus.OK)
  seen(@CurrentUser() user: AuthUser): Promise<{ seenAt: Date }> {
    return this.notifications.markSeen(user);
  }
}
