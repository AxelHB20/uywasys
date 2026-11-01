import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { ImmunizationKind } from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const IMMUNIZATION_KINDS: ImmunizationKind[] = [
  'VACCINE',
  'DEWORMING_INTERNAL',
  'DEWORMING_EXTERNAL',
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateImmunizationDto {
  @IsInt({ message: 'Elige la mascota' })
  @Min(1)
  petId: number;

  /** Atención abierta en la que se aplica. Sin atención = se registra una aplicada antes. */
  @IsOptional()
  @IsInt()
  @Min(1)
  visitId?: number;

  @IsIn(IMMUNIZATION_KINDS, { message: 'Elige vacuna o desparasitación' })
  kind: ImmunizationKind;

  @Transform(trim)
  @IsString({ message: 'Escribe la vacuna o el producto' })
  @Length(2, 100, {
    message: 'El nombre debe tener entre 2 y 100 caracteres',
  })
  name: string;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(60, { message: 'El laboratorio admite hasta 60 caracteres' })
  laboratory?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(40, { message: 'El lote admite hasta 40 caracteres' })
  batchNumber?: string | null;

  /** Obligatoria si no se aplica en una atención; en una atención es la fecha de hoy */
  @IsOptional()
  @Matches(DAY, { message: 'La fecha de aplicación no es válida' })
  appliedAt?: string;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Matches(DAY, { message: 'La fecha del próximo refuerzo no es válida' })
  nextDueAt?: string | null;

  @IsOptional()
  @IsBoolean()
  external?: boolean;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(120, { message: 'La clínica admite hasta 120 caracteres' })
  externalClinic?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(300, { message: 'Las notas admiten hasta 300 caracteres' })
  notes?: string | null;
}

export class VoidImmunizationDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}

export class DueImmunizationsQuery {
  /** overdue = refuerzos vencidos (hasta 6 meses atrás); upcoming = los próximos días */
  @IsOptional()
  @IsIn(['overdue', 'upcoming'])
  status?: 'overdue' | 'upcoming';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
