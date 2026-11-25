import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
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
import { ClinicService, MAX_LOGO_BYTES } from './clinic.service.js';
import type {
  ClinicProfile,
  SetupStatus,
  StorageUsage,
} from './clinic.service.js';
import { OpeningHoursDto } from './dto/opening-hours.dto.js';
import type { OpeningHours } from './opening-hours.js';
import { UpdateClinicDto } from './dto/update-clinic.dto.js';

/** Lo que entrega multer para el archivo subido (se guarda en memoria, nunca en disco). */
interface UploadedLogo {
  buffer: Buffer;
  size: number;
}

@Controller('clinic')
export class ClinicController {
  constructor(private readonly clinic: ClinicService) {}

  @Roles('ADMIN')
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<ClinicProfile> {
    return this.clinic.getProfile(user.clinicId);
  }

  @Roles('ADMIN')
  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateClinicDto,
    @Req() req: Request,
  ): Promise<ClinicProfile> {
    return this.clinic.updateProfile(user, dto, req.ip);
  }

  @Roles('ADMIN')
  @Put('hours')
  updateHours(
    @CurrentUser() user: AuthUser,
    @Body() dto: OpeningHoursDto,
    @Req() req: Request,
  ): Promise<ClinicProfile> {
    return this.clinic.updateHours(user, dto.days, req.ip);
  }

  /** Espacio que ocupan las fotos y archivos de la clínica (para vigilar el disco). */
  @Roles('ADMIN')
  @Get('storage')
  storage(@CurrentUser() user: AuthUser): Promise<StorageUsage> {
    return this.clinic.storage(user.clinicId);
  }

  /** Horario de atención (la agenda lo usa para sombrear lo que está cerrado; cualquier rol). */
  @Get('hours')
  hours(@CurrentUser() user: AuthUser): Promise<OpeningHours> {
    return this.clinic.openingHours(user.clinicId);
  }

  /** Avance de "Primeros pasos" en el dashboard (lo ve cualquier rol). */
  @Get('setup')
  setup(@CurrentUser() user: AuthUser): Promise<SetupStatus> {
    return this.clinic.setupStatus(user.clinicId);
  }

  @Get('logo')
  async logo(@CurrentUser() user: AuthUser): Promise<StreamableFile> {
    const { data, mime } = await this.clinic.getLogo(user.clinicId);
    // La URL lleva la versión (?v=...), así que el navegador puede guardarlo en caché sin vencer.
    return new StreamableFile(data, {
      type: mime,
      disposition: 'inline',
      length: data.length,
    });
  }

  @Roles('ADMIN')
  @Put('logo')
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: MAX_LOGO_BYTES, files: 1 } }),
  )
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedLogo | undefined,
    @Req() req: Request,
  ): Promise<ClinicProfile> {
    return this.clinic.setLogo(user, file, req.ip);
  }

  @Roles('ADMIN')
  @Delete('logo')
  removeLogo(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ClinicProfile> {
    return this.clinic.removeLogo(user, req.ip);
  }
}
