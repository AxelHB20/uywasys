import { Module } from '@nestjs/common';
import { ControlReportService } from './control-report.service.js';
import { ReportsController } from './reports.controller.js';
import { InventoryReportService } from './inventory-report.service.js';
import { MarginReportService } from './margin-report.service.js';
import { SalesReportService } from './sales-report.service.js';

/** Fase 7: reportes de ventas, margen, inventario y control. */
@Module({
  controllers: [ReportsController],
  providers: [
    SalesReportService,
    MarginReportService,
    InventoryReportService,
    ControlReportService,
  ],
})
export class ReportsModule {}
