import { BadRequestException } from '@nestjs/common';

/** Un cliente anonimizado (Ley 29733, cancelación) ya no se edita ni recibe mascotas nuevas. */
export function anonymizedError(): BadRequestException {
  return new BadRequestException(
    'Este cliente fue anonimizado: sus datos ya no se pueden editar',
  );
}
