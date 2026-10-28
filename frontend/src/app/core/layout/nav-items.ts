import { Role } from '../auth/auth.models';
import { IconName } from '../../shared/ui/icon/icons';

export interface NavItem {
  label: string;
  icon: IconName;
  route: string;
  exact?: boolean;
  /** Fase del plan en que llega el módulo. Mientras exista, el menú muestra la etiqueta. */
  comingIn?: string;
  /** Si se indica, solo esos roles ven el ítem. */
  roles?: Role[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Menú principal. Agregar un módulo nuevo = agregar una línea aquí y su ruta en app.routes.ts. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'General',
    items: [{ label: 'Inicio', icon: 'dashboard', route: '/dashboard', exact: true }],
  },
  {
    label: 'Atención',
    items: [
      { label: 'Cola de hoy', icon: 'clock', route: '/cola' },
      { label: 'Clientes', icon: 'clients', route: '/clientes' },
    ],
  },
  {
    label: 'Farmacia',
    items: [{ label: 'Inventario', icon: 'package', route: '/inventario' }],
  },
  // Grooming, citas, consultas, vacunas y caja se agregan aquí cuando estén listos:
  // el menú solo muestra módulos que funcionan.
  {
    label: 'Configuración',
    items: [
      { label: 'Clínica', icon: 'building', route: '/configuracion', roles: ['ADMIN'] },
      { label: 'Usuarios', icon: 'user-cog', route: '/usuarios', roles: ['ADMIN'] },
    ],
  },
];

/** Menú visible para un rol: quita los ítems que no le corresponden y los grupos que quedan vacíos. */
export function navFor(role: Role | null | undefined): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || (role != null && item.roles.includes(role))),
  })).filter((group) => group.items.length > 0);
}

/** Marca mostrada en el menú. */
export const APP_BRAND = {
  name: 'Uywa',
  tagline: 'Gestión veterinaria',
};
