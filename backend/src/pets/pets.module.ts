import { Module } from '@nestjs/common';
import { PetsController } from './pets.controller.js';
import { PatientsService } from './patients.service.js';
import { PetsService } from './pets.service.js';

@Module({
  controllers: [PetsController],
  providers: [PetsService, PatientsService],
})
export class PetsModule {}
