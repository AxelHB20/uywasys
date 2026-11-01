import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { VisitType } from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const APPOINTMENT_DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAppointmentDto {
  @IsInt({ message: 'Elige la mascota' })
  @Min(1)
  petId: number;

  /** null = cualquier veterinario disponible */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  vetId?: number | null;

  @IsISO8601({ strict: true }, { message: 'La fecha y hora no son válidas' })
  startsAt: string;

  @Type(() => Number)
  @IsIn(APPOINTMENT_DURATIONS, { message: 'Duración no válida' })
  durationMin: number;

  @IsOptional()
  @IsIn(['CONSULTATION', 'GROOMING'], { message: 'Tipo de cita no válido' })
  type?: VisitType;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres' })
  reason?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(300, { message: 'Las notas admiten hasta 300 caracteres' })
  notes?: string | null;

  /** Agendar aunque el veterinario ya tenga otra cita a esa hora */
  @IsOptional()
  @IsBoolean()
  allowOverlap?: boolean;
}

export class UpdateAppointmentDto {
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  vetId?: number | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'La fecha y hora no son válidas' })
  startsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn(APPOINTMENT_DURATIONS, { message: 'Duración no válida' })
  durationMin?: number;

  @IsOptional()
  @IsIn(['CONSULTATION', 'GROOMING'], { message: 'Tipo de cita no válido' })
  type?: VisitType;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres' })
  reason?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(300, { message: 'Las notas admiten hasta 300 caracteres' })
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  allowOverlap?: boolean;
}

export class ListAppointmentsQuery {
  @Matches(DAY, { message: 'La fecha no es válida' })
  from: string;

  /** Inclusive; por defecto, el mismo día */
  @IsOptional()
  @Matches(DAY, { message: 'La fecha no es válida' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vetId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  petId?: number;
}

export class CancelAppointmentDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}
