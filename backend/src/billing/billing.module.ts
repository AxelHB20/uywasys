import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingSender } from './billing.sender.js';
import { BillingService } from './billing.service.js';
import { BillingHealthStore } from './billing-health.js';
import { BillingHealthChecker } from './billing-health.checker.js';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingSender,
    BillingHealthStore,
    BillingHealthChecker,
  ],
  exports: [BillingService, BillingSender, BillingHealthChecker],
})
export class BillingModule {}
