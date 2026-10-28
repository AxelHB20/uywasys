import type { Role } from '../../generated/prisma/enums.js';

/** Quienes registran y editan clientes, mascotas y la cola. Groomer y cajero solo consultan. */
export const FRONT_DESK_ROLES: Role[] = ['ADMIN', 'VET', 'RECEPTION'];

/** Quienes manejan la caja: abrir y cerrar, cobrar, vender en mostrador y registrar egresos. */
export const CASH_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'CASHIER'];
