export type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'GROOMER' | 'CASHIER';

/** Usuario de la sesión, tal como lo devuelve GET /api/auth/me. */
export interface SessionUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  licenseNumber: string | null;
  /** Entró con una clave temporal: debe cambiarla antes de usar el sistema. */
  mustChangePassword: boolean;
  /** Soporte técnico: único que cambia la configuración de facturación y el RUC. */
  support?: boolean;
  clinic: { id: number; name: string; logoUrl: string | null };
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  VET: 'Médico veterinario',
  RECEPTION: 'Recepción',
  GROOMER: 'Groomer',
  CASHIER: 'Caja',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Configura la clínica y administra al equipo',
  VET: 'Atiende consultas, firma recetas y vacunas',
  RECEPTION: 'Registra clientes, mascotas y citas',
  GROOMER: 'Maneja el tablero de baños y peluquería',
  CASHIER: 'Cobra, emite comprobantes y cierra caja',
};
