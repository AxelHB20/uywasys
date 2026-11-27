import { Module } from '@nestjs/common';
import { ProductImportController } from './import/product-import.controller.js';
import { ProductImportService } from './import/product-import.service.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';
import { SuppliersService } from './suppliers.service.js';
import { StockService } from './stock.service.js';
import { StockLoadService } from './stock-load.service.js';

@Module({
  controllers: [
    ProductImportController,
    InventoryController,
    PurchasesController,
  ],
  providers: [
    InventoryService,
    StockService,
    ProductImportService,
    PurchasesService,
    SuppliersService,
    StockLoadService,
  ],
  // Caja (Fase 4) y el módulo médico (Fase 5) descuentan stock solo por StockService
  exports: [StockService, InventoryService],
})
export class InventoryModule {}
