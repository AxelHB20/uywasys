import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import type { AttachmentKind } from '../../generated/prisma/enums.js';
import { trim } from '../../common/validators/peru.js';

export const ATTACHMENT_KINDS: AttachmentKind[] = [
  'PHOTO',
  'LAB',
  'IMAGING',
  'DOCUMENT',
];

/** Campos del formulario multipart que acompañan al archivo */
export class UploadAttachmentDto {
  @IsIn(ATTACHMENT_KINDS, { message: 'Elige el tipo de archivo' })
  kind: AttachmentKind;

  @Transform(trim)
  @IsString({ message: 'Escribe un título' })
  @Length(2, 150, { message: 'El título debe tener entre 2 y 150 caracteres' })
  title: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  visitId?: number;
}

export class ListAttachmentsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  visitId?: number;
}

export class VoidAttachmentDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;
}
