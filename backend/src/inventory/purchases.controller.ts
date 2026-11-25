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
import {
  CreatePurchaseDto,
  ListPurchasesQuery,
  ListSuppliersQuery,
  MergeSuppliersDto,
  PurchasesExcelQuery,
  SupplierDto,
  UpdatePurchaseDto,
  UpdateSupplierDto,
  VoidPurchaseDto,
} from './dto/purchases.dto.js';
import {
  MAX_PURCHASE_FILE_BYTES,
  PurchasesService,
} from './purchases.service.js';
import type {
  PurchaseDetail,
  PurchaseListResult,
  UploadedPurchaseFile,
} from './purchases.service.js';
import { SuppliersService } from './suppliers.service.js';
import type { SupplierView } from './suppliers.service.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Compras y proveedores, dentro de Inventario. Las registran el administrador y el veterinario
 * (igual que los ingresos de stock); recepción y caja no las ven. Unir proveedores y el Excel
 * del contador son del administrador.
 */
@Roles('ADMIN', 'VET')
@Controller('inventory')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly suppliers: SuppliersService,
  ) {}

  // ── Proveedores ──

  @Get('suppliers')
  listSuppliers(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSuppliersQuery,
  ): Promise<SupplierView[]> {
    return this.suppliers.list(user.clinicId, user.role, query);
  }

  @Get('suppliers/:id')
  getSupplier(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SupplierView> {
    return this.suppliers.get(user.clinicId, user.role, id);
  }

  @Post('suppliers')
  createSupplier(
    @CurrentUser() user: AuthUser,
    @Body() dto: SupplierDto,
    @Req() req: Request,
  ): Promise<SupplierView> {
    return this.suppliers.create(user, dto, req.ip);
  }

  @Patch('suppliers/:id')
  updateSupplier(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupplierDto,
    @Req() req: Request,
  ): Promise<SupplierView> {
    return this.suppliers.update(user, id, dto, req.ip);
  }

  @Roles('ADMIN')
  @Post('suppliers/:id/merge')
  @HttpCode(200)
  mergeSupplier(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MergeSuppliersDto,
    @Req() req: Request,
  ): Promise<SupplierView> {
    return this.suppliers.merge(user, id, dto.intoId, req.ip);
  }

  // ── Compras ──

  @Get('purchases')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPurchasesQuery,
  ): Promise<PurchaseListResult> {
    return this.purchases.list(user.clinicId, user.role, query);
  }

  @Roles('ADMIN')
  @Get('purchases/excel')
  async excel(
    @CurrentUser() user: AuthUser,
    @Query() query: PurchasesExcelQuery,
  ): Promise<StreamableFile> {
    const file = await this.purchases.excel(
      user.clinicId,
      query.from,
      query.to,
    );
    return new StreamableFile(file, {
      type: XLSX,
      disposition: `attachment; filename="compras-${query.from}-a-${query.to}.xlsx"`,
      length: file.length,
    });
  }

  @Get('purchases/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PurchaseDetail> {
    return this.purchases.get(user.clinicId, id);
  }

  @Post('purchases')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePurchaseDto,
    @Req() req: Request,
  ): Promise<PurchaseDetail> {
    return this.purchases.create(user, dto, req.ip);
  }

  @Patch('purchases/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurchaseDto,
    @Req() req: Request,
  ): Promise<PurchaseDetail> {
    return this.purchases.update(user, id, dto, req.ip);
  }

  @Post('purchases/:id/void')
  @HttpCode(200)
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidPurchaseDto,
    @Req() req: Request,
  ): Promise<PurchaseDetail> {
    return this.purchases.void(user, id, dto.reason, req.ip);
  }

  @Post('purchases/:id/file')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PURCHASE_FILE_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedPurchaseFile | undefined,
    @Req() req: Request,
  ): Promise<{ mime: string; size: number }> {
    return this.purchases.uploadFile(user, id, file, req.ip);
  }

  @Get('purchases/:id/file')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const { data, mime, fileName } = await this.purchases.file(
      user.clinicId,
      id,
    );
    return new StreamableFile(data, {
      type: mime,
      length: data.length,
      disposition: `inline; filename="${fileName}"`,
    });
  }

  @Delete('purchases/:id/file')
  @HttpCode(204)
  async removeFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<void> {
    await this.purchases.removeFile(user, id, req.ip);
  }

  /** Último costo sin IGV del producto, para compararlo al llenar la ficha */
  @Get('products/:id/last-cost')
  lastCost(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.purchases.lastCost(user.clinicId, id);
  }
}
