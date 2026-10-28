import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  BaseUnit,
  IgvAffectation,
  ProductCategory,
} from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const CATEGORIES: ProductCategory[] = [
  'MEDICINE',
  'VACCINE',
  'ANTIPARASITIC',
  'FOOD',
  'ACCESSORY',
  'HYGIENE',
  'SUPPLY',
];
export const BASE_UNITS: BaseUnit[] = ['UNIT', 'TABLET', 'ML', 'G'];
export const IGV_TYPES: IgvAffectation[] = ['TAXED', 'EXEMPT', 'UNAFFECTED'];

const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const qty = (message: string) => IsNumber({ maxDecimalPlaces: 3 }, { message });
const money = (message: string) =>
  IsNumber({ maxDecimalPlaces: 2 }, { message });

export class PresentationDto {
  @Transform(trim)
  @IsString({ message: 'Ingresa el nombre de la presentación' })
  @Length(1, 60, { message: 'La presentación admite hasta 60 caracteres' })
  name: string;

  /** Cuántas unidades mínimas trae: "Caja x 100" = 100 */
  @qty('La equivalencia debe ser un número')
  @Min(0.001, { message: 'La equivalencia debe ser mayor a 0' })
  @Max(1_000_000)
  factor: number;

  @ValidateIf(notNull)
  @money('El precio debe tener hasta 2 decimales')
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(999_999)
  price?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(30)
  barcode?: string | null;
}

export class UpdatePresentationDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 60, { message: 'La presentación admite hasta 60 caracteres' })
  name?: string;

  @IsOptional()
  @qty('La equivalencia debe ser un número')
  @Min(0.001, { message: 'La equivalencia debe ser mayor a 0' })
  factor?: number;

  @ValidateIf(notNull)
  @money('El precio debe tener hasta 2 decimales')
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(30)
  barcode?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class ProductFields {
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^[\w.-]{1,30}$/, {
    message: 'El código admite letras, números, punto y guion',
  })
  code?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(30)
  barcode?: string | null;

  @ValidateIf(notNull)
  @qty('El stock mínimo debe ser un número')
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsBoolean()
  requiresPrescription?: boolean;

  @IsOptional()
  @IsBoolean()
  controlled?: boolean;

  @IsOptional()
  @Matches(/^[A-Z0-9]{2,3}$/, {
    message: 'La unidad SUNAT no es válida (ej.: NIU)',
  })
  sunatUnit?: string;

  @IsOptional()
  @IsIn(IGV_TYPES, { message: 'Elige la afectación del IGV' })
  igv?: IgvAffectation;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class CreateProductDto extends ProductFields {
  @Transform(trim)
  @IsString({ message: 'Ingresa el nombre del producto' })
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres' })
  name: string;

  @IsIn(CATEGORIES, { message: 'Elige la categoría' })
  category: ProductCategory;

  @IsIn(BASE_UNITS, { message: 'Elige la unidad mínima' })
  baseUnit: BaseUnit;

  @IsArray()
  @ArrayMinSize(1, { message: 'Agrega al menos una presentación' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PresentationDto)
  presentations: PresentationDto[];
}

export class UpdateProductDto extends ProductFields {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres' })
  name?: string;

  @IsOptional()
  @IsIn(CATEGORIES, { message: 'Elige la categoría' })
  category?: ProductCategory;

  @IsOptional()
  @IsIn(BASE_UNITS, { message: 'Elige la unidad mínima' })
  baseUnit?: BaseUnit;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PurchaseDto {
  @IsInt({ message: 'Elige la presentación comprada' })
  presentationId: number;

  /** Cantidad de presentaciones (ej.: 5 cajas) */
  @qty('La cantidad debe ser un número')
  @Min(0.001, { message: 'La cantidad debe ser mayor a 0' })
  @Max(100_000)
  quantity: number;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40, { message: 'El lote admite hasta 40 caracteres' })
  lotNumber?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(DATE, { message: 'La fecha de vencimiento no es válida' })
  expiresAt?: string | null;

  /** Costo de cada presentación comprada (S/) */
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'El costo debe ser un número' })
  @Min(0)
  costPerPresentation?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  supplier?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(30)
  documentNumber?: string | null;
}

export const OUTFLOW_TYPES = ['WASTE', 'TREATMENT'] as const;
export type OutflowType = (typeof OUTFLOW_TYPES)[number];

export class OutflowDto {
  /** WASTE = merma (vencido, roto, perdido) · TREATMENT = aplicado a un paciente o consumo interno */
  @IsIn(OUTFLOW_TYPES, { message: 'Elige si es merma o uso interno' })
  type: OutflowType;

  @qty('La cantidad debe ser un número')
  @Min(0.001, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  /** Si se indica, la cantidad está en esa presentación; si no, en unidad mínima */
  @ValidateIf(notNull)
  @IsInt()
  presentationId?: number | null;

  @ValidateIf(notNull)
  @IsInt()
  batchId?: number | null;

  @Transform(trim)
  @IsString({ message: 'Escribe el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;

  @ValidateIf(notNull)
  @IsInt()
  petId?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  prescriptionRef?: string | null;
}

export class CountItemDto {
  @IsInt()
  batchId: number;

  @qty('La cantidad contada debe ser un número')
  @Min(0, { message: 'La cantidad contada no puede ser negativa' })
  counted: number;
}

export class CountDto {
  @Transform(trim)
  @IsString({ message: 'Escribe el motivo del ajuste' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Indica al menos un lote contado' })
  @ValidateNested({ each: true })
  @Type(() => CountItemDto)
  items: CountItemDto[];
}

export class ListProductsQuery {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: ProductCategory;

  /** low = stock bajo · expiring = vence en 60 días o ya venció */
  @IsOptional()
  @IsIn(['all', 'low', 'expiring'])
  filter?: 'all' | 'low' | 'expiring';

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class ControlledQuery {
  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  to?: string;
}
