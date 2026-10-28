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
import { CASH_ROLES } from '../common/auth/staff-roles.js';
import { CashService } from './cash.service.js';
import type { ReceiptTicket, SessionSummary } from './cash.service.js';
import {
  CashVoidDto,
  CloseSessionDto,
  CollectDto,
  CounterSaleDto,
  ExpenseDto,
  OpenSessionDto,
  SalesReportQuery,
  SessionsQuery,
} from './dto/cash.dto.js';

/** Caja. Cajero, recepción y administrador; anular cobros y egresos, solo el administrador. */
@Roles(...CASH_ROLES)
@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('registers')
  registers(@CurrentUser() user: AuthUser) {
    return this.cash.registers(user.clinicId);
  }

  @Get('sessions/current')
  current(
    @CurrentUser() user: AuthUser,
    @Query('registerId') registerId?: string,
  ): Promise<SessionSummary | null> {
    return this.cash.current(
      user.clinicId,
      registerId ? Number(registerId) || undefined : undefined,
    );
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser, @Query() query: SessionsQuery) {
    return this.cash.sessions(user.clinicId, query.page);
  }

  @Get('sessions/:id')
  summary(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SessionSummary> {
    return this.cash.summary(user.clinicId, id);
  }

  @Post('sessions')
  open(
    @CurrentUser() user: AuthUser,
    @Body() dto: OpenSessionDto,
    @Req() req: Request,
  ): Promise<SessionSummary> {
    return this.cash.open(user, dto, req.ip);
  }

  @Post('sessions/:id/close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseSessionDto,
    @Req() req: Request,
  ): Promise<SessionSummary> {
    return this.cash.close(user, id, dto, req.ip);
  }

  @Post('receipts')
  collect(
    @CurrentUser() user: AuthUser,
    @Body() dto: CollectDto,
    @Req() req: Request,
  ): Promise<ReceiptTicket> {
    return this.cash.collect(user, dto, req.ip);
  }

  @Post('counter-sales')
  counterSale(
    @CurrentUser() user: AuthUser,
    @Body() dto: CounterSaleDto,
    @Req() req: Request,
  ) {
    return this.cash.counterSale(user, dto, req.ip);
  }

  @Get('receipts/:id')
  ticket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptTicket> {
    return this.cash.ticket(user.clinicId, id);
  }

  @Roles('ADMIN')
  @Post('receipts/:id/void')
  voidReceipt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CashVoidDto,
    @Req() req: Request,
  ): Promise<ReceiptTicket> {
    return this.cash.voidReceipt(user, id, dto, req.ip);
  }

  @Post('expenses')
  expense(
    @CurrentUser() user: AuthUser,
    @Body() dto: ExpenseDto,
    @Req() req: Request,
  ): Promise<SessionSummary> {
    return this.cash.expense(user, dto, req.ip);
  }

  @Roles('ADMIN')
  @Post('expenses/:id/void')
  voidExpense(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CashVoidDto,
    @Req() req: Request,
  ): Promise<SessionSummary> {
    return this.cash.voidExpense(user, id, dto, req.ip);
  }

  @Roles('ADMIN')
  @Get('report')
  report(@CurrentUser() user: AuthUser, @Query() query: SalesReportQuery) {
    return this.cash.report(user.clinicId, query);
  }
}
