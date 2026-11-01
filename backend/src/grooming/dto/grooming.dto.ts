import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PET_SIZES } from '../../care-services/care-service.dto.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';
import type {
  GroomingStatus,
  GroomingTransport,
  PetSize,
} from '../../generated/prisma/enums.js';

/** Estados del tablero que se mueven a mano; la entrega y la cancelación tienen su propia acción */
export const BOARD_STATUSES: GroomingStatus[] = [
  'WAITING',
  'BATHING',
  'CUTTING',
  'READY',
];
export const TRANSPORTS: GroomingTransport[] = [
  'NONE',
  'PICKUP',
  'DROPOFF',
  'ROUND_TRIP',
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class GroomingServiceItemDto {
  @IsInt({ message: 'Elige el servicio' })
  @Min(1)
  careServiceId: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'La cantidad es un entero' })
  @Min(1)
  @Max(20)
  quantity?: number;
}

export class CheckInDto {
  @IsInt({ message: 'Elige la mascota' })
  @Min(1)
  petId: number;

  /** Si llegó por la cola (o por una cita), la entrada pasa a "En atención" */
  @IsOptional()
  @IsInt()
  @Min(1)
  queueEntryId?: number;

  @IsIn(PET_SIZES, { message: 'Elige el tamaño de la mascota' })
  size: PetSize;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt({ message: 'Elige el groomer' })
  @Min(1)
  groomerId?: number | null;

  /** Hora de recojo acordada (ISO) */
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsISO8601({}, { message: 'Hora de recojo no válida' })
  promisedAt?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un servicio' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GroomingServiceItemDto)
  services: GroomingServiceItemDto[];

  // ── Checklist ──
  @IsOptional()
  @IsBoolean()
  fleas?: boolean;

  @IsOptional()
  @IsBoolean()
  ticks?: boolean;

  @IsOptional()
  @IsBoolean()
  matting?: boolean;

  @IsOptional()
  @IsBoolean()
  aggressive?: boolean;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(300, { message: 'Las observaciones admiten hasta 300 caracteres' })
  skinNotes?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200, { message: 'Las pertenencias admiten hasta 200 caracteres' })
  belongings?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(300, { message: 'Las indicaciones admiten hasta 300 caracteres' })
  instructions?: string | null;

  @IsOptional()
  @IsIn(TRANSPORTS, { message: 'Movilidad no válida' })
  transport?: GroomingTransport;

  @Transform(emptyToNull)
  @ValidateIf(
    (o: CheckInDto) =>
      (o.transport !== undefined && o.transport !== 'NONE') ||
      (o.transportAddress !== null && o.transportAddress !== undefined),
  )
  @IsString({ message: 'Indica la dirección de recojo o entrega' })
  @Length(5, 200, { message: 'Indica la dirección de recojo o entrega' })
  transportAddress?: string | null;

  /** Firma del dueño al dejar la mascota (opcional) */
  @Transform(emptyToNull)
  @ValidateIf((o: CheckInDto) => Boolean(o.signature))
  @IsString({ message: 'Escribe el nombre de quien firma' })
  @Length(3, 150, { message: 'Escribe el nombre de quien firma' })
  signerName?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @Matches(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, {
    message: 'La firma no es válida',
  })
  @MaxLength(500_000, { message: 'La firma es demasiado grande' })
  signature?: string | null;
}

export class BoardQuery {
  /** AAAA-MM-DD; por defecto, hoy (con lo que sigue en curso de días anteriores) */
  @IsOptional()
  @Matches(DAY, { message: 'Fecha no válida' })
  day?: string;
}

export class CommissionsQuery {
  @Matches(DAY, { message: 'Indica desde qué fecha' })
  from: string;

  @Matches(DAY, { message: 'Indica hasta qué fecha' })
  to: string;

  /** Solo el administrador: un groomer en particular */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groomerId?: number;
}

export class MoveDto {
  @IsIn(BOARD_STATUSES, { message: 'Estado no válido' })
  status: GroomingStatus;
}

export class AssignDto {
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt({ message: 'Elige el groomer' })
  @Min(1)
  groomerId: number | null;
}

export class DeliverDto {
  @Transform(trim)
  @IsString({ message: 'Escribe quién recoge' })
  @Length(3, 150, { message: 'Escribe el nombre de quien recoge' })
  pickedUpBy: string;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(20)
  pickedUpDocument?: string | null;

  @Transform(trim)
  @IsString({ message: 'Indica la relación con la mascota' })
  @Length(3, 40, { message: 'Indica la relación con la mascota' })
  pickedUpRelation: string;
}

export class CancelGroomingDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}
