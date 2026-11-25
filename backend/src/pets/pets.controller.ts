import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import {
  CLINICAL_ROLES,
  FRONT_DESK_ROLES,
} from '../common/auth/staff-roles.js';
import { ListPatientsQuery } from './dto/patients.dto.js';
import { PatientsService } from './patients.service.js';
import type { PatientPage } from './patients.service.js';
import { CreatePetDto, UpdatePetDto } from './dto/pet.dto.js';
import type { PetView } from './pet.mapper.js';
import { PetsService } from './pets.service.js';
import type { PetDetail } from './pets.service.js';

@Controller()
export class PetsController {
  constructor(
    private readonly pets: PetsService,
    private readonly patients: PatientsService,
  ) {}

  /** Historias clínicas: solo quien ve la historia clínica (caja y groomer no) */
  @Roles(...CLINICAL_ROLES)
  @Get('pets')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPatientsQuery,
  ): Promise<PatientPage> {
    return this.patients.list(user.clinicId, query);
  }

  @Get('pets/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PetDetail> {
    return this.pets.get(user.clinicId, id);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post('clients/:clientId/pets')
  create(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: CreatePetDto,
    @Req() req: Request,
  ): Promise<PetView> {
    return this.pets.create(user, clientId, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Patch('pets/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePetDto,
    @Req() req: Request,
  ): Promise<PetView> {
    return this.pets.update(user, id, dto, req.ip);
  }
}
