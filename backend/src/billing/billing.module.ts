import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingSender } from './billing.sender.js';
import { BillingService } from './billing.service.js';

@Module({
  controllers: [BillingController],
  providers: [BillingService, BillingSender],
  exports: [BillingService, BillingSender],
})
export class BillingModule {}
