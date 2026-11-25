import { Module } from '@nestjs/common';
import {
  PortalController,
  PortalLinksController,
} from './portal.controller.js';
import { PortalService } from './portal.service.js';

/** Portal del dueño: carnet digital, próximas citas y recetas por enlace. */
@Module({
  controllers: [PortalLinksController, PortalController],
  providers: [PortalService],
  exports: [PortalService],
})
export class PortalModule {}
