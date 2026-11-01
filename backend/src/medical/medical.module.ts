import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module.js';
import { VisitsModule } from '../visits/visits.module.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';
import { ConsentsController } from './consents.controller.js';
import { ConsentsService } from './consents.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { EstimatesController } from './estimates.controller.js';
import { EstimatesService } from './estimates.service.js';
import { ImmunizationsController } from './immunizations.controller.js';
import { ImmunizationsService } from './immunizations.service.js';
import { PrescriptionsController } from './prescriptions.controller.js';
import { PrescriptionsService } from './prescriptions.service.js';

/** Fase 5: módulo médico (vacunas, recetas, citas, presupuestos, adjuntos y consentimientos). */
@Module({
  imports: [VisitsModule, QueueModule],
  controllers: [
    ImmunizationsController,
    PrescriptionsController,
    AppointmentsController,
    EstimatesController,
    AttachmentsController,
    ConsentsController,
  ],
  providers: [
    ImmunizationsService,
    PrescriptionsService,
    AppointmentsService,
    EstimatesService,
    AttachmentsService,
    ConsentsService,
  ],
})
export class MedicalModule {}
