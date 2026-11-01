import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import {
  CreateImmunizationDto,
  DueImmunizationsQuery,
  VoidImmunizationDto,
} from './dto/immunization.dto.js';
import type { ImmunizationView } from './immunization.views.js';
import { ImmunizationsService } from './immunizations.service.js';
import type {
  DueImmunization,
  ImmunizationCard,
} from './immunizations.service.js';

/** Vacunas y desparasitaciones. Todo el personal consulta; registran veterinario, recepción y administrador. */
@Controller()
export class ImmunizationsController {
  constructor(private readonly immunizations: ImmunizationsService) {}

  @Get('pets/:id/immunizations')
  forPet(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ImmunizationView[]> {
    return this.immunizations.forPet(user.clinicId, id);
  }

  @Get('pets/:id/immunization-card')
  card(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ImmunizationCard> {
    return this.immunizations.card(user.clinicId, id);
  }

  @Get('immunizations/due')
  due(
    @CurrentUser() user: AuthUser,
    @Query() query: DueImmunizationsQuery,
  ): Promise<DueImmunization[]> {
    return this.immunizations.due(user.clinicId, query);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post('immunizations')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateImmunizationDto,
    @Req() req: Request,
  ): Promise<ImmunizationView> {
    return this.immunizations.create(user, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post('immunizations/:id/void')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidImmunizationDto,
    @Req() req: Request,
  ): Promise<ImmunizationView> {
    return this.immunizations.void(user, id, dto, req.ip);
  }
}
