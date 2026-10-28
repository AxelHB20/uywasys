import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { DashboardService } from './dashboard.service.js';
import type { DashboardSummary } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser): Promise<DashboardSummary> {
    return this.dashboard.summary(user.clinicId);
  }
}
