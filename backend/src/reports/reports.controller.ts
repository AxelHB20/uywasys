import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { ControlReportService } from './control-report.service.js';
import type { ControlReport } from './control-report.service.js';
import { ReportQuery } from './dto/report.dto.js';
import { InventoryReportService } from './inventory-report.service.js';
import type { InventoryReport } from './inventory-report.service.js';
import { MarginReportService } from './margin-report.service.js';
import type { MarginReport } from './margin-report.service.js';
import { SalesReportService } from './sales-report.service.js';
import type { MonthSummary, SalesReport } from './sales-report.service.js';

/** Fase 7: reportes del negocio. Los ve el administrador. Solo en pantalla (sin Excel). */
@Roles('ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly sales: SalesReportService,
    private readonly margin: MarginReportService,
    private readonly inventory: InventoryReportService,
    private readonly control: ControlReportService,
  ) {}

  /** Inicio del administrador: lo cobrado en el mes contra el mes anterior al mismo día */
  @Get('month')
  month(@CurrentUser() user: AuthUser): Promise<MonthSummary> {
    return this.sales.monthToDate(user.clinicId);
  }

  @Get('sales')
  salesReport(
    @CurrentUser() user: AuthUser,
    @Query() query: ReportQuery,
  ): Promise<SalesReport> {
    return this.sales.report(user.clinicId, query.from, query.to);
  }

  @Get('margin')
  marginReport(
    @CurrentUser() user: AuthUser,
    @Query() query: ReportQuery,
  ): Promise<MarginReport> {
    return this.margin.report(user.clinicId, query.from, query.to);
  }

  /** Inventario valorizado hoy (no depende de un período) */
  @Get('inventory')
  inventoryReport(@CurrentUser() user: AuthUser): Promise<InventoryReport> {
    return this.inventory.report(user.clinicId);
  }

  /** Descuentos, anulaciones, cierres de caja, mermas y cambios de precio del período */
  @Get('control')
  controlReport(
    @CurrentUser() user: AuthUser,
    @Query() query: ReportQuery,
  ): Promise<ControlReport> {
    return this.control.report(user.clinicId, query.from, query.to);
  }
}
