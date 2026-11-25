import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { CLINICAL_ROLES } from '../common/auth/staff-roles.js';
import {
  CreatePrescriptionDto,
  VoidPrescriptionDto,
} from './dto/prescription.dto.js';
import { PrescriptionsService } from './prescriptions.service.js';
import type { PrescriptionPrint } from './prescriptions.service.js';

/** Recetas: las emite el veterinario (o el administrador que también lo es); todos las ven. */
@Controller()
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Roles('ADMIN', 'VET')
  @Post('visits/:id/prescriptions')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePrescriptionDto,
    @Req() req: Request,
  ): Promise<PrescriptionPrint> {
    return this.prescriptions.create(user, id, dto, req.ip);
  }

  @Roles(...CLINICAL_ROLES)
  @Get('prescriptions/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PrescriptionPrint> {
    return this.prescriptions.get(user.clinicId, id);
  }

  @Roles('ADMIN', 'VET')
  @Post('prescriptions/:id/void')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidPrescriptionDto,
    @Req() req: Request,
  ): Promise<PrescriptionPrint> {
    return this.prescriptions.void(user, id, dto, req.ip);
  }
}
