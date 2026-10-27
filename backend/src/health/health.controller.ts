import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface HealthStatus {
  status: 'ok';
  database: 'up';
  time: string;
}

/** GET /api/health — lo usan Docker y el monitoreo para saber si el sistema responde. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('La base de datos no responde');
    }
    return { status: 'ok', database: 'up', time: new Date().toISOString() };
  }
}
