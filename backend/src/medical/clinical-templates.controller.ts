import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { ClinicalTemplatesService } from './clinical-templates.service.js';
import type { TemplateView } from './clinical-templates.service.js';
import {
  ListTemplatesQuery,
  TemplateDto,
  UpdateTemplateDto,
} from './dto/template.dto.js';

/** Plantillas de consulta y recetas frecuentes: las ve todo el equipo; las arman veterinarios y el administrador. */
@Controller('clinical-templates')
export class ClinicalTemplatesController {
  constructor(private readonly templates: ClinicalTemplatesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListTemplatesQuery,
  ): Promise<TemplateView[]> {
    return this.templates.list(user.clinicId, query.kind);
  }

  @Roles('ADMIN', 'VET')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: TemplateDto,
  ): Promise<TemplateView> {
    return this.templates.create(user, dto);
  }

  @Roles('ADMIN', 'VET')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTemplateDto,
  ): Promise<TemplateView> {
    return this.templates.update(user, id, dto);
  }

  @Roles('ADMIN', 'VET')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.templates.remove(user, id);
  }

  @Roles('ADMIN', 'VET')
  @Post(':id/used')
  @HttpCode(204)
  used(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.templates.used(user, id);
  }
}
