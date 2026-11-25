import type { Clinic, User } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';

/** Datos del usuario que recibe el frontend. Nunca incluye la contraseña ni datos de seguridad. */
export interface SessionUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  licenseNumber: string | null;
  mustChangePassword: boolean;
  /** Soporte técnico: puede cambiar la configuración de facturación */
  support: boolean;
  clinic: { id: number; name: string; logoUrl: string | null };
}

/** Campos de la clínica que se leen con la sesión (sin el logo, que puede pesar hasta 1 MB). */
export const SESSION_CLINIC_SELECT = {
  id: true,
  name: true,
  logoMime: true,
  logoUpdatedAt: true,
} as const;

type SessionClinic = Pick<Clinic, 'id' | 'name' | 'logoMime' | 'logoUpdatedAt'>;

/** URL del logo con la fecha de actualización: el navegador lo guarda en caché y lo renueva al cambiarlo. */
export function clinicLogoUrl(
  clinic: Pick<Clinic, 'logoMime' | 'logoUpdatedAt'>,
): string | null {
  return clinic.logoMime && clinic.logoUpdatedAt
    ? `/api/clinic/logo?v=${clinic.logoUpdatedAt.getTime()}`
    : null;
}

export function toSessionUser(
  user: User & { clinic: SessionClinic },
): SessionUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    licenseNumber: user.licenseNumber,
    mustChangePassword: user.mustChangePassword,
    support: user.isSupport,
    clinic: {
      id: user.clinic.id,
      name: user.clinic.name,
      logoUrl: clinicLogoUrl(user.clinic),
    },
  };
}
