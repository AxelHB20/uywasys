import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  PurchaseDocType,
  PurchaseStatus,
} from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';
import { IsRuc } from '../../common/validators/ruc.js';

const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Fijo o celular, con o sin +51: se guardan solo los dígitos */
const toDigits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s()-]/g, '') || null : value;

export const DOC_TYPES: PurchaseDocType[] = [
  'FACTURA',
  'BOLETA',
  'GUIA',
  'OTRO',
];
export const PURCHASE_STATUSES: PurchaseStatus[] = ['RECEIVED', 'VOIDED'];
/** Líneas de una ficha: de sobra para una compra real */
export const MAX_PURCHASE_LINES = 200;

export class SupplierDto {
  @Transform(trim)
  @IsString({ message: 'Ingresa la razón social o el nombre del proveedor' })
  @Length(2, 150, { message: 'El nombre debe tener entre 2 y 150 caracteres' })
  name: string;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsRuc({ message: 'El RUC no es válido (11 dígitos)' })
  ruc?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(100, { message: 'El contacto admite hasta 100 caracteres' })
  contact?: string | null;

  @Transform(toDigits)
  @ValidateIf(notNull)
  @Matches(/^\+?\d{6,15}$/, { message: 'El teléfono no es válido' })
  phone?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(120)
  email?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300, { message: 'Las notas admiten hasta 300 caracteres' })
  notes?: string | null;
}

export class UpdateSupplierDto extends SupplierDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MergeSuppliersDto {
  /** El que se queda; el otro pasa sus compras y lotes a este y se borra */
  @IsInt({ message: 'Elige con qué proveedor unirlo' })
  intoId: number;
}

export class ListSuppliersQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  /** Incluir los inactivos (para la pestaña Proveedores) */
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  all?: boolean;
}

export class PurchaseLineDto {
  @IsInt({ message: 'Elige el producto' })
  productId: number;

  @IsInt({ message: 'Elige la presentación' })
  presentationId: number;

  /** Presentaciones que dice la ficha (5 cajas) */
  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'La cantidad debe ser un número' },
  )
  @Min(0.001, { message: 'La cantidad debe ser mayor a 0' })
  @Max(100_000)
  quantity: number;

  /** Precio de cada presentación tal como viene en la ficha (0 = bonificación) */
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'El precio debe ser un número' },
  )
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(999_999)
  unitPrice: number;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40, { message: 'El lote admite hasta 40 caracteres' })
  lotNumber?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(DATE, { message: 'La fecha de vencimiento no es válida' })
  expiresAt?: string | null;
}

export class PurchaseHeaderDto {
  @IsInt({ message: 'Elige el proveedor' })
  supplierId: number;

  @IsIn(DOC_TYPES, { message: 'Elige el tipo de comprobante' })
  docType: PurchaseDocType;

  @Transform(trim)
  @IsString({ message: 'Ingresa la serie y el número del comprobante' })
  @Length(1, 30, { message: 'El número admite hasta 30 caracteres' })
  docNumber: string;

  @Matches(DATE, { message: 'La fecha del comprobante no es válida' })
  issuedAt: string;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300, { message: 'Las notas admiten hasta 300 caracteres' })
  notes?: string | null;
}

export class CreatePurchaseDto extends PurchaseHeaderDto {
  /** Cómo vienen los precios en la ficha; el costo del lote se guarda siempre sin IGV */
  @IsBoolean()
  pricesIncludeIgv: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'Agrega al menos un producto' })
  @ArrayMaxSize(MAX_PURCHASE_LINES, {
    message: `Una compra admite hasta ${MAX_PURCHASE_LINES} líneas`,
  })
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines: PurchaseLineDto[];

  /** Descontar de esta compra los insumos que se usaron sin stock */
  @IsOptional()
  @IsBoolean()
  settleShortages?: boolean;
}

/** Corregir el comprobante (llegó la factura después de la guía): no toca el stock */
export class UpdatePurchaseDto extends PurchaseHeaderDto {}

export class VoidPurchaseDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}

export class ListPurchasesQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  supplierId?: number;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  to?: string;

  @IsOptional()
  @IsIn(PURCHASE_STATUSES)
  status?: PurchaseStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class PurchasesExcelQuery {
  @Matches(DATE, { message: 'La fecha no es válida' })
  from: string;

  @Matches(DATE, { message: 'La fecha no es válida' })
  to: string;
}
