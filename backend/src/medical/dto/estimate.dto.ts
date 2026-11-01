import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { EstimateStatus } from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const MAX_ESTIMATE_ITEMS = 30;
export const ESTIMATE_STATUSES: EstimateStatus[] = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CONVERTED',
];

/** Una línea del catálogo: servicio, o producto en una presentación */
export class EstimateItemDto {
  @ValidateIf((o: EstimateItemDto) => !o.productId)
  @IsInt({ message: 'Elige un servicio o un producto' })
  @Min(1)
  careServiceId?: number;

  @ValidateIf((o: EstimateItemDto) => !o.careServiceId)
  @IsInt({ message: 'Elige un servicio o un producto' })
  @Min(1)
  productId?: number;

  @ValidateIf((o: EstimateItemDto) => Boolean(o.productId))
  @IsInt({ message: 'Elige la presentación del producto' })
  @Min(1)
  presentationId?: number;

  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'La cantidad admite hasta 3 decimales' },
  )
  @Min(0.001, { message: 'La cantidad debe ser mayor a 0' })
  @Max(9999)
  quantity: number;

  /** En soles, con IGV */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El descuento admite hasta 2 decimales' },
  )
  @Min(0)
  discount?: number;
}

export class CreateEstimateDto {
  @IsInt({ message: 'Elige la mascota' })
  @Min(1)
  petId: number;

  @Transform(trim)
  @IsString({ message: 'Escribe el título' })
  @Length(3, 150, { message: 'El título debe tener entre 3 y 150 caracteres' })
  title: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'La vigencia es de 1 a 90 días' })
  @Max(90, { message: 'La vigencia es de 1 a 90 días' })
  validDays: number;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(1000, { message: 'Las notas admiten hasta 1000 caracteres' })
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Agrega al menos un servicio o producto' })
  @ArrayMaxSize(MAX_ESTIMATE_ITEMS, {
    message: `Máximo ${MAX_ESTIMATE_ITEMS} líneas`,
  })
  @ValidateNested({ each: true })
  @Type(() => EstimateItemDto)
  items: EstimateItemDto[];
}

export class DecideEstimateDto {
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'La nota admite hasta 200 caracteres' })
  note?: string | null;
}

export class ConvertEstimateDto {
  /** Atención abierta de la mascota donde se cargan las líneas */
  @IsInt({ message: 'Elige la atención' })
  @Min(1)
  visitId: number;

  /** Para los servicios o productos con controlados */
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(60)
  prescriptionRef?: string | null;
}

export class ListEstimatesQuery {
  @IsOptional()
  @IsIn([...ESTIMATE_STATUSES, 'OPEN'])
  status?: EstimateStatus | 'OPEN';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  petId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  clientId?: number;
}
