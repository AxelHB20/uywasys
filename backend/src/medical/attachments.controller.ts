import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
} from './attachments.service.js';
import type {
  AttachmentView,
  UploadedAttachment,
} from './attachments.service.js';
import {
  ListAttachmentsQuery,
  UploadAttachmentDto,
  VoidAttachmentDto,
} from './dto/attachment.dto.js';

/** Fotos, análisis y radiografías de la historia clínica. */
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('pets/:id/attachments')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListAttachmentsQuery,
  ): Promise<AttachmentView[]> {
    return this.attachments.list(user.clinicId, id, query);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post('pets/:id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadAttachmentDto,
    @UploadedFile() file: UploadedAttachment | undefined,
    @Req() req: Request,
  ): Promise<AttachmentView> {
    return this.attachments.upload(user, id, dto, file, req.ip);
  }

  @Get('attachments/:id/file')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const { data, mime, fileName } = await this.attachments.file(
      user.clinicId,
      id,
    );
    return new StreamableFile(data, {
      type: mime,
      length: data.length,
      disposition: `inline; filename="${fileName}"`,
    });
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post('attachments/:id/void')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidAttachmentDto,
    @Req() req: Request,
  ): Promise<AttachmentView> {
    return this.attachments.void(user, id, dto, req.ip);
  }
}
