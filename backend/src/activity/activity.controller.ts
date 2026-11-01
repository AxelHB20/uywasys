import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { ActivityQuery } from './activity.dto.js';
import { ActivityPage, ActivityService } from './activity.service.js';

/** GET /api/activity — bitácora de la clínica. Solo el administrador. */
@Roles('ADMIN')
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ActivityQuery,
  ): Promise<ActivityPage> {
    return this.activity.list(user.clinicId, query);
  }
}
