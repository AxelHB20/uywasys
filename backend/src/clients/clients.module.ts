import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { ClientImportController } from './import/client-import.controller.js';
import { ClientImportService } from './import/client-import.service.js';

@Module({
  controllers: [ClientImportController, ClientsController],
  providers: [ClientsService, ClientImportService],
})
export class ClientsModule {}
