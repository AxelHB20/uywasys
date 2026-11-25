import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * La sesión de PostgreSQL siempre en UTC. El adaptador de Prisma manda las fechas sin zona
 * horaria y PostgreSQL las interpreta en la zona de la sesión: si el servidor está en hora de
 * Lima (TZ en Docker), cada fecha guardada quedaba 5 horas corrida. Las fechas que se muestran
 * siguen en hora de Lima: eso lo decide la zona de la clínica, no la de la base de datos.
 */
export const PG_SESSION_OPTIONS = '-c timezone=UTC';

/** Cliente de base de datos compartido por toda la app (una sola conexión pool). */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        options: PG_SESSION_OPTIONS,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
