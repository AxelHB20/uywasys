import { Module } from '@nestjs/common';
import { VisitsModule } from '../visits/visits.module.js';
import { CashController } from './cash.controller.js';
import { CashService } from './cash.service.js';

/** Fase 3, paso 2: caja. Los cargos se crean solo por ChargesService (stock y precios congelados). */
@Module({
  imports: [VisitsModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
