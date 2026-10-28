import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockService],
  // Caja (Fase 4) y el módulo médico (Fase 5) descuentan stock solo por StockService
  exports: [StockService, InventoryService],
})
export class InventoryModule {}
