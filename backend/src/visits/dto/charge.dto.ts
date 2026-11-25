import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const MAX_CHARGE_ITEMS = 30;

/** Una línea: un servicio del catálogo, o un producto en una de sus presentaciones. */
export class ChargeItemDto {
  @ValidateIf((o: ChargeItemDto) => !o.productId)
  @IsInt({ message: 'Elige un servicio o un producto' })
  @Min(1)
  careServiceId?: number;

  @ValidateIf((o: ChargeItemDto) => !o.careServiceId)
  @IsInt({ message: 'Elige un servicio o un producto' })
  @Min(1)
  productId?: number;

  /** Obligatoria para productos: el precio sale de la presentación */
  @ValidateIf((o: ChargeItemDto) => Boolean(o.productId))
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

  /** Monto en soles (no porcentaje), con IGV */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El descuento admite hasta 2 decimales' },
  )
  @Min(0)
  discount?: number;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(120)
  discountReason?: string | null;

  /** Obligatorio si el producto o un insumo del servicio es controlado */
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(60)
  prescriptionRef?: string | null;
}

export class TransportPriceDto {
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio admite hasta 2 decimales' },
  )
  @Min(0.01, { message: 'Escribe el precio' })
  @Max(500, {
    message: 'La movilidad no puede pasar de S/ 500: revisa el monto',
  })
  price: number;
}

export class CreateChargesDto {
  /** Cargo dentro de una atención abierta: cliente y mascota salen de ella */
  @IsOptional()
  @IsInt()
  @Min(1)
  visitId?: number;

  /** Sin atención (venta de mostrador o algo olvidado): a qué cliente */
  @ValidateIf((o: CreateChargesDto) => !o.visitId)
  @IsInt({ message: 'Elige el cliente' })
  @Min(1)
  clientId?: number;

  /** Sin atención: mascota opcional (obligatoria para controlados) */
  @IsOptional()
  @IsInt()
  @Min(1)
  petId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Agrega al menos un servicio o producto' })
  @ArrayMaxSize(MAX_CHARGE_ITEMS, {
    message: `Máximo ${MAX_CHARGE_ITEMS} líneas por vez`,
  })
  @ValidateNested({ each: true })
  @Type(() => ChargeItemDto)
  items: ChargeItemDto[];
}

export class VoidChargeDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}

export class ResolveShortageDto {
  @Transform(trim)
  @IsString({ message: 'Indica qué se hizo' })
  @Length(3, 200, { message: 'Escribe entre 3 y 200 caracteres' })
  resolution: string;
}

export class ListShortagesQuery {
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  resolved?: boolean;
}
