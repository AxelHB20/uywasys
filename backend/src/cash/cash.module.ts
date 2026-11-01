import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { VisitsModule } from '../visits/visits.module.js';
import { CashController } from './cash.controller.js';
import { CashService } from './cash.service.js';

/** Fase 3, paso 2: caja. Los cargos se crean solo por ChargesService (stock y precios congelados). */
@Module({
  imports: [VisitsModule, BillingModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
