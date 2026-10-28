import { Module } from '@nestjs/common';
import { CareServicesController } from './care-services.controller.js';
import { CareServicesService } from './care-services.service.js';

@Module({
  controllers: [CareServicesController],
  providers: [CareServicesService],
  exports: [CareServicesService],
})
export class CareServicesModule {}
