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
  CreateCareServiceDto,
  ListCareServicesQuery,
  UpdateCareServiceDto,
} from './care-service.dto.js';
import { CareServicesService } from './care-services.service.js';
import type { CareServiceView } from './care-services.service.js';

/** Todos consultan el catálogo; los precios los define el administrador. */
@Controller('care-services')
export class CareServicesController {
  constructor(private readonly services: CareServicesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCareServicesQuery,
  ): Promise<CareServiceView[]> {
    return this.services.list(user.clinicId, query.status);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCareServiceDto,
    @Req() req: Request,
  ): Promise<CareServiceView> {
    return this.services.create(user, dto, req.ip);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCareServiceDto,
    @Req() req: Request,
  ): Promise<CareServiceView> {
    return this.services.update(user, id, dto, req.ip);
  }
}
