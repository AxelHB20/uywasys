import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { BillingHealthStore } from './billing-health.js';
import { BillingService } from './billing.service.js';

/** En producción (BILLING_ALLOW_SIMULATED=false) no se emite ni se activa la simulación */
function service(allow: boolean | undefined) {
  const env: Record<string, unknown> = { JWT_SECRET: 'x'.repeat(32) };
  if (allow !== undefined) env.BILLING_ALLOW_SIMULATED = allow;
  const prisma = {
    billingSettings: {
      findUnique: () =>
        Promise.resolve({
          enabled: true,
          provider: 'SIMULATED',
          production: false,
        }),
    },
  } as unknown as PrismaService;
  return new BillingService(
    prisma,
    {} as AuditService,
    {} as BillingHealthStore,
    new ConfigService(env),
  );
}

const actor = { id: 1, clinicId: 1, role: 'ADMIN' } as unknown as AuthUser;
const tx = {
  billingSettings: {
    findUnique: () => Promise.resolve({ enabled: true, provider: 'SIMULATED' }),
  },
  receipt: {
    findFirstOrThrow: () => Promise.reject(new Error('siguió de largo')),
  },
};

describe('facturación simulada según el servidor', () => {
  it('sin la variable (desarrollo, demo) la simulación está permitida', async () => {
    await expect(service(undefined).status(1)).resolves.toMatchObject({
      simulated: true,
      simulationAllowed: true,
    });
    // Pasa el control y sigue con la emisión (aquí la corta el doble de prueba)
    await expect(
      service(undefined).issueInTx(tx as never, actor, 1, 'BOLETA'),
    ).rejects.toThrow('siguió de largo');
  });

  it('en producción no emite un comprobante simulado', async () => {
    const s = service(false);
    await expect(s.status(1)).resolves.toMatchObject({
      simulationAllowed: false,
    });
    const error = await s
      .issueInTx(tx as never, actor, 1, 'BOLETA')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toContain('configura el PSE');
  });
});
