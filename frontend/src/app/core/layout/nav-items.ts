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

/**
 * Menú principal, ordenado por quién trabaja y en qué paso del día (ver docs/FLUJOS.md):
 * recepción → clínica → grooming → caja → gestión. Cada rol ve solo lo suyo.
 * Agregar un módulo nuevo = agregar una línea aquí, en el grupo de quien lo usa, y su ruta.
 */
const CLINICAL: Role[] = ['ADMIN', 'VET', 'RECEPTION'];

export const NAV_GROUPS: NavGroup[] = [
  {
    // Sin título: Inicio va solo arriba
    label: '',
    items: [{ label: 'Inicio', icon: 'dashboard', route: '/dashboard', exact: true }],
  },
  {
    label: 'Recepción',
    items: [
      { label: 'Cola de hoy', icon: 'clock', route: '/cola' },
      { label: 'Citas', icon: 'calendar', route: '/citas' },
      { label: 'Clientes', icon: 'clients', route: '/clientes' },
    ],
  },
  {
    label: 'Clínica',
    items: [
      { label: 'Historias clínicas', icon: 'folder-heart', route: '/historias', roles: CLINICAL },
      { label: 'Atenciones', icon: 'stethoscope', route: '/atenciones', roles: CLINICAL },
      { label: 'Hospitalización', icon: 'bed', route: '/hospitalizacion', roles: CLINICAL },
      { label: 'Exámenes', icon: 'flask', route: '/examenes', roles: CLINICAL },
      { label: 'Refuerzos', icon: 'syringe', route: '/vacunas', roles: CLINICAL },
      { label: 'Presupuestos', icon: 'clipboard-list', route: '/presupuestos', roles: CLINICAL },
    ],
  },
  {
    label: 'Grooming',
    items: [
      {
        label: 'Tablero',
        icon: 'scissors',
        route: '/grooming',
        exact: true,
        roles: ['ADMIN', 'RECEPTION', 'GROOMER'],
      },
    ],
  },
  {
    label: 'Caja',
    items: [
      { label: 'Caja', icon: 'receipt', route: '/caja', roles: ['ADMIN', 'RECEPTION', 'CASHIER'] },
      {
        label: 'Comprobantes',
        icon: 'file-text',
        route: '/comprobantes',
        roles: ['ADMIN', 'RECEPTION', 'CASHIER'],
      },
    ],
  },
  {
    label: 'Gestión',
    items: [
      {
        label: 'Inventario',
        icon: 'package',
        route: '/inventario',
        roles: ['ADMIN', 'VET', 'RECEPTION', 'CASHIER'],
      },
      {
        label: 'Servicios y precios',
        icon: 'table',
        route: '/servicios',
        roles: ['ADMIN', 'VET', 'RECEPTION'],
      },
      {
        label: 'Plantillas clínicas',
        icon: 'book-open',
        route: '/plantillas',
        roles: ['ADMIN', 'VET'],
      },
      { label: 'Reportes', icon: 'chart-column', route: '/reportes', roles: ['ADMIN'] },
      { label: 'Clínica', icon: 'building', route: '/configuracion', roles: ['ADMIN'] },
      { label: 'Usuarios', icon: 'user-cog', route: '/usuarios', roles: ['ADMIN'] },
      { label: 'Actividad', icon: 'history', route: '/actividad', roles: ['ADMIN'] },
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
