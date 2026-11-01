import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import { AppointmentsService } from './appointments.service.js';
import type { AgendaStaff, AppointmentView } from './appointments.service.js';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQuery,
  UpdateAppointmentDto,
} from './dto/appointment.dto.js';

/** Agenda: todo el personal la ve; agendan y mueven citas recepción, veterinario y administrador. */
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAppointmentsQuery,
  ): Promise<AppointmentView[]> {
    return this.appointments.list(user.clinicId, query);
  }

  @Get('staff')
  staff(@CurrentUser() user: AuthUser): Promise<AgendaStaff[]> {
    return this.appointments.staff(user.clinicId);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAppointmentDto,
    @Req() req: Request,
  ): Promise<AppointmentView> {
    return this.appointments.create(user, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAppointmentDto,
    @Req() req: Request,
  ): Promise<AppointmentView> {
    return this.appointments.update(user, id, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AppointmentView> {
    return this.appointments.confirm(user, id);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/arrive')
  arrive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<AppointmentView> {
    return this.appointments.arrive(user, id, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/no-show')
  noShow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<AppointmentView> {
    return this.appointments.noShow(user, id, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelAppointmentDto,
    @Req() req: Request,
  ): Promise<AppointmentView> {
    return this.appointments.cancel(user, id, dto, req.ip);
  }
}
