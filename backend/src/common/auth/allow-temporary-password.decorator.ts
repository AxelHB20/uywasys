import { SetMetadata } from '@nestjs/common';

export const ALLOW_TEMPORARY_PASSWORD_KEY = 'allowTemporaryPassword';

/**
 * Endpoints que un usuario con clave temporal sí puede usar (ver su sesión, cambiar la clave, salir).
 * Todo lo demás responde 403 hasta que cambie la contraseña.
 */
export const AllowTemporaryPassword = () =>
  SetMetadata(ALLOW_TEMPORARY_PASSWORD_KEY, true);
