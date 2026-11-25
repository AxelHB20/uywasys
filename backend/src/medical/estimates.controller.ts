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
  ConvertEstimateDto,
  CreateEstimateDto,
  DecideEstimateDto,
  ListEstimatesQuery,
} from './dto/estimate.dto.js';
import { EstimatesService } from './estimates.service.js';
import type {
  EstimatePrint,
  EstimatesSummary,
  EstimateView,
} from './estimates.service.js';

/** Presupuestos: todos los ven; los emiten y gestionan veterinario, recepción y administrador. */
@Controller('estimates')
export class EstimatesController {
  constructor(private readonly estimates: EstimatesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListEstimatesQuery,
  ): Promise<EstimateView[]> {
    return this.estimates.list(user.clinicId, query);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser): Promise<EstimatesSummary> {
    return this.estimates.summary(user.clinicId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EstimatePrint> {
    return this.estimates.get(user.clinicId, id);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEstimateDto,
    @Req() req: Request,
  ): Promise<EstimatePrint> {
    return this.estimates.create(user, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideEstimateDto,
    @Req() req: Request,
  ): Promise<EstimatePrint> {
    return this.estimates.accept(user, id, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideEstimateDto,
    @Req() req: Request,
  ): Promise<EstimatePrint> {
    return this.estimates.reject(user, id, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/convert')
  convert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConvertEstimateDto,
    @Req() req: Request,
  ): Promise<EstimatePrint> {
    return this.estimates.convert(user, id, dto, req.ip);
  }
}
