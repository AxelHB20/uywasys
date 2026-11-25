import { Module } from '@nestjs/common';
import { VisitsModule } from '../visits/visits.module.js';
import { HospitalizationController } from './hospitalization.controller.js';
import { HospitalizationService } from './hospitalization.service.js';

/** Hospitalización sobre la atención y la cuenta de la Fase 3. */
@Module({
  imports: [VisitsModule],
  controllers: [HospitalizationController],
  providers: [HospitalizationService],
  exports: [HospitalizationService],
})
export class HospitalizationModule {}
