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
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const LAB_FILTERS = [
  'pending',
  'ready',
  'reviewed',
  'cancelled',
  'all',
] as const;
export type LabFilter = (typeof LAB_FILTERS)[number];

/** Pedir uno o varios exámenes del catálogo desde una atención abierta */
export class CreateLabOrderDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un examen' })
  @ArrayMaxSize(15, { message: 'Máximo 15 exámenes por pedido' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  careServiceIds!: number[];

  @IsIn(['IN_HOUSE', 'EXTERNAL'], { message: 'Elige dónde se procesa' })
  destination!: 'IN_HOUSE' | 'EXTERNAL';

  @Transform(emptyToNull)
  @ValidateIf((o: CreateLabOrderDto) => o.destination === 'EXTERNAL')
  @IsString({ message: 'Escribe el laboratorio' })
  @Length(2, 120, {
    message: 'El laboratorio debe tener entre 2 y 120 caracteres',
  })
  externalLab?: string | null;

  /** Lo que cobra el laboratorio a la clínica (opcional) */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El costo admite hasta 2 decimales' },
  )
  @Min(0)
  labCost?: number | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  indication?: string | null;

  /** false = no se carga a la cuenta (por ejemplo, incluido en una cirugía) */
  @IsBoolean()
  charge!: boolean;
}

/** Campos del formulario multipart del resultado (el archivo es opcional si hay valores) */
export class LabResultDto {
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resultText?: string | null;
}

export class ReviewLabOrderDto {
  @Transform(trim)
  @IsString({ message: 'Escribe la interpretación' })
  @Length(3, 2000, {
    message: 'La interpretación debe tener entre 3 y 2000 caracteres',
  })
  interpretation!: string;
}

export class CancelLabOrderDto {
  @Transform(trim)
  @IsString({ message: 'Escribe el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason!: string;
}

export const LAB_PLACES = ['IN_HOUSE', 'EXTERNAL'] as const;

export class ListLabOrdersQuery {
  @IsOptional()
  @IsIn(LAB_FILTERS)
  status?: LabFilter;

  /** Mascota, dueño (nombre, DNI o celular) o código EX-00012 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  /** En la clínica o en un laboratorio externo */
  @IsOptional()
  @IsIn(LAB_PLACES)
  destination?: (typeof LAB_PLACES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  petId?: number;
}
