import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trim } from '../../common/validators/peru.js';

/** Anonimizar no se deshace: se pide el motivo (por ejemplo, "Lo pidió por escrito el 28/10"). */
export class AnonymizeClientDto {
  @Transform(trim)
  @IsString({ message: 'Escribe el motivo' })
  @Length(5, 300, { message: 'El motivo debe tener entre 5 y 300 caracteres' })
  reason: string;
}
