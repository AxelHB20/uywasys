import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  CareServiceCategory,
  IgvAffectation,
} from '../generated/prisma/enums.js';
import { trim } from '../common/validators/peru.js';
import { IGV_TYPES } from '../inventory/dto/inventory.dto.js';

export const SERVICE_CATEGORIES: CareServiceCategory[] = [
  'CONSULTATION',
  'VACCINATION',
  'DEWORMING',
  'SURGERY',
  'LAB',
  'GROOMING',
  'OTHER',
];

export class SupplyDto {
  @IsInt({ message: 'Elige el producto' })
  productId: number;

  /** En unidad mínima del producto (ej.: 1 ml) */
  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'La cantidad debe ser un número' },
  )
  @Min(0.001, { message: 'La cantidad del insumo debe ser mayor a 0' })
  quantity: number;
}

class Fields {
  @IsOptional()
  @IsIn(IGV_TYPES, { message: 'Elige la afectación del IGV' })
  igv?: IgvAffectation;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMin?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SupplyDto)
  supplies?: SupplyDto[];
}

export class CreateCareServiceDto extends Fields {
  @Transform(trim)
  @IsString({ message: 'Ingresa el nombre del servicio' })
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres' })
  name: string;

  @IsIn(SERVICE_CATEGORIES, { message: 'Elige la categoría' })
  category: CareServiceCategory;

  /** Con IGV incluido */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe tener hasta 2 decimales' },
  )
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(999_999)
  price: number;
}

export class UpdateCareServiceDto extends Fields {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres' })
  name?: string;

  @IsOptional()
  @IsIn(SERVICE_CATEGORIES, { message: 'Elige la categoría' })
  category?: CareServiceCategory;

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe tener hasta 2 decimales' },
  )
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListCareServicesQuery {
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}
