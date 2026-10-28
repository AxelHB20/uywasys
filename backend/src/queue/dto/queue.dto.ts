import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { QueueStatus, VisitType } from '../../generated/prisma/enums.js';
import { emptyToNull } from '../../common/validators/peru.js';

export const QUEUE_STATUSES: QueueStatus[] = [
  'ARRIVED',
  'WAITING',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
];
/** Por ahora la cola es solo de consultas; GROOMING queda listo para la Fase 3. */
export const QUEUE_TYPES: VisitType[] = ['CONSULTATION'];

export class CreateQueueEntryDto {
  @IsInt({ message: 'Elige la mascota' })
  @Min(1)
  petId: number;

  @IsOptional()
  @IsIn(QUEUE_TYPES, { message: 'Tipo de atención no disponible' })
  type?: VisitType;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres' })
  reason?: string | null;
}

export class UpdateQueueEntryDto {
  @IsOptional()
  @IsIn(QUEUE_STATUSES, { message: 'Estado no válido' })
  status?: QueueStatus;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres' })
  reason?: string | null;
}

export class QueueDayQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha no es válida' })
  day?: string;
}
