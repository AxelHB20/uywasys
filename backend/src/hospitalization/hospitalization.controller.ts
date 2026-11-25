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
import {
  AdmitDto,
  BoardQueryDto,
  DischargeDto,
  EntryDto,
  OrderDto,
  UpdateHospitalizationDto,
} from './dto/hospitalization.dto.js';
import { HospitalizationService } from './hospitalization.service.js';
import type {
  HospitalizationCard,
  HospitalizationDetail,
} from './hospitalization.service.js';

/**
 * Hospitalización. La ven recepción, veterinarios y el administrador; internan, indican y dan
 * de alta veterinarios y el administrador. Registrar dosis, signos y notas: todo el equipo clínico.
 */
@Roles(...FRONT_DESK_ROLES)
@Controller('hospitalizations')
export class HospitalizationController {
  constructor(private readonly hosp: HospitalizationService) {}

  @Get()
  board(
    @CurrentUser() user: AuthUser,
    @Query() query: BoardQueryDto,
  ): Promise<HospitalizationCard[]> {
    return this.hosp.board(user.clinicId, query.recentDays ?? 3);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HospitalizationDetail> {
    return this.hosp.get(user.clinicId, id);
  }

  @Roles('ADMIN', 'VET')
  @Post()
  admit(
    @CurrentUser() user: AuthUser,
    @Body() dto: AdmitDto,
    @Req() req: Request,
  ): Promise<HospitalizationDetail> {
    return this.hosp.admit(user, dto, req.ip);
  }

  @Roles('ADMIN', 'VET')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHospitalizationDto,
  ): Promise<HospitalizationDetail> {
    return this.hosp.update(user, id, dto);
  }

  @Roles('ADMIN', 'VET')
  @Post(':id/orders')
  addOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OrderDto,
    @Req() req: Request,
  ): Promise<HospitalizationDetail> {
    return this.hosp.addOrder(user, id, dto, req.ip);
  }

  @Roles('ADMIN', 'VET')
  @Post(':id/orders/:orderId/stop')
  stopOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Req() req: Request,
  ): Promise<HospitalizationDetail> {
    return this.hosp.stopOrder(user, id, orderId, req.ip);
  }

  @Post(':id/entries')
  addEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EntryDto,
  ): Promise<HospitalizationDetail> {
    return this.hosp.addEntry(user, id, dto);
  }

  @Roles('ADMIN', 'VET')
  @Post(':id/discharge')
  discharge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DischargeDto,
    @Req() req: Request,
  ): Promise<HospitalizationDetail> {
    return this.hosp.discharge(user, id, dto, req.ip);
  }
}
