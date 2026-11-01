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
  StreamableFile,
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
  CommissionsQuery,
  DeliverDto,
  MoveDto,
} from './dto/grooming.dto.js';
import { GroomingCommissionsService } from './grooming-commissions.service.js';
import type { CommissionReport } from './grooming-commissions.service.js';
import { GroomingService } from './grooming.service.js';
import type { Groomer } from './grooming.service.js';
import type { GroomingCard, GroomingDetail } from './grooming.views.js';

/**
 * Baño y peluquería: todos ven el tablero; ingresan, mueven y entregan recepción, groomers,
 * veterinarios y el administrador. Cancelar (quita los cargos) solo recepción y administrador.
 */
@Controller()
export class GroomingController {
  constructor(
    private readonly grooming: GroomingService,
    private readonly commissions: GroomingCommissionsService,
  ) {}

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

  /** Comisiones del período: el administrador ve a todos; el groomer, lo suyo */
  @Roles('ADMIN', 'GROOMER')
  @Get('grooming/commissions')
  commissionReport(
    @CurrentUser() user: AuthUser,
    @Query() query: CommissionsQuery,
  ): Promise<CommissionReport> {
    return this.commissions.report(user, query);
  }

  @Roles('ADMIN', 'GROOMER')
  @Get('grooming/commissions/excel')
  async commissionExcel(
    @CurrentUser() user: AuthUser,
    @Query() query: CommissionsQuery,
  ): Promise<StreamableFile> {
    const file = await this.commissions.excel(user, query);
    return new StreamableFile(file, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="comisiones-${query.from}-a-${query.to}.xlsx"`,
      length: file.length,
    });
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
