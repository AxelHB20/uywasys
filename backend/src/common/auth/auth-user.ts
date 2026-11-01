import type { Role } from '../../generated/prisma/enums.js';

/** Usuario autenticado que viaja en cada petición (request.user). */
export interface AuthUser {
  id: number;
  clinicId: number;
  role: Role;
}

/** Contenido del token de sesión. */
export interface SessionPayload {
  sub: number;
  clinicId: number;
  role: Role;
  /** Versión de sesión del usuario al firmar; si ya no coincide, la sesión se cerró */
  sv: number;
}

export const SESSION_COOKIE = 'uywa_session';
