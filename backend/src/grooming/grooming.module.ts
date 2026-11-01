import { Module } from '@nestjs/common';
import { VisitsModule } from '../visits/visits.module.js';
import { GroomingController } from './grooming.controller.js';
import { GroomingCommissionsService } from './grooming-commissions.service.js';
import { GroomingService } from './grooming.service.js';

/** Fase 6: baño y peluquería sobre la atención y la cuenta de la Fase 3. */
@Module({
  imports: [VisitsModule],
  controllers: [GroomingController],
  providers: [GroomingService, GroomingCommissionsService],
})
export class GroomingModule {}
