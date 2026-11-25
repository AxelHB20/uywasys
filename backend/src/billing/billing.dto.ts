import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDocumentNumber } from '../common/validators/peru.js';

const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\D/g, '') : value;

/**
 * Datos del comprador escritos en el mismo cobro: el RUC para la factura (puede ser el de la
 * empresa del cliente) o el DNI para la boleta de más de S/ 700. Si el cliente está registrado se
 * guardan en su ficha para el próximo cobro.
 */
export class BuyerDto {
  @IsIn(['RUC', 'DNI'], { message: 'Elige RUC o DNI' })
  docType: 'RUC' | 'DNI';

  @Transform(digits)
  @IsDocumentNumber()
  docNumber: string;

  @Transform(trimOrNull)
  @IsString({ message: 'Escribe el nombre o la razón social' })
  @MaxLength(150, { message: 'El nombre es demasiado largo' })
  name: string;

  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'La dirección es demasiado larga' })
  address?: string | null;

  @Transform(trimOrNull)
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(120)
  email?: string | null;

  /** Guardar en la ficha del cliente (por defecto sí; nunca para "Cliente varios") */
  @IsOptional()
  @IsBoolean()
  save?: boolean;
}

/** Cambiar una boleta por factura: los datos de la empresa */
export class ToFacturaDto {
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer: BuyerDto;
}

export class LookupQuery {
  @IsIn(['RUC', 'DNI'])
  type: 'RUC' | 'DNI';

  @Transform(digits)
  @Matches(/^\d{8}(\d{3})?$/, { message: 'El número no es válido' })
  number: string;
}

/** Token nuevo del PSE: lo pega el administrador; se prueba antes de guardarlo */
export class UpdateTokenDto {
  @Transform(trimOrNull)
  @IsString({ message: 'Pega el token que te envió el PSE' })
  @MinLength(8, { message: 'El token parece incompleto: cópialo completo' })
  @MaxLength(200)
  apiToken: string;
}

export class BillingSettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsIn(['SIMULATED', 'NUBEFACT', 'LUCODE', 'MIFACT'], {
    message: 'Elige el proveedor',
  })
  provider: 'SIMULATED' | 'NUBEFACT' | 'LUCODE' | 'MIFACT';

  @IsBoolean()
  production: boolean;

  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'La razón social es demasiado larga' })
  legalName?: string | null;

  /** Domicilio fiscal tal como figura en SUNAT (Mifact) */
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'La dirección fiscal es demasiado larga' })
  fiscalAddress?: string | null;

  /** Ubigeo INEI del domicilio fiscal (Mifact) */
  @Transform(trimOrNull)
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{6}$/, { message: 'El ubigeo tiene 6 dígitos (ej. 150101)' })
  ubigeo?: string | null;

  @Transform(trimOrNull)
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'La ruta del PSE debe empezar con https://' },
  )
  @MaxLength(300)
  apiUrl?: string | null;

  /** Solo se envía para cambiarlo. Vacío o ausente = se mantiene el guardado */
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  apiToken?: string | null;

  /** Token de la consulta de RUC/DNI (APISPERU). Igual que el del PSE: solo para cambiarlo */
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  lookupToken?: string | null;

  /** true = borrar el token de consulta guardado */
  @IsOptional()
  @IsBoolean()
  clearLookupToken?: boolean;

  @Transform(upper)
  @Matches(/^B[A-Z0-9]{3}$/, {
    message:
      'La serie de boletas tiene 4 caracteres y empieza con B (ej. B001)',
  })
  boletaSeries: string;

  @Transform(upper)
  @Matches(/^F[A-Z0-9]{3}$/, {
    message:
      'La serie de facturas tiene 4 caracteres y empieza con F (ej. F001)',
  })
  facturaSeries: string;

  @Transform(upper)
  @Matches(/^B[A-Z0-9]{3}$/, {
    message: 'La serie de notas de crédito de boletas empieza con B (ej. BC01)',
  })
  boletaCreditSeries: string;

  @Transform(upper)
  @Matches(/^F[A-Z0-9]{3}$/, {
    message:
      'La serie de notas de crédito de facturas empieza con F (ej. FC01)',
  })
  facturaCreditSeries: string;

  /** Comprobantes por mes del plan del PSE (vacío = sin límite que vigilar) */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El cupo del plan es un número entero' })
  @Min(1, { message: 'El cupo del plan es al menos 1' })
  @Max(1_000_000)
  monthlyQuota?: number | null;

  /** Vencimientos del servicio (YYYY-MM-DD): se avisa 30 días antes */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Fecha de vencimiento no válida' })
  planExpiresOn?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Fecha de vencimiento no válida' })
  domainExpiresOn?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Fecha de vencimiento no válida' })
  serverExpiresOn?: string | null;
}

export class DocumentsQuery {
  @IsOptional()
  @IsIn([
    'PENDING',
    'SENT',
    'ACCEPTED',
    'REJECTED',
    'ERROR',
    'PROBLEMS',
    'LATE',
    'ANNULLED',
  ])
  status?:
    | 'PENDING'
    | 'SENT'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'ERROR'
    | 'PROBLEMS'
    | 'LATE'
    | 'ANNULLED';

  /** Número, nombre o documento del cliente */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @IsIn(['BOLETA', 'FACTURA', 'CREDIT_NOTE'])
  type?: 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class ReportQuery {
  @Matches(DATE, { message: 'Indica desde qué fecha' })
  from: string;

  @Matches(DATE, { message: 'Indica hasta qué fecha' })
  to: string;
}
