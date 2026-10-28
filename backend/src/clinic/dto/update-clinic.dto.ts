import { Transform } from 'class-transformer';
import {
  IsEmail,
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
import { IsRuc } from '../../common/validators/ruc.js';

/** Convierte "" o solo espacios en null: el campo opcional se borra. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class UpdateClinicDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Ingresa el nombre de la clínica' })
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres' })
  name: string;

  @Transform(emptyToNull)
  @IsOptional()
  @IsRuc()
  ruc?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'La dirección es demasiado larga' })
  address?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @Matches(/^\+?[0-9 ()-]{6,20}$/, {
    message: 'Ingresa un teléfono válido, por ejemplo 987 654 321',
  })
  phone?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(120, { message: 'El correo es demasiado largo' })
  email?: string | null;

  /** Descuento máximo por línea (%) sin autorización del administrador. 0 = solo el administrador descuenta */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El tope de descuento admite hasta 2 decimales' },
  )
  @Min(0, { message: 'El tope de descuento no puede ser negativo' })
  @Max(100, { message: 'El tope de descuento no puede pasar de 100 %' })
  maxDiscountPercent?: number;
}
