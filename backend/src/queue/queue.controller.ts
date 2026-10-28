import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import {
  CreateQueueEntryDto,
  QueueDayQuery,
  UpdateQueueEntryDto,
} from './dto/queue.dto.js';
import { QueueService } from './queue.service.js';
import type { QueueItem } from './queue.service.js';

@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueueDayQuery,
  ): Promise<{ day: string; items: QueueItem[] }> {
    return this.queue.list(user.clinicId, query.day);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateQueueEntryDto,
  ): Promise<QueueItem> {
    return this.queue.create(user, dto);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQueueEntryDto,
  ): Promise<QueueItem> {
    return this.queue.update(user, id, dto);
  }
}
