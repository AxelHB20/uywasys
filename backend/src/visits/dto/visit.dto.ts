import { Transform, Type } from 'class-transformer';
import {
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
import type { VisitStatus, VisitType } from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const VISIT_TYPES: VisitType[] = ['CONSULTATION', 'GROOMING'];
export const VISIT_STATUSES: VisitStatus[] = ['OPEN', 'CLOSED', 'CANCELLED'];

export class OpenVisitDto {
  @IsInt({ message: 'Elige la mascota' })
  @Min(1)
  petId: number;

  /** Si viene de la cola, la entrada pasa a "En atención" */
  @IsOptional()
  @IsInt()
  @Min(1)
  queueEntryId?: number;

  @IsOptional()
  @IsIn(VISIT_TYPES, { message: 'Tipo de atención no válido' })
  type?: VisitType;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres' })
  reason?: string | null;
}

export class UpdateVisitDto {
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres' })
  reason?: string | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El peso debe tener hasta 2 decimales' },
  )
  @Min(0.01, { message: 'El peso debe ser mayor a 0' })
  @Max(999, { message: 'Revisa el peso: parece demasiado alto' })
  weightKg?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 1 },
    { message: 'La temperatura admite 1 decimal' },
  )
  @Min(30, { message: 'Revisa la temperatura: parece demasiado baja' })
  @Max(45, { message: 'Revisa la temperatura: parece demasiado alta' })
  temperatureC?: number | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(5000, { message: 'Las notas admiten hasta 5000 caracteres' })
  notes?: string | null;
}

export class CancelVisitDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}

export class AddendumDto {
  @Transform(trim)
  @IsString({ message: 'Escribe la adenda' })
  @Length(3, 2000, {
    message: 'La adenda debe tener entre 3 y 2000 caracteres',
  })
  text: string;
}

export class ListVisitsQuery {
  @IsOptional()
  @IsIn(VISIT_STATUSES)
  status?: VisitStatus;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
