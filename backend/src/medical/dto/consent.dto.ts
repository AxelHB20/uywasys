import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { ConsentType } from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const CONSENT_TYPES: ConsentType[] = [
  'SURGERY',
  'ANESTHESIA',
  'EUTHANASIA',
  'HOSPITALIZATION',
  'OTHER',
];

export class ConsentTemplateQuery {
  @IsIn(CONSENT_TYPES, { message: 'Tipo de consentimiento no válido' })
  type: ConsentType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  petId: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  procedure?: string;
}

export class CreateConsentDto {
  @IsInt({ message: 'Elige la mascota' })
  @Min(1)
  petId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  visitId?: number;

  @IsIn(CONSENT_TYPES, { message: 'Tipo de consentimiento no válido' })
  type: ConsentType;

  @Transform(trim)
  @IsString({ message: 'Describe el procedimiento' })
  @Length(3, 200, {
    message: 'El procedimiento debe tener entre 3 y 200 caracteres',
  })
  procedure: string;

  @Transform(trim)
  @IsString()
  @Length(50, 20000, { message: 'El texto del consentimiento está incompleto' })
  text: string;

  @Transform(trim)
  @IsString({ message: 'Escribe el nombre de quien firma' })
  @Length(3, 150, { message: 'El nombre debe tener entre 3 y 150 caracteres' })
  signerName: string;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(20)
  signerDocument?: string | null;

  @Transform(trim)
  @IsString()
  @Length(3, 40, { message: 'Indica la relación con la mascota' })
  signerRelation: string;

  /** data:image/png;base64,… dibujada en pantalla */
  @IsString({ message: 'Falta la firma' })
  @Matches(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, {
    message: 'La firma no es válida',
  })
  @MaxLength(500_000, { message: 'La firma es demasiado grande' })
  signature: string;
}

export class VoidConsentDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}
