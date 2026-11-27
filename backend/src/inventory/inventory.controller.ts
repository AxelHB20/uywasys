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
  ControlledQuery,
  CountDto,
  CreateProductDto,
  ListProductsQuery,
  OutflowDto,
  PageQuery,
  PresentationDto,
  PurchaseDto,
  UpdatePresentationDto,
  UpdateProductDto,
} from './dto/inventory.dto.js';
import { InventoryService, withoutCosts } from './inventory.service.js';
import { StockLoadService } from './stock-load.service.js';
import { StockLoadDto } from './dto/stock-load.dto.js';
import type { PresentationView, ProductDetail } from './inventory.service.js';

/**
 * Permisos acordados: compras, mermas y catálogo los manejan el administrador y el veterinario;
 * el ajuste por conteo solo el administrador. Recepción, caja y groomer solo consultan.
 */
const STOCK_ROLES = ['ADMIN', 'VET'] as const;

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly stockLoad: StockLoadService,
  ) {}

  /** "Cargar stock": productos activos sin stock, para llenarlos todos en una tabla */
  @Roles(...STOCK_ROLES)
  @Get('stock-load')
  pendingStock(@CurrentUser() user: AuthUser) {
    return this.stockLoad.pending(user.clinicId);
  }

  @Roles(...STOCK_ROLES)
  @Post('stock-load')
  loadStock(
    @CurrentUser() user: AuthUser,
    @Body() dto: StockLoadDto,
    @Req() req: Request,
  ) {
    return this.stockLoad.load(user, dto, req.ip);
  }

  @Get('products')
  list(@CurrentUser() user: AuthUser, @Query() query: ListProductsQuery) {
    return this.inventory.list(user.clinicId, query);
  }

  @Get('alerts')
  alerts(@CurrentUser() user: AuthUser) {
    return this.inventory.alerts(user.clinicId);
  }

  @Roles(...STOCK_ROLES)
  @Get('controlled')
  controlled(@CurrentUser() user: AuthUser, @Query() query: ControlledQuery) {
    return this.inventory.controlled(user.clinicId, query);
  }

  @Get('products/:id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductDetail> {
    const detail = await this.inventory.get(user.clinicId, id);
    return STOCK_ROLES.includes(user.role as (typeof STOCK_ROLES)[number])
      ? detail
      : withoutCosts(detail);
  }

  @Get('products/:id/movements')
  movements(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PageQuery,
  ) {
    return this.inventory.movements(user.clinicId, id, query.page);
  }

  @Roles(...STOCK_ROLES)
  @Post('products')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
    @Req() req: Request,
  ): Promise<ProductDetail> {
    return this.inventory.create(user, dto, req.ip);
  }

  @Roles(...STOCK_ROLES)
  @Patch('products/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @Req() req: Request,
  ): Promise<ProductDetail> {
    return this.inventory.update(user, id, dto, req.ip);
  }

  @Roles(...STOCK_ROLES)
  @Post('products/:id/presentations')
  addPresentation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PresentationDto,
    @Req() req: Request,
  ): Promise<PresentationView> {
    return this.inventory.addPresentation(user, id, dto, req.ip);
  }

  @Roles(...STOCK_ROLES)
  @Patch('presentations/:id')
  updatePresentation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePresentationDto,
    @Req() req: Request,
  ): Promise<PresentationView> {
    return this.inventory.updatePresentation(user, id, dto, req.ip);
  }

  @Roles(...STOCK_ROLES)
  @Post('products/:id/purchases')
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PurchaseDto,
    @Req() req: Request,
  ): Promise<ProductDetail> {
    return this.inventory.purchase(user, id, dto, req.ip);
  }

  @Roles(...STOCK_ROLES)
  @Post('products/:id/outflows')
  outflow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OutflowDto,
    @Req() req: Request,
  ): Promise<ProductDetail> {
    return this.inventory.outflow(user, id, dto, req.ip);
  }

  @Roles('ADMIN')
  @Post('products/:id/counts')
  count(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CountDto,
    @Req() req: Request,
  ): Promise<ProductDetail> {
    return this.inventory.count(user, id, dto, req.ip);
  }
}
