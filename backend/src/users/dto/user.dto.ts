import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  ValidateIf,
  IsNumber,
  Min,
} from 'class-validator';
import type { Role } from '../../generated/prisma/enums.js';

export const ROLES: Role[] = [
  'ADMIN',
  'VET',
  'RECEPTION',
  'GROOMER',
  'CASHIER',
];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateUserDto {
  @Transform(trim)
  @IsString({ message: 'Ingresa el nombre completo' })
  @Length(3, 120, { message: 'El nombre debe tener entre 3 y 120 caracteres' })
  fullName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(120, { message: 'El correo es demasiado largo' })
  email: string;

  @IsIn(ROLES, { message: 'Elige un rol válido' })
  role: Role;

  /** Colegiatura (CMVP). Obligatoria para veterinarios: se imprime en las recetas. */
  @Transform(emptyToNull)
  @IsOptional()
  @Matches(/^[0-9A-Za-z-]{1,20}$/, {
    message: 'La colegiatura solo admite números, letras y guiones',
  })
  licenseNumber?: string | null;

  /** Groomers: % de comisión sobre lo cobrado de sus servicios (null = sin comisión) */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'La comisión admite hasta 2 decimales' },
  )
  @Min(0, { message: 'La comisión no puede ser negativa' })
  @Max(100, { message: 'La comisión no puede pasar de 100 %' })
  commissionPercent?: number | null;
}

export class UpdateUserDto {
  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Ingresa el nombre completo' })
  @Length(3, 120, { message: 'El nombre debe tener entre 3 y 120 caracteres' })
  fullName?: string;

  @IsOptional()
  @IsIn(ROLES, { message: 'Elige un rol válido' })
  role?: Role;

  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(/^[0-9A-Za-z-]{1,20}$/, {
    message: 'La colegiatura solo admite números, letras y guiones',
  })
  licenseNumber?: string | null;

  /** Groomers: % de comisión sobre lo cobrado de sus servicios (null = sin comisión) */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'La comisión admite hasta 2 decimales' },
  )
  @Min(0, { message: 'La comisión no puede ser negativa' })
  @Max(100, { message: 'La comisión no puede pasar de 100 %' })
  commissionPercent?: number | null;

  @IsOptional()
  @IsBoolean({ message: 'El estado debe ser activo o inactivo' })
  active?: boolean;
}
