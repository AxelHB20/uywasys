import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { emptyToNull, trim } from '../../common/validators/peru.js';
import type { TemplateKind } from '../../generated/prisma/enums.js';
import {
  MAX_PRESCRIPTION_ITEMS,
  PrescriptionItemDto,
} from './prescription.dto.js';

export const TEMPLATE_KINDS: TemplateKind[] = ['CONSULTATION', 'PRESCRIPTION'];

const optionalText = (max: number, label: string) => [
  Transform(emptyToNull),
  ValidateIf((_: unknown, v: unknown) => v !== null && v !== undefined),
  IsString(),
  MaxLength(max, { message: `${label} admite hasta ${max} caracteres` }),
];
const apply =
  (...decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) =>
    decorators.forEach((d) => d(target, key));

/** Lo que una plantilla de consulta deja escrito (los mismos límites de la atención) */
export class ConsultationContentDto {
  @apply(...optionalText(200, 'El motivo'))
  reason?: string | null;

  @apply(...optionalText(5000, 'La anamnesis'))
  anamnesis?: string | null;

  @apply(...optionalText(5000, 'El examen físico'))
  physicalExam?: string | null;

  @apply(...optionalText(300, 'El diagnóstico'))
  diagnosis?: string | null;

  @apply(...optionalText(5000, 'El plan'))
  plan?: string | null;
}

/** Una receta frecuente: sus medicamentos tal como se recetan (sin cantidades entregadas) */
export class PrescriptionContentDto {
  @apply(...optionalText(1000, 'Las indicaciones generales'))
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Agrega al menos un medicamento' })
  @ArrayMaxSize(MAX_PRESCRIPTION_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];
}

export class TemplateDto {
  @IsIn(TEMPLATE_KINDS, { message: 'Tipo de plantilla no válido' })
  kind: TemplateKind;

  @Transform(trim)
  @IsString({ message: 'Ponle un nombre' })
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres' })
  name: string;

  @ValidateIf((o: TemplateDto) => o.kind === 'CONSULTATION')
  @ValidateNested()
  @Type(() => ConsultationContentDto)
  consultation?: ConsultationContentDto;

  @ValidateIf((o: TemplateDto) => o.kind === 'PRESCRIPTION')
  @ValidateNested()
  @Type(() => PrescriptionContentDto)
  prescription?: PrescriptionContentDto;
}

export class UpdateTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres' })
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsultationContentDto)
  consultation?: ConsultationContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrescriptionContentDto)
  prescription?: PrescriptionContentDto;
}

export class ListTemplatesQuery {
  @IsOptional()
  @IsIn(TEMPLATE_KINDS)
  kind?: TemplateKind;
}
