import type { Role } from '../../generated/prisma/enums.js';

/** Quienes registran y editan clientes, mascotas y la cola. Groomer y cajero solo consultan. */
export const FRONT_DESK_ROLES: Role[] = ['ADMIN', 'VET', 'RECEPTION'];

/** Quienes manejan la caja: abrir y cerrar, cobrar, vender en mostrador y registrar egresos. */
export const CASH_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'CASHIER'];

/** Quienes ingresan, mueven en el tablero y entregan los servicios de grooming. */
export const GROOMING_ROLES: Role[] = ['ADMIN', 'VET', 'RECEPTION', 'GROOMER'];

/**
 * Quienes ven la historia clínica (SOAP, recetas, consentimientos y adjuntos). Caja y groomer no:
 * caja cobra desde la cuenta del cliente y el groomer solo abre las atenciones de grooming.
 */
export const CLINICAL_ROLES: Role[] = ['ADMIN', 'VET', 'RECEPTION'];
