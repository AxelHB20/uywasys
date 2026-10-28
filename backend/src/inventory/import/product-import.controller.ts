import {
  BadRequestException,
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
import { MAX_IMPORT_BYTES } from '../../common/excel/sheet.js';
import { ProductImportService } from './product-import.service.js';
import type {
  ProductImportPreview,
  ProductImportResult,
} from './product-import.service.js';

interface UploadedSheet {
  buffer: Buffer;
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

/** Carga inicial de productos. Solo el administrador. */
@Roles('ADMIN')
@Controller('inventory/import')
export class ProductImportController {
  constructor(private readonly importer: ProductImportService) {}

  @Get('template')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="plantilla-productos-uywa.xlsx"',
  )
  async template(): Promise<StreamableFile> {
    return new StreamableFile(await this.importer.template());
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @upload()
  preview(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<ProductImportPreview> {
    return this.importer.preview(user.clinicId, requireFile(file));
  }

  @Post()
  @upload()
  import(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<ProductImportResult> {
    return this.importer.import(user, requireFile(file), req.ip);
  }
}
