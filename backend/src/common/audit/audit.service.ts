import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface AuditEntry {
  clinicId: number;
  userId?: number | null;
  /** Qué pasó, en formato area.accion: 'auth.login', 'sale.cancel', 'product.price_change' */
  action: string;
  entity: string;
  entityId?: string | number | null;
  data?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Bitácora de auditoría. Si falla al escribir, se registra en el log pero nunca bloquea la operación. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          clinicId: entry.clinicId,
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId != null ? String(entry.entityId) : null,
          data: entry.data,
          ip: entry.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar ${entry.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
