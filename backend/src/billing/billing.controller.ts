import {
  Body,
  Controller,
  ForbiddenException,
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
  LookupQuery,
  ReportQuery,
  ToFacturaDto,
  UpdateTokenDto,
} from './billing.dto.js';
import { BillingSender } from './billing.sender.js';
import {
  BillingService,
  BillingSettingsView,
  BillingStatus,
  DocumentSummary,
} from './billing.service.js';

/** La configuración del PSE (token incluido) la ve y la cambia solo soporte técnico */
function supportOnly(user: AuthUser): void {
  if (!user.support)
    throw new ForbiddenException(
      'La configuración de facturación la maneja soporte técnico',
    );
}

/** Facturación electrónica: configuración (soporte técnico) y comprobantes emitidos (caja). */
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
    supportOnly(user);
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

  /** Soporte pega el token nuevo del PSE; solo se guarda si la prueba pasa */
  @Roles('ADMIN')
  @Put('settings/token')
  updateToken(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTokenDto,
    @Req() req: Request,
  ): Promise<BillingSettingsView> {
    supportOnly(user);
    return this.billing.updateToken(user, dto.apiToken, req.ip);
  }

  @Roles('ADMIN')
  @Post('documents/retry-all')
  @HttpCode(HttpStatus.OK)
  async retryAll(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<{ count: number }> {
    const result = await this.billing.retryAll(user, req.ip);
    if (result.count) this.sender.dispatch();
    return result;
  }

  @Roles('ADMIN')
  @Post('settings/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentUser() user: AuthUser) {
    supportOnly(user);
    return this.billing.test(user.clinicId);
  }

  /** Datos de facturación que se proponen para el cliente (RUC propio, guardados o última factura). */
  @Roles(...CASH_ROLES)
  @Get('buyer/:clientId')
  buyer(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ParseIntPipe) clientId: number,
  ) {
    return this.billing.buyerFor(user.clinicId, clientId);
  }

  /**
   * Nombre de un RUC o DNI: lo que ya tiene la clínica o APISPERU. null = escribirlo a mano.
   * También el veterinario: registra clientes y su DNI llena el nombre.
   */
  @Roles(...CASH_ROLES, 'VET')
  @Get('lookup')
  lookup(@CurrentUser() user: AuthUser, @Query() query: LookupQuery) {
    return this.billing.lookup(user.clinicId, query.type, query.number);
  }

  /** Datos de la representación impresa A4 (boleta, factura o nota de crédito). */
  @Roles(...CASH_ROLES)
  @Get('documents/:id/print')
  print(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.billing.printView(user.clinicId, id);
  }

  /** Cambia una boleta por factura: nota de crédito de la boleta y factura por el mismo detalle. */
  @Roles(...CASH_ROLES)
  @Post('documents/:id/factura')
  async toFactura(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToFacturaDto,
    @Req() req: Request,
  ) {
    const result = await this.billing.toFactura(user, id, dto.buyer, req.ip);
    this.sender.dispatch();
    return result;
  }

  /** Corrige un comprobante rechazado: otro del mismo tipo con los datos corregidos */
  @Roles(...CASH_ROLES)
  @Post('documents/:id/reissue')
  async reissue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToFacturaDto,
    @Req() req: Request,
  ) {
    const result = await this.billing.reissue(user, id, dto.buyer, req.ip);
    this.sender.dispatch();
    return result;
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
