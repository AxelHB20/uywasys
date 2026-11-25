import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { ActivityQuery, ActivityReviewQuery } from './activity.dto.js';
import {
  ActivityPage,
  ActivityReview,
  ActivityService,
} from './activity.service.js';

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

  /** GET /api/activity/review — cuántas cosas para revisar hay, por grupo (7 días por defecto) */
  @Get('review')
  review(
    @CurrentUser() user: AuthUser,
    @Query() query: ActivityReviewQuery,
  ): Promise<ActivityReview> {
    return this.activity.review(user.clinicId, query);
  }
}
