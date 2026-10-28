import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import { CreatePetDto, UpdatePetDto } from './dto/pet.dto.js';
import type { PetView } from './pet.mapper.js';
import { PetsService } from './pets.service.js';
import type { PetDetail } from './pets.service.js';

@Controller()
export class PetsController {
  constructor(private readonly pets: PetsService) {}

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
