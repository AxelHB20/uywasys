import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type {
  GroomingTransport,
  QueueStatus,
  VisitType,
} from '../../generated/prisma/enums.js';
import { emptyToNull } from '../../common/validators/peru.js';

export const QUEUE_STATUSES: QueueStatus[] = [
  'ARRIVED',
  'WAITING',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
];
export const TRANSPORT_OPTIONS: GroomingTransport[] = [
  'NONE',
  'PICKUP',
  'DROPOFF',
  'ROUND_TRIP',
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

  /** Movilidad: recojo, entrega o ambos (consulta; el grooming la pide en su ingreso) */
  @IsOptional()
  @IsIn(TRANSPORT_OPTIONS, { message: 'Movilidad no válida' })
  transport?: GroomingTransport;

  @Transform(emptyToNull)
  @ValidateIf(
    (o: { transport?: GroomingTransport; transportAddress?: string | null }) =>
      (o.transport !== undefined && o.transport !== 'NONE') ||
      (o.transportAddress !== null && o.transportAddress !== undefined),
  )
  @IsString({ message: 'Indica la dirección de recojo o entrega' })
  @Length(5, 200, { message: 'Indica la dirección de recojo o entrega' })
  transportAddress?: string | null;

  /** Precio con IGV que pone recepción; vacío o 0 = sin cobro */
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio de la movilidad admite hasta 2 decimales' },
  )
  @Min(0, { message: 'El precio de la movilidad no puede ser negativo' })
  @Max(500, {
    message: 'La movilidad no puede pasar de S/ 500: revisa el monto',
  })
  transportPrice?: number | null;
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

  /** Movilidad: recojo, entrega o ambos (consulta; el grooming la pide en su ingreso) */
  @IsOptional()
  @IsIn(TRANSPORT_OPTIONS, { message: 'Movilidad no válida' })
  transport?: GroomingTransport;

  @Transform(emptyToNull)
  // Al cambiar solo el tipo o el precio se queda la dirección que tenía
  @ValidateIf(
    (o: { transportAddress?: string | null }) =>
      o.transportAddress !== null && o.transportAddress !== undefined,
  )
  @IsString({ message: 'Indica la dirección de recojo o entrega' })
  @Length(5, 200, { message: 'Indica la dirección de recojo o entrega' })
  transportAddress?: string | null;

  /** Precio con IGV que pone recepción; vacío o 0 = sin cobro */
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio de la movilidad admite hasta 2 decimales' },
  )
  @Min(0, { message: 'El precio de la movilidad no puede ser negativo' })
  @Max(500, {
    message: 'La movilidad no puede pasar de S/ 500: revisa el monto',
  })
  transportPrice?: number | null;

  /** Al cancelar: la movilidad ya se hizo (fueron a recogerlo), se cobra igual */
  @IsOptional()
  @IsBoolean()
  chargeTransport?: boolean;
}

export class QueueDayQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha no es válida' })
  day?: string;
}
