import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
import { ClientPrivacyService } from './client-privacy.service.js';
import { ClientsService } from './clients.service.js';
import type {
  AuthorizedPersonView,
  ClientDetail,
  ClientPage,
} from './clients.service.js';
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  MARKETING_CONSENT_TEXT,
} from './consent.js';
import {
  CreateAuthorizedPersonDto,
  CreateClientDto,
  ListClientsQuery,
  LookupClientQuery,
  LookupPhoneQuery,
  UpdateClientDto,
} from './dto/client.dto.js';
import { AnonymizeClientDto } from './dto/privacy.dto.js';

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly privacy: ClientPrivacyService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListClientsQuery,
  ): Promise<ClientPage> {
    return this.clients.list(user.clinicId, query);
  }

  /** Texto de consentimiento vigente: el front lo muestra tal cual. */
  @Get('consent')
  consent(): { version: string; text: string; marketingText: string } {
    return {
      version: CONSENT_VERSION,
      text: CONSENT_TEXT,
      marketingText: MARKETING_CONSENT_TEXT,
    };
  }

  @Get('lookup-phone')
  async lookupPhone(
    @CurrentUser() user: AuthUser,
    @Query() query: LookupPhoneQuery,
  ) {
    return {
      client: await this.clients.lookupPhone(user.clinicId, query.phone),
    };
  }

  @Get('lookup')
  async lookup(
    @CurrentUser() user: AuthUser,
    @Query() query: LookupClientQuery,
  ) {
    return {
      client: await this.clients.lookup(
        user.clinicId,
        query.docType,
        query.docNumber,
      ),
    };
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClientDetail> {
    return this.clients.get(user.clinicId, id);
  }

  /** Derecho de acceso (Ley 29733): descarga en JSON todo lo que la clínica guarda del cliente. */
  @Roles('ADMIN')
  @Get(':id/export')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const data = await this.privacy.export(user, id, req.ip);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="datos-${data.cliente.codigo}.json"`,
    );
    return data;
  }

  /** Derecho de cancelación: borra sus datos personales y conserva los cobros sin ellos. */
  @Roles('ADMIN')
  @Post(':id/anonymize')
  @HttpCode(HttpStatus.OK)
  async anonymize(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnonymizeClientDto,
    @Req() req: Request,
  ): Promise<ClientDetail> {
    await this.privacy.anonymize(user, id, dto.reason, req.ip);
    return this.clients.get(user.clinicId, id);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateClientDto,
    @Req() req: Request,
  ): Promise<ClientDetail> {
    return this.clients.create(user, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClientDto,
    @Req() req: Request,
  ): Promise<ClientDetail> {
    return this.clients.update(user, id, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Post(':id/authorized')
  addAuthorized(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAuthorizedPersonDto,
    @Req() req: Request,
  ): Promise<AuthorizedPersonView> {
    return this.clients.addAuthorized(user, id, dto, req.ip);
  }

  @Roles(...FRONT_DESK_ROLES)
  @Delete(':id/authorized/:personId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAuthorized(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('personId', ParseIntPipe) personId: number,
    @Req() req: Request,
  ): Promise<void> {
    return this.clients.removeAuthorized(user, id, personId, req.ip);
  }
}
