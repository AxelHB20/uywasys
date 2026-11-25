import { Module } from '@nestjs/common';
import { MedicalModule } from '../medical/medical.module.js';
import { PortalModule } from '../portal/portal.module.js';
import {
  PortalNoticesController,
  RemindersController,
} from './reminders.controller.js';
import { RemindersSender } from './reminders.sender.js';
import { RemindersService } from './reminders.service.js';

/** Recordatorios gratis: WhatsApp marcado desde recepción y avisos al celular desde el portal. */
@Module({
  imports: [MedicalModule, PortalModule],
  controllers: [RemindersController, PortalNoticesController],
  providers: [RemindersService, RemindersSender],
  exports: [RemindersService, RemindersSender],
})
export class RemindersModule {}
