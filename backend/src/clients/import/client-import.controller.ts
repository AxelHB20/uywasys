import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { ClientImportService } from './client-import.service.js';
import type { ImportPreview, ImportResult } from './client-import.service.js';
import { buildTemplate, MAX_IMPORT_BYTES } from './excel.js';

interface UploadedSheet {
  buffer: Buffer;
  size: number;
}

const upload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
    }),
  );

function requireFile(file?: UploadedSheet): Buffer {
  if (!file?.buffer?.length)
    throw new BadRequestException('Elige el archivo de Excel');
  return file.buffer;
}

/** Importación masiva de clientes y mascotas desde Excel. Solo el administrador. */
@Roles('ADMIN')
@Controller('clients/import')
export class ClientImportController {
  constructor(private readonly importer: ClientImportService) {}

  @Get('template')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="plantilla-clientes-uywa.xlsx"',
  )
  async template(): Promise<StreamableFile> {
    return new StreamableFile(await buildTemplate());
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @upload()
  preview(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<ImportPreview> {
    return this.importer.preview(user.clinicId, requireFile(file));
  }

  @Post()
  @upload()
  import(
    @CurrentUser() user: AuthUser,
    @Body('consentDeclared') consentDeclared: string | undefined,
    @Req() req: Request,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<ImportResult> {
    return this.importer.import(
      user,
      requireFile(file),
      consentDeclared === 'true',
      req.ip,
    );
  }
}
