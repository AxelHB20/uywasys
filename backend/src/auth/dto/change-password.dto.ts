import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../common/security/passwords.js';

export class ChangePasswordDto {
  @IsString({ message: 'Ingresa tu contraseña actual' })
  @MinLength(1, { message: 'Ingresa tu contraseña actual' })
  @MaxLength(100, { message: 'La contraseña es demasiado larga' })
  currentPassword: string;

  @IsString({ message: PASSWORD_RULE_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}
