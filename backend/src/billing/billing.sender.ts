import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { documentCode, ProviderError } from './billing.types.js';
import { BillingService } from './billing.service.js';
import { BillingHealthStore } from './billing-health.js';
import { providerErrorKind } from './billing.types.js';

/** Esperas entre reintentos (minutos). Tras el último, queda en ERROR para reintentar a mano. */
export const RETRY_MINUTES = [1, 5, 15, 30, 60, 180, 360, 720];
/** Cada cuánto se consulta un documento que el PSE recibió pero SUNAT aún no confirma */
const QUERY_MINUTES = 15;
/** Un envío "reservado" por un proceso: si se cae a la mitad, otro lo retoma después de esto */
const LEASE_MINUTES = 5;

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

/**
 * Cola de envío a SUNAT. Revisa cada cierto tiempo los comprobantes por enviar, con error o
 * esperando respuesta, y los procesa en orden (una nota de crédito nunca sale antes que su boleta).
 * Usa SKIP LOCKED: con varias instancias de la API, cada comprobante lo toma una sola.
 */
@Injectable()
export class BillingSender implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingSender.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly enabled: boolean;
  private readonly everySeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly health: BillingHealthStore,
    config: ConfigService,
  ) {
    // En las pruebas se llama a tick() a mano para controlar el momento
    this.enabled = config.get<string>('NODE_ENV') !== 'test';
    this.everySeconds = Number(config.get('BILLING_POLL_SECONDS') ?? 30) || 30;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), this.everySeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Después de un cobro: intenta enviar ya, sin esperar al siguiente ciclo ni bloquear la respuesta. */
  dispatch(): void {
    if (this.enabled) setImmediate(() => void this.tick());
  }

  /** Procesa lo que toca ahora. Devuelve cuántos comprobantes tomó. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimed = await this.prisma.$queryRaw<{ id: number }[]>`
        UPDATE electronic_documents SET next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES})
        WHERE id IN (
          SELECT id FROM electronic_documents
          WHERE status IN ('PENDING', 'ERROR', 'SENT') AND next_attempt_at <= now()
          ORDER BY id LIMIT 20
          FOR UPDATE SKIP LOCKED)
        RETURNING id`;
      const ids = claimed.map((r) => r.id).sort((a, b) => a - b);
      for (const id of ids) await this.process(id);
      return ids.length;
    } catch (error) {
      this.logger.error(
        'La cola de comprobantes falló',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async process(id: number): Promise<void> {
    const job = await this.billing.outgoing(id);
    const code = documentCode(job.doc.series, job.doc.number);

    if (job.doc.type === 'CREDIT_NOTE') {
      if (job.relatedStatus === 'REJECTED') {
        await this.prisma.electronicDocument.update({
          where: { id },
          data: {
            status: 'ERROR',
            nextAttemptAt: null,
            lastError: 'SUNAT rechazó el comprobante que esta nota anula',
          },
        });
        return;
      }
      // Primero tiene que llegar el comprobante original
      if (job.relatedStatus === 'PENDING' || job.relatedStatus === 'ERROR') {
        await this.prisma.electronicDocument.update({
          where: { id },
          data: { nextAttemptAt: minutes(1) },
        });
        return;
      }
    }

    const provider = this.billing.providers[job.provider];
    const attempts = job.attempts + 1;
    try {
      const outcome =
        job.status === 'SENT'
          ? await provider.query(job.doc, job.config)
          : await provider.send(job.doc, job.config);
      await this.prisma.electronicDocument.update({
        where: { id },
        data: {
          status: outcome.status,
          attempts,
          lastError: null,
          errorKind: null,
          sunatDescription: outcome.description ?? null,
          hash: outcome.hash ?? undefined,
          qrText: outcome.qrText ?? undefined,
          pdfUrl: outcome.pdfUrl ?? undefined,
          xmlUrl: outcome.xmlUrl ?? undefined,
          cdrUrl: outcome.cdrUrl ?? undefined,
          sentAt: job.status === 'SENT' ? undefined : new Date(),
          acceptedAt: outcome.status === 'ACCEPTED' ? new Date() : undefined,
          nextAttemptAt:
            outcome.status === 'SENT' ? minutes(QUERY_MINUTES) : null,
        },
      });
      // El PSE respondió: la conexión está bien (si estaba caída, se reanuda la cola)
      await this.recordHealth(job.clinicId, job.provider, null);
      if (outcome.status === 'REJECTED')
        this.logger.warn(
          `SUNAT rechazó ${code}: ${outcome.description ?? 'sin detalle'}`,
        );
    } catch (error) {
      const retryable = !(error instanceof ProviderError) || error.retryable;
      const wait = RETRY_MINUTES[attempts - 1];
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      await this.prisma.electronicDocument.update({
        where: { id },
        data: {
          // Si ya estaba en el PSE, sigue "enviado": solo falló la consulta
          status: job.status === 'SENT' ? 'SENT' : 'ERROR',
          attempts,
          lastError: message,
          errorKind: providerErrorKind(error),
          nextAttemptAt: retryable && wait ? minutes(wait) : null,
        },
      });
      await this.recordHealth(job.clinicId, job.provider, error);
      this.logger.warn(
        `No se pudo enviar ${code} (intento ${attempts}): ${message}`,
      );
    }
  }

  /** Nunca deja que un fallo al guardar la salud corte la cola */
  private async recordHealth(
    clinicId: number,
    provider: string,
    error: unknown,
  ): Promise<void> {
    if (provider === 'SIMULATED') return;
    try {
      await this.health.record(clinicId, error, 'send');
    } catch (e) {
      this.logger.error(
        'No se pudo guardar el estado de la facturación',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}
