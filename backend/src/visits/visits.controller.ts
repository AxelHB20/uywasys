import {
  ForbiddenException,
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
import { CASH_ROLES, FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import { ChargesService } from './charges.service.js';
import type {
  ClientAccount,
  CreatedCharges,
  ShortageView,
} from './charges.service.js';
import {
  CreateChargesDto,
  ListShortagesQuery,
  ResolveShortageDto,
  TransportPriceDto,
  VoidChargeDto,
} from './dto/charge.dto.js';
import {
  AddendumDto,
  CancelVisitDto,
  ListVisitsQuery,
  OpenVisitDto,
  UpdateVisitDto,
} from './dto/visit.dto.js';
import type {
  ChargeView,
  PetHistory,
  VisitContext,
  VisitDetail,
} from './visit.views.js';
import { TransportService } from './transport.service.js';
import { VisitsService } from './visits.service.js';

/** Atenciones. Todo el personal consulta; atienden veterinario, recepción y administrador. */
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListVisitsQuery) {
    return this.visits.list(user.clinicId, query, user.role);
  }

  @Get('diagnoses')
  diagnoses(@CurrentUser() user: AuthUser): Promise<string[]> {
    return this.visits.diagnoses(user.clinicId, user.role);
  }

  @Get('pet/:petId/weights')
  weights(
    @CurrentUser() user: AuthUser,
    @Param('petId', ParseIntPipe) petId: number,
  ): Promise<{ at: Date; kg: number }[]> {
    return this.visits.weights(user.clinicId, petId, user.role);
  }

  @Get('pet/:petId/history')
  history(
    @CurrentUser() user: AuthUser,
    @Param('petId', ParseIntPipe) petId: number,
  ): Promise<PetHistory> {
    return this.visits.history(user.clinicId, petId, user.role);
  }

  @Get(':id/context')
  context(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<VisitContext> {
    return this.visits.context(user.clinicId, id, user.role);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<VisitDetail> {
    return this.visits.get(user.clinicId, id, user.role);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post()
  open(
    @CurrentUser() user: AuthUser,
    @Body() dto: OpenVisitDto,
    @Req() req: Request,
  ): Promise<VisitDetail> {
    // La consulta queda a nombre de quien la abre: recepción no atiende pacientes
    if (user.role === 'RECEPTION')
      throw new ForbiddenException(
        'La consulta la abre el veterinario. Pasa al paciente a "En espera".',
      );
    return this.visits.open(user, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVisitDto,
  ): Promise<VisitDetail> {
    return this.visits.update(user, id, dto);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<VisitDetail> {
    return this.visits.close(user, id, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelVisitDto,
    @Req() req: Request,
  ): Promise<VisitDetail> {
    return this.visits.cancel(user, id, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/addenda')
  addendum(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddendumDto,
    @Req() req: Request,
  ): Promise<VisitDetail> {
    return this.visits.addAddendum(user, id, dto, req.ip);
  }
}

/** Cargos y cuenta del cliente. */
@Controller()
export class ChargesController {
  constructor(
    private readonly charges: ChargesService,
    private readonly transport: TransportService,
  ) {}

  @Roles(...FRONT_DESK_ROLES)
  @Post('charges')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateChargesDto,
    @Req() req: Request,
  ): Promise<CreatedCharges> {
    return this.charges.create(user, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post('charges/:id/void')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidChargeDto,
    @Req() req: Request,
  ): Promise<ChargeView> {
    return this.charges.void(user, id, dto, req.ip);
  }

  @Roles(...CASH_ROLES)
  @Patch('charges/:id/transport-price')
  transportPrice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransportPriceDto,
    @Req() req: Request,
  ): Promise<ChargeView> {
    return this.transport.changePrice(user, id, dto.price, req.ip);
  }

  /** Último precio de movilidad del cliente: se propone al marcar la movilidad */
  @Get('clients/:id/transport-price')
  async lastTransportPrice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ price: number | null }> {
    return { price: await this.transport.lastPrice(user.clinicId, id) };
  }

  @Get('clients/:id/account')
  account(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClientAccount> {
    return this.charges.account(user.clinicId, id);
  }

  @Roles('ADMIN', 'VET')
  @Get('inventory/shortages')
  shortages(
    @CurrentUser() user: AuthUser,
    @Query() query: ListShortagesQuery,
  ): Promise<ShortageView[]> {
    return this.charges.shortages(user.clinicId, query);
  }

  @Roles('ADMIN')
  @Post('inventory/shortages/:id/resolve')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveShortageDto,
    @Req() req: Request,
  ): Promise<{ id: number }> {
    return this.charges.resolveShortage(user, id, dto, req.ip);
  }
}
