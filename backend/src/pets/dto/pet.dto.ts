import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
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
import type { PetSex, Species } from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';

export const SPECIES: Species[] = [
  'DOG',
  'CAT',
  'RABBIT',
  'GUINEA_PIG',
  'BIRD',
  'REPTILE',
  'OTHER',
];
export const PET_SEXES: PetSex[] = ['MALE', 'FEMALE'];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const notNull = (_: unknown, value: unknown) =>
  value !== null && value !== undefined;

export class CreatePetDto {
  @Transform(trim)
  @IsString({ message: 'Ingresa el nombre de la mascota' })
  @Length(1, 60, {
    message: 'El nombre de la mascota admite hasta 60 caracteres',
  })
  name: string;

  @IsIn(SPECIES, { message: 'Elige la especie' })
  species: Species;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60, { message: 'La raza admite hasta 60 caracteres' })
  breed?: string | null;

  @ValidateIf(notNull)
  @IsIn(PET_SEXES, { message: 'Elige macho o hembra' })
  sex?: PetSex | null;

  @IsOptional()
  @IsBoolean()
  neutered?: boolean;

  /** AAAA-MM-DD. Si solo se sabe la edad, el front calcula la fecha y marca birthDateEstimated. */
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(DATE_REGEX, { message: 'La fecha de nacimiento no es válida' })
  birthDate?: string | null;

  @IsOptional()
  @IsBoolean()
  birthDateEstimated?: boolean;

  @ValidateIf(notNull)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El peso debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'El peso debe ser mayor a 0' })
  @Max(999.99, { message: 'El peso máximo es 999.99 kg' })
  weightKg?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40, { message: 'El color admite hasta 40 caracteres' })
  color?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^[0-9A-Za-z]{9,15}$/, {
    message: 'El microchip debe tener entre 9 y 15 letras o números',
  })
  microchip?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300, { message: 'Las alergias admiten hasta 300 caracteres' })
  allergies?: string | null;

  @IsOptional()
  @IsBoolean()
  aggressive?: boolean;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200, { message: 'La nota admite hasta 200 caracteres' })
  aggressiveNote?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500, { message: 'Las notas admiten hasta 500 caracteres' })
  notes?: string | null;
}

export class UpdatePetDto {
  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Ingresa el nombre de la mascota' })
  @Length(1, 60, {
    message: 'El nombre de la mascota admite hasta 60 caracteres',
  })
  name?: string;

  @IsOptional()
  @IsIn(SPECIES, { message: 'Elige la especie' })
  species?: Species;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60, { message: 'La raza admite hasta 60 caracteres' })
  breed?: string | null;

  @ValidateIf(notNull)
  @IsIn(PET_SEXES, { message: 'Elige macho o hembra' })
  sex?: PetSex | null;

  @IsOptional()
  @IsBoolean()
  neutered?: boolean;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(DATE_REGEX, { message: 'La fecha de nacimiento no es válida' })
  birthDate?: string | null;

  @IsOptional()
  @IsBoolean()
  birthDateEstimated?: boolean;

  @ValidateIf(notNull)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El peso debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'El peso debe ser mayor a 0' })
  @Max(999.99, { message: 'El peso máximo es 999.99 kg' })
  weightKg?: number | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40, { message: 'El color admite hasta 40 caracteres' })
  color?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^[0-9A-Za-z]{9,15}$/, {
    message: 'El microchip debe tener entre 9 y 15 letras o números',
  })
  microchip?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300, { message: 'Las alergias admiten hasta 300 caracteres' })
  allergies?: string | null;

  @IsOptional()
  @IsBoolean()
  aggressive?: boolean;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200, { message: 'La nota admite hasta 200 caracteres' })
  aggressiveNote?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500, { message: 'Las notas admiten hasta 500 caracteres' })
  notes?: string | null;

  /** Fecha de fallecimiento (AAAA-MM-DD); null la quita. Una mascota fallecida no entra a la cola. */
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(DATE_REGEX, { message: 'La fecha de fallecimiento no es válida' })
  deceasedAt?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
