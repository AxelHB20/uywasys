import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BillingSettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsIn(['SIMULATED', 'NUBEFACT'], { message: 'Elige el proveedor' })
  provider: 'SIMULATED' | 'NUBEFACT';

  @IsBoolean()
  production: boolean;

  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'La razón social es demasiado larga' })
  legalName?: string | null;

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
}

export class DocumentsQuery {
  @IsOptional()
  @IsIn(['PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'ERROR', 'PROBLEMS'])
  status?: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'PROBLEMS';

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
