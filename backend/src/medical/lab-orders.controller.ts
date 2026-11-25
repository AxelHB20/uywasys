import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { CLINICAL_ROLES } from '../common/auth/staff-roles.js';
import { MAX_ATTACHMENT_BYTES } from './attachments.service.js';
import type { UploadedAttachment } from './attachments.service.js';
import {
  CancelLabOrderDto,
  CreateLabOrderDto,
  LabResultDto,
  ListLabOrdersQuery,
  ReviewLabOrderDto,
} from './dto/lab-order.dto.js';
import { LabOrdersService } from './lab-orders.service.js';
import type { LabOrderPage, LabOrderView } from './lab-orders.service.js';

/**
 * Exámenes de laboratorio (historia clínica): los piden y revisan veterinario y administrador;
 * recepción marca la muestra y sube el resultado cuando llega.
 */
@Roles(...CLINICAL_ROLES)
@Controller()
export class LabOrdersController {
  constructor(private readonly labs: LabOrdersService) {}

  @Get('lab-orders')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListLabOrdersQuery,
  ): Promise<LabOrderPage> {
    return this.labs.list(user.clinicId, query);
  }

  @Get('visits/:id/lab-orders')
  forVisit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LabOrderView[]> {
    return this.labs.forVisit(user.clinicId, id);
  }

  @Roles('ADMIN', 'VET')
  @Post('visits/:id/lab-orders')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateLabOrderDto,
    @Req() req: Request,
  ): Promise<LabOrderView> {
    return this.labs.create(user, id, dto, req.ip);
  }

  @Post('lab-orders/:id/sample')
  @HttpCode(HttpStatus.OK)
  sample(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LabOrderView> {
    return this.labs.sample(user, id);
  }

  @Post('lab-orders/:id/result')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    }),
  )
  result(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LabResultDto,
    @UploadedFile() file: UploadedAttachment | undefined,
    @Req() req: Request,
  ): Promise<LabOrderView> {
    return this.labs.result(user, id, dto.resultText, file, req.ip);
  }

  @Roles('ADMIN', 'VET')
  @Post('lab-orders/:id/review')
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewLabOrderDto,
    @Req() req: Request,
  ): Promise<LabOrderView> {
    return this.labs.review(user, id, dto.interpretation, req.ip);
  }

  @Post('lab-orders/:id/notified')
  @HttpCode(HttpStatus.OK)
  notified(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LabOrderView> {
    return this.labs.notified(user, id);
  }

  @Roles('ADMIN', 'VET')
  @Post('lab-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelLabOrderDto,
    @Req() req: Request,
  ): Promise<LabOrderView> {
    return this.labs.cancel(user, id, dto.reason, req.ip);
  }
}
