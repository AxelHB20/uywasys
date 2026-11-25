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
import { GROOMING_ROLES } from '../common/auth/staff-roles.js';
import {
  AssignDto,
  BoardQuery,
  CancelGroomingDto,
  CheckInDto,
  DeliverDto,
  MoveDto,
  TransportDto,
} from './dto/grooming.dto.js';
import { GroomingService } from './grooming.service.js';
import type { Groomer } from './grooming.service.js';
import type { GroomingCard, GroomingDetail } from './grooming.views.js';

/**
 * Baño y peluquería: todos ven el tablero; ingresan, mueven y entregan recepción, groomers,
 * veterinarios y el administrador. Cancelar (quita los cargos) solo recepción y administrador.
 */
@Controller()
export class GroomingController {
  constructor(private readonly grooming: GroomingService) {}

  @Get('grooming')
  board(
    @CurrentUser() user: AuthUser,
    @Query() query: BoardQuery,
  ): Promise<GroomingCard[]> {
    return this.grooming.board(user.clinicId, query);
  }

  @Get('grooming/groomers')
  groomers(@CurrentUser() user: AuthUser): Promise<Groomer[]> {
    return this.grooming.groomers(user.clinicId);
  }

  @Get('grooming/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GroomingDetail> {
    return this.grooming.get(user.clinicId, id);
  }

  @Get('pets/:id/grooming')
  forPet(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) petId: number,
  ): Promise<GroomingCard[]> {
    return this.grooming.forPet(user.clinicId, petId);
  }

  @Roles(...GROOMING_ROLES)
  @Post('grooming')
  checkIn(
    @CurrentUser() user: AuthUser,
    @Body() dto: CheckInDto,
    @Req() req: Request,
  ): Promise<GroomingDetail> {
    return this.grooming.checkIn(user, dto, req.ip);
  }

  @Roles(...GROOMING_ROLES)
  @Patch('grooming/:id/status')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveDto,
    @Req() req: Request,
  ): Promise<GroomingCard> {
    return this.grooming.move(user, id, dto, req.ip);
  }

  /** El dueño ya no puede volver: se lo llevamos (o se quita la movilidad) */
  @Roles('ADMIN', 'RECEPTION')
  @Patch('grooming/:id/transport')
  transport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransportDto,
    @Req() req: Request,
  ): Promise<GroomingDetail> {
    return this.grooming.changeTransport(user, id, dto, req.ip);
  }

  @Roles(...GROOMING_ROLES)
  @Patch('grooming/:id/groomer')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignDto,
    @Req() req: Request,
  ): Promise<GroomingCard> {
    return this.grooming.assign(user, id, dto, req.ip);
  }

  @Roles(...GROOMING_ROLES)
  @Post('grooming/:id/notify')
  notify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GroomingCard> {
    return this.grooming.notify(user, id);
  }

  @Roles(...GROOMING_ROLES)
  @Post('grooming/:id/deliver')
  deliver(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverDto,
    @Req() req: Request,
  ): Promise<GroomingDetail> {
    return this.grooming.deliver(user, id, dto, req.ip);
  }

  @Roles('ADMIN', 'RECEPTION')
  @Post('grooming/:id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelGroomingDto,
    @Req() req: Request,
  ): Promise<GroomingDetail> {
    return this.grooming.cancel(user, id, dto, req.ip);
  }
}
