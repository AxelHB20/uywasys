import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
import type {
  HospEntryKind,
  HospOrderKind,
} from '../../generated/prisma/enums.js';

export const ORDER_KINDS: HospOrderKind[] = [
  'MEDICATION',
  'FLUIDS',
  'FEEDING',
  'PROCEDURE',
  'MONITORING',
];
export const ENTRY_KINDS: HospEntryKind[] = ['DOSE', 'VITALS', 'NOTE'];

const isSet = (_: unknown, v: unknown) => v !== null && v !== undefined;

export class AdmitDto {
  @IsInt()
  @Min(1)
  petId: number;

  /** La consulta desde la que se decide internar: se cierra y el internamiento sigue aparte */
  @IsOptional()
  @IsInt()
  @Min(1)
  fromVisitId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  vetId?: number;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(30, { message: 'La jaula admite hasta 30 caracteres' })
  cage?: string | null;

  @Transform(trim)
  @IsString({ message: 'Escribe el motivo del internamiento' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(300)
  diagnosis?: string | null;
}

export class UpdateHospitalizationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vetId?: number;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(30)
  cage?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason?: string;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(300)
  diagnosis?: string | null;
}

export class OrderDto {
  @IsIn(ORDER_KINDS, { message: 'Tipo de indicación no válido' })
  kind: HospOrderKind;

  @Transform(trim)
  @IsString({ message: 'Describe la indicación' })
  @Length(2, 150, {
    message: 'La indicación debe tener entre 2 y 150 caracteres',
  })
  description: string;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(80)
  dose?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(40)
  route?: string | null;

  /** Cada cuántas horas; vacío = una sola vez */
  @ValidateIf(isSet)
  @IsInt({ message: 'La frecuencia va en horas enteras' })
  @Min(1, { message: 'La frecuencia mínima es cada hora' })
  @Max(72, { message: 'La frecuencia máxima es cada 72 horas' })
  everyHours?: number | null;

  /** Primera dosis; por defecto, ahora */
  @IsOptional()
  @IsISO8601({}, { message: 'Fecha de inicio no válida' })
  startsAt?: string;

  /** Cuántos días dura; vacío = hasta que se suspenda o se dé de alta */
  @ValidateIf(isSet)
  @IsInt()
  @Min(1)
  @Max(60)
  durationDays?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}

export class EntryDto {
  @IsIn(ENTRY_KINDS)
  kind: HospEntryKind;

  @ValidateIf((o: EntryDto) => o.kind === 'DOSE')
  @IsInt({ message: 'Indica qué indicación se aplicó' })
  @Min(1)
  orderId?: number;

  /** La hora programada que cubre */
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  skipped?: boolean;

  @ValidateIf(isSet)
  @IsNumber({ maxDecimalPlaces: 1 }, { message: 'Temperatura con un decimal' })
  @Min(30, { message: 'La temperatura parece fuera de rango (30–45 °C)' })
  @Max(45, { message: 'La temperatura parece fuera de rango (30–45 °C)' })
  temperatureC?: number | null;

  @ValidateIf(isSet)
  @IsInt()
  @Min(20, { message: 'La frecuencia cardiaca parece fuera de rango' })
  @Max(400, { message: 'La frecuencia cardiaca parece fuera de rango' })
  heartRate?: number | null;

  @ValidateIf(isSet)
  @IsInt()
  @Min(4, { message: 'La frecuencia respiratoria parece fuera de rango' })
  @Max(200, { message: 'La frecuencia respiratoria parece fuera de rango' })
  respiratoryRate?: number | null;

  @ValidateIf(isSet)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(150)
  weightKg?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(40)
  mucosa?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((o: EntryDto, v: unknown) => o.kind === 'NOTE' || isSet(o, v))
  @IsString({ message: 'Escribe la nota' })
  @MaxLength(500, { message: 'La nota admite hasta 500 caracteres' })
  notes?: string | null;
}

export class DischargeDto {
  @IsIn(['DISCHARGED', 'DECEASED'])
  outcome: 'DISCHARGED' | 'DECEASED';

  /** Servicio de internamiento (por día) que se cobra; vacío = no se cobra estancia */
  @ValidateIf(isSet)
  @IsInt()
  @Min(1)
  careServiceId?: number | null;

  /** Días a cobrar; por defecto, cada 24 h o fracción */
  @ValidateIf(isSet)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(1000, {
    message: 'Las indicaciones de alta admiten hasta 1000 caracteres',
  })
  notes?: string | null;
}

export class BoardQueryDto {
  /** Incluye los dados de alta en los últimos N días */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(30)
  recentDays?: number;
}
