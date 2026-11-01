import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { CASH_ROLES } from '../common/auth/staff-roles.js';
import {
  BillingSettingsDto,
  DocumentsQuery,
  ReportQuery,
} from './billing.dto.js';
import { BillingSender } from './billing.sender.js';
import {
  BillingService,
  BillingSettingsView,
  BillingStatus,
  DocumentSummary,
} from './billing.service.js';

/** Facturación electrónica: configuración (administrador) y comprobantes emitidos (caja). */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly sender: BillingSender,
  ) {}

  /** Si se emiten boletas y facturas (la caja lo consulta para mostrar las opciones). */
  @Get('status')
  status(@CurrentUser() user: AuthUser): Promise<BillingStatus> {
    return this.billing.status(user.clinicId);
  }

  @Roles('ADMIN')
  @Get('settings')
  settings(@CurrentUser() user: AuthUser): Promise<BillingSettingsView> {
    return this.billing.settings(user.clinicId);
  }

  @Roles('ADMIN')
  @Put('settings')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: BillingSettingsDto,
    @Req() req: Request,
  ): Promise<BillingSettingsView> {
    return this.billing.updateSettings(user, dto, req.ip);
  }

  @Roles('ADMIN')
  @Post('settings/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentUser() user: AuthUser) {
    return this.billing.test(user.clinicId);
  }

  @Roles(...CASH_ROLES)
  @Get('documents')
  list(@CurrentUser() user: AuthUser, @Query() query: DocumentsQuery) {
    return this.billing.list(user.clinicId, query);
  }

  @Roles('ADMIN')
  @Post('documents/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<DocumentSummary> {
    const doc = await this.billing.retry(user, id, req.ip);
    this.sender.dispatch();
    return doc;
  }

  /** Registro de ventas en Excel para el contador. */
  @Roles('ADMIN')
  @Get('report')
  async report(
    @CurrentUser() user: AuthUser,
    @Query() query: ReportQuery,
  ): Promise<StreamableFile> {
    const file = await this.billing.report(user.clinicId, query.from, query.to);
    return new StreamableFile(file, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="ventas-${query.from}-a-${query.to}.xlsx"`,
      length: file.length,
    });
  }
}
