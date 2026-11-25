import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../common/security/passwords.js';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(120, { message: 'El correo es demasiado largo' })
  email: string;
}

export class ResetPasswordDto {
  @IsString({ message: 'El enlace no es válido' })
  @MinLength(20, { message: 'El enlace no es válido' })
  @MaxLength(100, { message: 'El enlace no es válido' })
  token: string;

  @IsString({ message: PASSWORD_RULE_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password: string;
}
