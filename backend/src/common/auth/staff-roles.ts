import type { Role } from '../../generated/prisma/enums.js';

/** Quienes registran y editan clientes, mascotas y la cola. Groomer y cajero solo consultan. */
export const FRONT_DESK_ROLES: Role[] = ['ADMIN', 'VET', 'RECEPTION'];
