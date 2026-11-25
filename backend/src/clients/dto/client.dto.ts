import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { DocumentType } from '../../generated/prisma/enums.js';
import { IsRuc } from '../../common/validators/ruc.js';
import {
  DNI_REGEX,
  DOCUMENT_TYPES,
  emptyToNull,
  IsDocumentNumber,
  MOBILE_REGEX,
  toDocNumber,
  toPhone,
  trim,
} from '../../common/validators/peru.js';
import { CreatePetDto } from '../../pets/dto/pet.dto.js';

const notNull = (_: unknown, value: unknown) =>
  value !== null && value !== undefined;
const PHONE_MESSAGE = 'El celular debe tener 9 dígitos y empezar con 9';

export class CreateClientDto {
  /** Sin documento: docType y docNumber vacíos. */
  @ValidateIf((o: CreateClientDto) => o.docType != null || o.docNumber != null)
  @IsIn(DOCUMENT_TYPES, { message: 'Elige el tipo de documento' })
  docType?: DocumentType | null;

  @Transform(toDocNumber)
  @ValidateIf((o: CreateClientDto) => o.docType != null)
  @IsDocumentNumber()
  docNumber?: string | null;

  @Transform(trim)
  @IsString({ message: 'Ingresa el nombre del cliente' })
  @Length(3, 150, { message: 'El nombre debe tener entre 3 y 150 caracteres' })
  name: string;

  @Transform(toPhone)
  @Matches(MOBILE_REGEX, { message: PHONE_MESSAGE })
  phone: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(120, { message: 'El correo es demasiado largo' })
  email?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200, { message: 'La dirección admite hasta 200 caracteres' })
  address?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60, { message: 'El distrito admite hasta 60 caracteres' })
  district?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500, { message: 'Las notas admiten hasta 500 caracteres' })
  notes?: string | null;

  /** Ley 29733: sin consentimiento no se registra. */
  @Equals(true, {
    message: 'Marca el consentimiento del cliente para tratar sus datos',
  })
  consent: boolean;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  /** Registro rápido: la primera mascota en la misma operación. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePetDto)
  pet?: CreatePetDto;
}

export class UpdateClientDto {
  @ValidateIf(notNull)
  @IsIn(DOCUMENT_TYPES, { message: 'Elige el tipo de documento' })
  docType?: DocumentType | null;

  /** Se valida junto con docType en el servicio (puede venir solo uno de los dos). */
  @Transform(toDocNumber)
  @ValidateIf(notNull)
  @IsString()
  docNumber?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Ingresa el nombre del cliente' })
  @Length(3, 150, { message: 'El nombre debe tener entre 3 y 150 caracteres' })
  name?: string;

  @Transform(toPhone)
  @IsOptional()
  @Matches(MOBILE_REGEX, { message: PHONE_MESSAGE })
  phone?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(120, { message: 'El correo es demasiado largo' })
  email?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200, { message: 'La dirección admite hasta 200 caracteres' })
  address?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60, { message: 'El distrito admite hasta 60 caracteres' })
  district?: string | null;

  /** Datos de facturación (RUC al que factura, p. ej. su empresa). null en el RUC = borrarlos */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') || null : value,
  )
  @ValidateIf(notNull)
  @IsRuc()
  invoiceRuc?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(150, { message: 'La razón social admite hasta 150 caracteres' })
  invoiceName?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200, {
    message: 'La dirección fiscal admite hasta 200 caracteres',
  })
  invoiceAddress?: string | null;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(120, { message: 'El correo es demasiado largo' })
  invoiceEmail?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500, { message: 'Las notas admiten hasta 500 caracteres' })
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'El estado debe ser activo o inactivo' })
  active?: boolean;
}

export class ListClientsQuery {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}

export class LookupClientQuery {
  @IsIn(DOCUMENT_TYPES, { message: 'Elige el tipo de documento' })
  docType: DocumentType;

  @Transform(toDocNumber)
  @IsString()
  @MaxLength(12)
  docNumber: string;
}

export class LookupPhoneQuery {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @Matches(/^9\d{8}$/, {
    message: 'El celular debe tener 9 dígitos y empezar con 9',
  })
  phone: string;
}

export class CreateAuthorizedPersonDto {
  @Transform(trim)
  @IsString({ message: 'Ingresa el nombre de la persona autorizada' })
  @Length(3, 120, { message: 'El nombre debe tener entre 3 y 120 caracteres' })
  name: string;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(DNI_REGEX, { message: 'El DNI debe tener 8 dígitos' })
  dni?: string | null;

  @Transform(toPhone)
  @ValidateIf(notNull)
  @Matches(MOBILE_REGEX, { message: PHONE_MESSAGE })
  phone?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40, { message: 'El parentesco admite hasta 40 caracteres' })
  relation?: string | null;
}
