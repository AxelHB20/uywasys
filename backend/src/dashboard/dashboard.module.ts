import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module.js';
import { HospitalizationModule } from '../hospitalization/hospitalization.module.js';
import { MedicalModule } from '../medical/medical.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [CashModule, MedicalModule, HospitalizationModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
