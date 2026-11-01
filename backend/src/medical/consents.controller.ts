import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { ConsentsService } from './consents.service.js';
import type { ConsentDocument, ConsentSummary } from './consents.service.js';
import {
  ConsentTemplateQuery,
  CreateConsentDto,
  VoidConsentDto,
} from './dto/consent.dto.js';

/** Consentimientos informados: los toma el veterinario; todos los pueden ver e imprimir. */
@Controller()
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Roles('ADMIN', 'VET')
  @Get('consents/template')
  template(
    @CurrentUser() user: AuthUser,
    @Query() query: ConsentTemplateQuery,
  ): Promise<{ title: string; text: string }> {
    return this.consents.template(user.clinicId, query);
  }

  @Get('pets/:id/consents')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ConsentSummary[]> {
    return this.consents.listForPet(user.clinicId, id);
  }

  @Get('consents/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ConsentDocument> {
    return this.consents.get(user.clinicId, id);
  }

  @Roles('ADMIN', 'VET')
  @Post('consents')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConsentDto,
    @Req() req: Request,
  ): Promise<ConsentDocument> {
    return this.consents.create(user, dto, req.ip);
  }

  @Roles('ADMIN', 'VET')
  @Post('consents/:id/void')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidConsentDto,
    @Req() req: Request,
  ): Promise<ConsentDocument> {
    return this.consents.void(user, id, dto, req.ip);
  }
}
