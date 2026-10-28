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
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { FRONT_DESK_ROLES } from '../common/auth/staff-roles.js';
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
  UpdateClientDto,
} from './dto/client.dto.js';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

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
