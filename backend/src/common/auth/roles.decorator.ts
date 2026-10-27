import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';

/** Restringe un endpoint a ciertos roles. Ejemplo: @Roles('ADMIN', 'CASHIER') */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
