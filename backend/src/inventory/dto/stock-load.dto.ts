import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { emptyToNull } from '../../common/validators/peru.js';

const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Una fila de "Cargar stock": el stock que hay hoy de un producto ya creado */
export class StockLoadItemDto {
  @IsInt({ message: 'Elige el producto' })
  productId: number;

  @IsInt({ message: 'Elige la presentación' })
  presentationId: number;

  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'La cantidad debe ser un número con hasta 3 decimales' },
  )
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

  @ValidateIf(notNull)
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'El costo debe ser un número con hasta 4 decimales' },
  )
  @Min(0)
  costPerPresentation?: number | null;

  /** Corregir "controlado" en la misma pasada (se marcó por error al crearlo) */
  @IsOptional()
  @IsBoolean()
  controlled?: boolean;
}

export class StockLoadDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Llena al menos un producto' })
  @ArrayMaxSize(200, { message: 'Hasta 200 productos por vez' })
  @ValidateNested({ each: true })
  @Type(() => StockLoadItemDto)
  items: StockLoadItemDto[];
}
