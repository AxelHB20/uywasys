import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(120, { message: 'El correo es demasiado largo' })
  email: string;

  @IsString({ message: 'Ingresa tu contraseña' })
  @MinLength(1, { message: 'Ingresa tu contraseña' })
  @MaxLength(100, { message: 'La contraseña es demasiado larga' })
  password: string;
}
