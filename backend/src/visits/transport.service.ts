import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { lineAmounts } from '../common/money/igv.js';
import { Prisma } from '../generated/prisma/client.js';
import type { GroomingTransport } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHARGE_SELECT, toChargeView } from './visit.views.js';
import type { ChargeView } from './visit.views.js';

type Tx = Prisma.TransactionClient;

export const TRANSPORT_KEY = 'TRANSPORT';
/** Tope para evitar un cero de más al escribir (S/ 1200 en vez de 12.00) */
export const TRANSPORT_MAX_PRICE = 500;

export const TRANSPORT_TEXT: Record<
  Exclude<GroomingTransport, 'NONE'>,
  string
> = {
  PICKUP: 'Recojo',
  DROPOFF: 'Entrega',
  ROUND_TRIP: 'Recojo y entrega',
};

/** Entrega en casa al terminar (lo llevamos / recojo y entrega) */
export function deliversHome(transport: GroomingTransport) {
  return transport === 'DROPOFF' || transport === 'ROUND_TRIP';
}

export interface TransportTarget {
  clientId: number;
  petId: number | null;
  visitId: number | null;
  transport: GroomingTransport;
  /** Con IGV; null o 0 = sin cobro */
  price: number | null | undefined;
  /** Cargo que ya tenía (al cambiar la movilidad de la cola) */
  chargeId?: number | null;
}

/**
 * Movilidad (recojo y entrega a domicilio): un servicio interno de la clínica cuyo precio pone
 * recepción en cada caso. Sale como una línea más de la cuenta, con IGV, en el mismo comprobante.
 */
@Injectable()
export class TransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** El servicio interno "Movilidad" de la clínica; se crea la primera vez */
  async serviceId(tx: Tx, clinicId: number): Promise<number> {
    const found = await tx.careService.findUnique({
      where: { clinicId_systemKey: { clinicId, systemKey: TRANSPORT_KEY } },
      select: { id: true },
    });
    if (found) return found.id;
    // Si la clínica ya tenía un servicio propio llamado "Movilidad", el interno lleva otro nombre
    const taken = await tx.careService.findFirst({
      where: { clinicId, name: 'Movilidad' },
      select: { id: true },
    });
    const row = await tx.careService.upsert({
      where: { clinicId_systemKey: { clinicId, systemKey: TRANSPORT_KEY } },
      create: {
        clinicId,
        systemKey: TRANSPORT_KEY,
        name: taken ? 'Movilidad a domicilio' : 'Movilidad',
        category: 'OTHER',
        price: 0,
        igv: 'TAXED',
      },
      update: {},
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Deja el cargo de movilidad como debe quedar: lo crea, le cambia el precio o lo quita.
   * Devuelve el id del cargo vigente (null si no hay cobro).
   */
  async syncInTx(
    tx: Tx,
    actor: AuthUser,
    target: TransportTarget,
  ): Promise<number | null> {
    const price = checkPrice(target.price);
    const charged = target.transport !== 'NONE' && price > 0;
    const current = target.chargeId
      ? await this.lockCharge(tx, actor.clinicId, target.chargeId)
      : null;
    const live = current && current.status !== 'VOID' ? current : null;

    if (live && Number(live.paid_amount) > 0) {
      const same =
        charged &&
        Number(live.unit_price) === price &&
        live.description === description(target.transport);
      if (same) return live.id;
      throw new ConflictException(
        'La movilidad ya se cobró: corrígela con una nota de crédito en Comprobantes',
      );
    }
    if (!charged) {
      if (live) await this.voidRow(tx, actor, live.id, 'Sin movilidad');
      return null;
    }
    if (live) {
      await this.reprice(tx, live.id, price, description(target.transport));
      return live.id;
    }
    const serviceId = await this.serviceId(tx, actor.clinicId);
    const amounts = lineAmounts({
      quantity: 1,
      unitPrice: price,
      affectation: 'TAXED',
    });
    const row = await tx.charge.create({
      data: {
        clinicId: actor.clinicId,
        clientId: target.clientId,
        visitId: target.visitId,
        petId: target.petId,
        kind: 'SERVICE',
        careServiceId: serviceId,
        description: description(target.transport),
        quantity: 1,
        unitPrice: price,
        igvAffectation: 'TAXED',
        igvRate: amounts.rate,
        sunatUnit: 'ZZ',
        taxableAmount: amounts.taxable,
        igvAmount: amounts.igv,
        total: amounts.total,
        createdById: actor.id,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Caja: cambia el precio de la movilidad mientras no se haya cobrado nada */
  async changePrice(
    actor: AuthUser,
    chargeId: number,
    price: number,
    ip?: string,
  ): Promise<ChargeView> {
    const value = checkPrice(price);
    if (value <= 0)
      throw new BadRequestException(
        'Escribe el precio; si va sin cobro, quita la línea',
      );
    const before = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCharge(tx, actor.clinicId, chargeId);
      if (!row) throw new NotFoundException('El cargo no existe');
      if (!row.transport)
        throw new BadRequestException(
          'Solo se cambia el precio de la movilidad',
        );
      if (row.status !== 'PENDING' || Number(row.paid_amount) > 0)
        throw new ConflictException(
          'La movilidad ya se cobró: corrígela con una nota de crédito en Comprobantes',
        );
      await this.reprice(tx, chargeId, value, row.description);
      await this.syncCopies(tx, chargeId, value);
      return Number(row.unit_price);
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'charge.transport_price',
      entity: 'charge',
      entityId: chargeId,
      ip,
      data: { before, after: value },
    });
    const row = await this.prisma.charge.findUniqueOrThrow({
      where: { id: chargeId },
      select: CHARGE_SELECT,
    });
    return toChargeView(row);
  }

  /** Último precio de movilidad que pagó el cliente (para proponerlo) */
  async lastPrice(clinicId: number, clientId: number): Promise<number | null> {
    const row = await this.prisma.charge.findFirst({
      where: {
        clinicId,
        clientId,
        status: { not: 'VOID' },
        careService: { systemKey: TRANSPORT_KEY },
      },
      orderBy: { id: 'desc' },
      select: { unitPrice: true },
    });
    return row ? Number(row.unitPrice) : null;
  }

  /** Quita la movilidad (grooming o consulta cancelados) */
  async voidRow(tx: Tx, actor: AuthUser, chargeId: number, reason: string) {
    await tx.charge.updateMany({
      where: { id: chargeId, clinicId: actor.clinicId, status: 'PENDING' },
      data: {
        status: 'VOID',
        voidedAt: new Date(),
        voidedById: actor.id,
        voidReason: reason.slice(0, 200),
      },
    });
  }

  private async lockCharge(tx: Tx, clinicId: number, id: number) {
    const [row] = await tx.$queryRaw<
      {
        id: number;
        status: string;
        paid_amount: Prisma.Decimal;
        unit_price: Prisma.Decimal;
        description: string;
        transport: boolean;
      }[]
    >`SELECT c.id, c.status::text AS status, c.paid_amount, c.unit_price, c.description,
             (s.system_key = ${TRANSPORT_KEY}) IS TRUE AS transport
        FROM charges c LEFT JOIN care_services s ON s.id = c.care_service_id
       WHERE c.id = ${id} AND c.clinic_id = ${clinicId} FOR UPDATE OF c`;
    return row ?? null;
  }

  private async reprice(tx: Tx, id: number, price: number, text: string) {
    const amounts = lineAmounts({
      quantity: 1,
      unitPrice: price,
      affectation: 'TAXED',
    });
    await tx.charge.update({
      where: { id },
      data: {
        description: text,
        unitPrice: price,
        discount: 0,
        discountReason: null,
        taxableAmount: amounts.taxable,
        igvAmount: amounts.igv,
        total: amounts.total,
      },
    });
  }

  /** La cola y la cita guardan el precio para mostrarlo; se mantiene igual al del cargo */
  private async syncCopies(tx: Tx, chargeId: number, price: number) {
    await tx.queueEntry.updateMany({
      where: { transportChargeId: chargeId },
      data: { transportPrice: price },
    });
  }
}

function description(transport: GroomingTransport) {
  return transport === 'NONE'
    ? 'Movilidad'
    : `Movilidad · ${TRANSPORT_TEXT[transport]}`;
}

function checkPrice(price: number | null | undefined): number {
  const value = price ?? 0;
  if (!Number.isFinite(value) || value < 0)
    throw new BadRequestException('El precio de la movilidad no es válido');
  if (value > TRANSPORT_MAX_PRICE)
    throw new BadRequestException(
      `La movilidad no puede pasar de S/ ${TRANSPORT_MAX_PRICE}: revisa el monto`,
    );
  return Math.round(value * 100) / 100;
}
