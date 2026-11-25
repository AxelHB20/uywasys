import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Matches,
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

  // ── SOAP ──

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(5000, { message: 'La anamnesis admite hasta 5000 caracteres' })
  anamnesis?: string | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt({ message: 'La frecuencia cardiaca es un número entero' })
  @Min(10, { message: 'Revisa la frecuencia cardiaca: parece demasiado baja' })
  @Max(400, { message: 'Revisa la frecuencia cardiaca: parece demasiado alta' })
  heartRate?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt({ message: 'La frecuencia respiratoria es un número entero' })
  @Min(4, {
    message: 'Revisa la frecuencia respiratoria: parece demasiado baja',
  })
  @Max(200, {
    message: 'Revisa la frecuencia respiratoria: parece demasiado alta',
  })
  respiratoryRate?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 1 }, { message: 'El TLLC admite 1 decimal' })
  @Min(0, { message: 'El TLLC no puede ser negativo' })
  @Max(10, { message: 'Revisa el TLLC: parece demasiado alto' })
  capillaryRefillS?: number | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(40, { message: 'Mucosas admite hasta 40 caracteres' })
  mucosa?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(40, { message: 'Hidratación admite hasta 40 caracteres' })
  hydration?: string | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt({ message: 'La condición corporal va de 1 a 9' })
  @Min(1, { message: 'La condición corporal va de 1 a 9' })
  @Max(9, { message: 'La condición corporal va de 1 a 9' })
  bodyCondition?: number | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(5000, { message: 'El examen físico admite hasta 5000 caracteres' })
  physicalExam?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(300, { message: 'El diagnóstico admite hasta 300 caracteres' })
  diagnosis?: string | null;

  @IsOptional()
  @IsBoolean()
  diagnosisDefinitive?: boolean;
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

  /** Consultas o grooming */
  @IsOptional()
  @IsIn(['CONSULTATION', 'GROOMING'])
  type?: VisitType;

  /** Mascota o dueño (nombre, DNI, celular) */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vetId?: number;

  /** Día de apertura (AAAA-MM-DD, hora de la clínica) */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha no es válida' })
  day?: string;

  /** Solo las abiertas desde un día anterior (plata sin cobrar) */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  stale?: boolean;
}
