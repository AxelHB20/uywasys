import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ChargesService } from './charges.service.js';
import { ChargesController, VisitsController } from './visits.controller.js';
import { VisitsService } from './visits.service.js';

/** Fase 3: atenciones, cargos y cuenta del cliente. El stock se toca solo por StockService. */
@Module({
  imports: [InventoryModule],
  controllers: [VisitsController, ChargesController],
  providers: [VisitsService, ChargesService],
  exports: [ChargesService, VisitsService],
})
export class VisitsModule {}
