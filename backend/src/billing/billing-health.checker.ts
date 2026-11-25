import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillingService } from './billing.service.js';

/** Horas (de Lima, UTC−5 sin horario de verano) en que se revisa: antes de abrir, al mediodía… */
export const CHECK_HOURS = [0, 6, 12, 18];
const LIMA_OFFSET_HOURS = -5;
/** Al arrancar el servidor, una revisión tras este tiempo (deja terminar el arranque) */
const STARTUP_DELAY_MS = 60_000;
/** Otra instancia que revisó hace menos de esto: no se repite */
const CLAIM_MINUTES = 5;

/** Milisegundos hasta la próxima hora de revisión (en hora de Lima) */
export function msUntilNextCheck(now: Date = new Date()): number {
  const lima = new Date(now.getTime() + LIMA_OFFSET_HOURS * 3_600_000);
  const hour = lima.getUTCHours();
  const next = CHECK_HOURS.find((h) => h > hour) ?? CHECK_HOURS[0] + 24;
  const target = new Date(lima);
  target.setUTCHours(next, 0, 0, 0);
  return target.getTime() - lima.getTime();
}

/**
 * Revisa sola la conexión con el PSE de cada clínica con facturación real, sin emitir nada,
 * para avisar del token vencido o del servicio cortado antes del primer cobro del día.
 */
@Injectable()
export class BillingHealthChecker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingHealthChecker.name);
  private timer?: NodeJS.Timeout;
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => void this.cycle(), STARTUP_DELAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private async cycle(): Promise<void> {
    await this.runAll(false);
    if (!this.enabled) return;
    this.timer = setTimeout(() => void this.cycle(), msUntilNextCheck());
    this.timer.unref();
  }

  /** Revisa todas las clínicas que tocan (force: sin el candado entre instancias). Devuelve cuántas revisó. */
  async runAll(force = true): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      const clinics = await this.prisma.billingSettings.findMany({
        where: {
          enabled: true,
          provider: { not: 'SIMULATED' },
          apiTokenEnc: { not: null },
        },
        select: { clinicId: true },
      });
      for (const { clinicId } of clinics) {
        // Con varias instancias de la API, solo una revisa cada clínica
        const claimed = await this.prisma.billingSettings.updateMany({
          where: {
            clinicId,
            ...(force
              ? {}
              : {
                  OR: [
                    { healthCheckedAt: null },
                    {
                      healthCheckedAt: {
                        lt: new Date(Date.now() - CLAIM_MINUTES * 60_000),
                      },
                    },
                  ],
                }),
          },
          data: { healthCheckedAt: new Date() },
        });
        if (!claimed.count) continue;
        try {
          await this.billing.checkHealth(clinicId);
          done++;
        } catch (error) {
          this.logger.error(
            `No se pudo revisar la facturación de la clínica ${clinicId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      this.running = false;
    }
    return done;
  }
}
