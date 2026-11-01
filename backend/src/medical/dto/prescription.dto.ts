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

export const MAX_PRESCRIPTION_ITEMS = 12;

export class PrescriptionItemDto {
  /** Producto del inventario (opcional: también se receta lo que la clínica no vende) */
  @IsOptional()
  @IsInt()
  @Min(1)
  productId?: number;

  /** Obligatoria si se entrega en la clínica */
  @ValidateIf((o: PrescriptionItemDto) => o.dispenseQuantity != null)
  @IsInt({ message: 'Elige la presentación que se entrega' })
  @Min(1)
  presentationId?: number;

  @Transform(trim)
  @IsString({ message: 'Escribe el medicamento' })
  @Length(2, 150, {
    message: 'El medicamento debe tener entre 2 y 150 caracteres',
  })
  drug: string;

  @Transform(trim)
  @IsString({ message: 'Indica la dosis' })
  @Length(1, 80, { message: 'La dosis admite hasta 80 caracteres' })
  dose: string;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(40, { message: 'La vía admite hasta 40 caracteres' })
  route?: string | null;

  @Transform(trim)
  @IsString({ message: 'Indica cada cuánto' })
  @Length(1, 60, { message: 'La frecuencia admite hasta 60 caracteres' })
  frequency: string;

  @Transform(trim)
  @IsString({ message: 'Indica por cuánto tiempo' })
  @Length(1, 60, { message: 'La duración admite hasta 60 caracteres' })
  duration: string;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(300, { message: 'Las indicaciones admiten hasta 300 caracteres' })
  instructions?: string | null;

  /** Cuántas presentaciones se entregan en la clínica: se cargan a la cuenta y bajan del stock */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'La cantidad admite hasta 3 decimales' },
  )
  @Min(0.001, { message: 'La cantidad a entregar debe ser mayor a 0' })
  @Max(999)
  dispenseQuantity?: number | null;
}

export class CreatePrescriptionDto {
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(1000, {
    message: 'Las indicaciones admiten hasta 1000 caracteres',
  })
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Agrega al menos un medicamento' })
  @ArrayMaxSize(MAX_PRESCRIPTION_ITEMS, {
    message: `Máximo ${MAX_PRESCRIPTION_ITEMS} medicamentos por receta`,
  })
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];
}

export class VoidPrescriptionDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}
