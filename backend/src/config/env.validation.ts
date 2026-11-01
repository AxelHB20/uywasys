import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/** Variables de entorno obligatorias. Si falta alguna, la app no arranca y dice cuál. */
class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  /** Clave para firmar las sesiones. Larga y secreta: genera una con `npx -y uuid` dos veces seguidas. */
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  /** Duración de la sesión en horas (un turno de trabajo). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  SESSION_HOURS: number = 8;

  /** true en producción (HTTPS): la cookie de sesión solo viaja cifrada. */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  COOKIE_SECURE: boolean = false;

  /** Peticiones por minuto que acepta cada conexión (IP) en una misma ruta. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  API_RATE_LIMIT: number = 600;

  /** Intentos de inicio de sesión por minuto desde una misma conexión (IP). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_RATE_LIMIT: number = 10;

  /** Clave para cifrar el token del PSE; si falta se deriva de JWT_SECRET */
  @IsOptional()
  @IsString()
  BILLING_SECRET?: string;

  /** Cada cuántos segundos revisa la cola de comprobantes por enviar */
  @Type(() => Number)
  @IsInt()
  @Min(5)
  BILLING_POLL_SECONDS: number = 30;

  /** true detrás de Caddy o Nginx: la IP real del usuario llega en X-Forwarded-For. */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  TRUST_PROXY: boolean = false;

  /** Origen del frontend permitido por CORS (por ejemplo http://localhost:4200) */
  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const detail = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Configuración inválida en .env:\n${detail}`);
  }
  return validated;
}
