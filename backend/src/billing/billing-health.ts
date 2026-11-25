import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { providerErrorKind } from './billing.types.js';
import type { ProviderErrorKind } from './billing.types.js';

/** Estado de la conexión con el PSE */
export type BillingHealth = 'OK' | 'TOKEN' | 'SUSPENDED' | 'UNREACHABLE';

/** Revisiones seguidas sin respuesta antes de avisar (un corte breve no es alarma) */
export const UNREACHABLE_AFTER = 3;

/** Los errores que se arreglan del lado del PSE: al recuperarse, esos comprobantes salen solos */
export const RECOVERABLE_KINDS: ProviderErrorKind[] = [
  'auth',
  'suspended',
  'network',
];

const PROBLEM: BillingHealth[] = ['TOKEN', 'SUSPENDED', 'UNREACHABLE'];

/**
 * Guarda la salud de la conexión con el PSE a partir de la revisión periódica, de "Probar conexión",
 * de "Actualizar token" y de cada envío. Al volver a estar bien, reencola los comprobantes que
 * fallaron por el token, el corte o la red (nunca los rechazados ni los de datos mal).
 */
@Injectable()
export class BillingHealthStore {
  private readonly logger = new Logger(BillingHealthStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param source check = revisión (cuenta los fallos de red); send = envío real (solo cambia
   *   el estado si es claro: éxito, token o servicio cortado)
   */
  async record(
    clinicId: number,
    error: unknown,
    source: 'check' | 'send',
  ): Promise<void> {
    const current = await this.prisma.billingSettings.findUnique({
      where: { clinicId },
      select: { health: true, healthFailures: true, provider: true },
    });
    if (!current || current.provider === 'SIMULATED') return;
    const now = new Date();
    const checked = source === 'check' ? { healthCheckedAt: now } : {};
    // En la revisión, un error sin tipo es de configuración (falta el RUC, ruta mala…): no está bien.
    // En un envío, es del propio comprobante y prueba que el PSE aceptó el token.
    const raw = error === null ? null : providerErrorKind(error);
    const kind =
      error !== null && raw === null && source === 'check' ? 'auth' : raw;
    const message =
      error === null
        ? null
        : (error instanceof Error ? error.message : String(error)).slice(
            0,
            500,
          );

    if (error === null || kind === null) {
      if (
        current.health === 'OK' &&
        !current.healthFailures &&
        !checked.healthCheckedAt
      )
        return;
      await this.prisma.billingSettings.update({
        where: { clinicId },
        data: {
          health: 'OK',
          healthError: null,
          healthSince: null,
          healthFailures: 0,
          ...checked,
        },
      });
      if (PROBLEM.includes(current.health as BillingHealth))
        await this.resume(clinicId, RECOVERABLE_KINDS);
      // Lo que se quedó sin intentos por la red, aunque no llegó a ser "sin conexión"
      else if (source === 'check') await this.resume(clinicId, ['network']);
      return;
    }

    if (kind === 'network') {
      // Un envío que no llegó ya se reintenta solo; la alarma la decide la revisión
      if (source === 'send') return;
      const failures = current.healthFailures + 1;
      const unreachable = failures >= UNREACHABLE_AFTER;
      await this.prisma.billingSettings.update({
        where: { clinicId },
        data: {
          healthFailures: failures,
          ...checked,
          ...(unreachable && current.health !== 'UNREACHABLE'
            ? { health: 'UNREACHABLE', healthSince: now, healthError: message }
            : unreachable
              ? { healthError: message }
              : {}),
        },
      });
      return;
    }

    const health: BillingHealth = kind === 'auth' ? 'TOKEN' : 'SUSPENDED';
    await this.prisma.billingSettings.update({
      where: { clinicId },
      data: {
        health,
        healthError: message,
        healthFailures: 0,
        ...checked,
        ...(current.health !== health ? { healthSince: now } : {}),
      },
    });
    if (current.health !== health)
      this.logger.warn(
        `Clínica ${clinicId}: facturación detenida (${health}): ${message}`,
      );
  }

  /** Vuelve a poner en cola los comprobantes en error que fallaron por esas causas */
  private async resume(
    clinicId: number,
    kinds: ProviderErrorKind[],
  ): Promise<void> {
    const { count } = await this.prisma.electronicDocument.updateMany({
      where: {
        clinicId,
        status: 'ERROR',
        nextAttemptAt: null,
        errorKind: { in: kinds },
      },
      data: { nextAttemptAt: new Date(), lastError: null, errorKind: null },
    });
    if (count)
      this.logger.log(
        `Clínica ${clinicId}: ${count} comprobante(s) vuelven a la cola de envío`,
      );
  }
}
