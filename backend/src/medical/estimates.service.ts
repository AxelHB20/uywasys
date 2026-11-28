import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clinicLogoUrl } from '../auth/session-user.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { discountPercent, lineAmounts } from '../common/money/igv.js';
import { discountCapMessage } from '../visits/discount-cap.js';
import {
  estimateCode,
  reserveNumbers,
} from '../common/sequence/clinic-sequence.js';
import {
  clinicDay,
  fromDbDate,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  EstimateStatus,
  IgvAffectation,
  Species,
} from '../generated/prisma/enums.js';
import { addDays } from '../inventory/expiry.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChargesService } from '../visits/charges.service.js';
import { lockVisit } from '../visits/visit.views.js';
import type {
  ConvertEstimateDto,
  CreateEstimateDto,
  DecideEstimateDto,
  ListEstimatesQuery,
} from './dto/estimate.dto.js';

const SELECT = {
  id: true,
  number: true,
  title: true,
  validUntil: true,
  notes: true,
  status: true,
  total: true,
  createdAt: true,
  decidedAt: true,
  decisionNote: true,
  visitId: true,
  convertedAt: true,
  pet: {
    select: {
      id: true,
      number: true,
      name: true,
      species: true,
      breed: true,
      weightKg: true,
    },
  },
  client: {
    select: {
      id: true,
      name: true,
      phone: true,
      docType: true,
      docNumber: true,
    },
  },
  createdBy: { select: { id: true, fullName: true, licenseNumber: true } },
  decidedBy: { select: { id: true, fullName: true } },
  items: {
    select: {
      id: true,
      careServiceId: true,
      productId: true,
      presentationId: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discount: true,
      total: true,
      igvAffectation: true,
      controlled: true,
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.EstimateSelect;

type Row = Prisma.EstimateGetPayload<{ select: typeof SELECT }>;

/** Lo que ve la pantalla: PENDING vencido se muestra como EXPIRED */
export type EstimateViewStatus = EstimateStatus | 'EXPIRED';

export interface EstimateView {
  id: number;
  /** PR-00012 */
  code: string;
  title: string;
  /** AAAA-MM-DD */
  validUntil: string;
  notes: string | null;
  status: EstimateViewStatus;
  total: number;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
  visitId: number | null;
  convertedAt: Date | null;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    weightKg: number | null;
  };
  client: {
    id: number;
    name: string;
    phone: string;
    docType: string | null;
    docNumber: string | null;
  };
  createdBy: { id: number; fullName: string; licenseNumber: string | null };
  decidedBy: { id: number; fullName: string } | null;
  items: {
    id: number;
    careServiceId: number | null;
    productId: number | null;
    presentationId: number | null;
    description: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
    igvAffectation: IgvAffectation;
    controlled: boolean;
  }[];
  /** Op. gravada e IGV del total (precios con IGV) */
  taxable: number;
  igv: number;
}

export interface EstimatePrint extends EstimateView {
  clinic: {
    name: string;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
}

/** Indicadores de la bandeja de presupuestos. */
export interface EstimatesSummary {
  /** Por responder y vigentes */
  pending: { count: number; amount: number };
  /** Por responder que vencen en los próximos 3 días (incluye hoy) */
  expiringSoon: number;
  /** Aceptados que falta cargar a la atención */
  accepted: { count: number; amount: number };
  /** Cargados a una atención en el mes en curso */
  convertedMonth: { count: number; amount: number };
  /** Últimos 90 días: aceptados (o cargados) sobre los ya respondidos o vencidos */
  acceptance: { won: number; decided: number; rate: number | null };
}

/**
 * Presupuestos: servicios y productos del catálogo con su precio y descuento. El dueño los
 * acepta (o no) y, aceptados, se cargan a una atención con el precio presupuestado.
 */
@Injectable()
export class EstimatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargesService,
    private readonly audit: AuditService,
  ) {}

  async list(
    clinicId: number,
    query: ListEstimatesQuery,
  ): Promise<EstimateView[]> {
    const today = await clinicToday(this.prisma, clinicId);
    const where: Prisma.EstimateWhereInput = { clinicId };
    if (query.status === 'OPEN') where.status = { in: ['PENDING', 'ACCEPTED'] };
    else if (query.status) where.status = query.status;
    if (query.petId) where.petId = query.petId;
    if (query.clientId) where.clientId = query.clientId;
    const rows = await this.prisma.estimate.findMany({
      where,
      select: SELECT,
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((r) => toView(r, today));
  }

  async summary(clinicId: number): Promise<EstimatesSummary> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const today = clinicDay(timezone);
    const todayDb = toDbDate(today);
    const monthStart = startOfDayIn(timezone, `${today.slice(0, 8)}01`);
    const since = startOfDayIn(timezone, addDays(today, -90));
    const amount = (n: Prisma.Decimal | null) => Number(n ?? 0);
    const [pending, soon, accepted, converted, recent, recentExpired] =
      await Promise.all([
        this.prisma.estimate.aggregate({
          where: { clinicId, status: 'PENDING', validUntil: { gte: todayDb } },
          _count: true,
          _sum: { total: true },
        }),
        this.prisma.estimate.count({
          where: {
            clinicId,
            status: 'PENDING',
            validUntil: { gte: todayDb, lte: toDbDate(addDays(today, 3)) },
          },
        }),
        this.prisma.estimate.aggregate({
          where: { clinicId, status: 'ACCEPTED' },
          _count: true,
          _sum: { total: true },
        }),
        this.prisma.estimate.aggregate({
          where: {
            clinicId,
            status: 'CONVERTED',
            convertedAt: { gte: monthStart },
          },
          _count: true,
          _sum: { total: true },
        }),
        this.prisma.estimate.groupBy({
          by: ['status'],
          where: { clinicId, createdAt: { gte: since } },
          _count: true,
        }),
        this.prisma.estimate.count({
          where: {
            clinicId,
            createdAt: { gte: since },
            status: 'PENDING',
            validUntil: { lt: todayDb },
          },
        }),
      ]);
    const byStatus = (status: EstimateStatus) =>
      recent.find((r) => r.status === status)?._count ?? 0;
    const won = byStatus('ACCEPTED') + byStatus('CONVERTED');
    const decided = won + byStatus('REJECTED') + recentExpired;
    return {
      pending: { count: pending._count, amount: amount(pending._sum.total) },
      expiringSoon: soon,
      accepted: {
        count: accepted._count,
        amount: amount(accepted._sum.total),
      },
      convertedMonth: {
        count: converted._count,
        amount: amount(converted._sum.total),
      },
      acceptance: {
        won,
        decided,
        rate: decided ? Math.round((won / decided) * 1000) / 10 : null,
      },
    };
  }

  async get(clinicId: number, id: number): Promise<EstimatePrint> {
    const today = await clinicToday(this.prisma, clinicId);
    const row = await this.prisma.estimate.findFirst({
      where: { id, clinicId },
      select: {
        ...SELECT,
        clinic: {
          select: {
            name: true,
            ruc: true,
            address: true,
            phone: true,
            logoMime: true,
            logoUpdatedAt: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('El presupuesto no existe');
    const { clinic, ...rest } = row;
    return {
      ...toView(rest, today),
      clinic: {
        name: clinic.name,
        ruc: clinic.ruc,
        address: clinic.address,
        phone: clinic.phone,
        logoUrl: clinicLogoUrl(clinic),
      },
    };
  }

  async create(
    actor: AuthUser,
    dto: CreateEstimateDto,
    ip?: string,
  ): Promise<EstimatePrint> {
    const pet = await this.prisma.pet.findFirst({
      where: { id: dto.petId, clinicId: actor.clinicId },
      select: { clientId: true, active: true, deceasedAt: true, name: true },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    if (!pet.active || pet.deceasedAt)
      throw new BadRequestException(`${pet.name} no está activa`);
    const prep = await this.charges.prepare(actor);

    const id = await this.prisma.$transaction(async (tx) => {
      const lines = await this.charges.resolveItems(
        tx,
        actor.clinicId,
        dto.items,
      );
      let total = new Prisma.Decimal(0);
      const items = lines.map((line, position) => {
        const item = dto.items[position];
        const amounts = lineAmounts({
          quantity: item.quantity,
          unitPrice: line.unitPrice,
          discount: item.discount ?? 0,
          affectation: line.igv,
        });
        if (
          amounts.discount.gt(0) &&
          actor.role !== 'ADMIN' &&
          discountPercent(amounts.gross, amounts.discount).gt(
            prep.maxDiscountPercent,
          )
        )
          throw new ForbiddenException(
            discountCapMessage(
              line.description,
              amounts.gross,
              prep.maxDiscountPercent,
            ),
          );
        total = total.plus(amounts.total);
        return {
          position,
          careServiceId: item.careServiceId ?? null,
          productId: item.productId ?? null,
          presentationId: item.presentationId ?? null,
          description: line.description,
          quantity: item.quantity,
          unitPrice: line.unitPrice,
          discount: amounts.discount,
          total: amounts.total,
          igvAffectation: line.igv,
          controlled:
            line.kind === 'PRODUCT'
              ? line.product.controlled
              : line.service.supplies.some((s) => s.product.controlled),
        };
      });
      const number = await reserveNumbers(tx, actor.clinicId, 'estimate');
      const row = await tx.estimate.create({
        data: {
          clinicId: actor.clinicId,
          number,
          clientId: pet.clientId,
          petId: dto.petId,
          title: dto.title,
          validUntil: toDbDate(addDays(prep.today, dto.validDays)),
          notes: dto.notes ?? null,
          total,
          createdById: actor.id,
          items: { create: items },
        },
        select: { id: true },
      });
      return row.id;
    });

    await this.log(actor, 'estimate.create', id, ip, { petId: dto.petId });
    return this.get(actor.clinicId, id);
  }

  async accept(
    actor: AuthUser,
    id: number,
    dto: DecideEstimateDto,
    ip?: string,
  ): Promise<EstimatePrint> {
    const current = await this.find(actor.clinicId, id);
    const today = await clinicToday(this.prisma, actor.clinicId);
    if (current.status !== 'PENDING')
      throw new ConflictException('El presupuesto ya tiene respuesta');
    if (fromDbDate(current.validUntil)! < today)
      throw new ConflictException(
        'El presupuesto venció: emite uno nuevo con los precios de hoy',
      );
    await this.decide(actor, id, 'ACCEPTED', dto.note ?? null);
    await this.log(actor, 'estimate.accept', id, ip, {
      note: dto.note ?? null,
    });
    return this.get(actor.clinicId, id);
  }

  async reject(
    actor: AuthUser,
    id: number,
    dto: DecideEstimateDto,
    ip?: string,
  ): Promise<EstimatePrint> {
    const current = await this.find(actor.clinicId, id);
    if (current.status !== 'PENDING' && current.status !== 'ACCEPTED')
      throw new ConflictException('Este presupuesto ya se cerró');
    await this.decide(actor, id, 'REJECTED', dto.note ?? null);
    await this.log(actor, 'estimate.reject', id, ip, {
      note: dto.note ?? null,
    });
    return this.get(actor.clinicId, id);
  }

  /**
   * Carga las líneas a una atención abierta de la mascota. Se respeta el precio del
   * presupuesto: si hoy el catálogo cuesta más, la diferencia entra como descuento
   * ("Presupuesto PR-00012"), ya autorizado al emitirlo.
   */
  async convert(
    actor: AuthUser,
    id: number,
    dto: ConvertEstimateDto,
    ip?: string,
  ): Promise<EstimatePrint> {
    const prep = await this.charges.prepare(actor);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<
          { status: EstimateStatus; pet_id: number; number: number }[]
        >`SELECT status::text AS status, pet_id, number FROM estimates
          WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
        if (!locked) throw new NotFoundException('El presupuesto no existe');
        if (locked.status !== 'ACCEPTED')
          throw new ConflictException(
            locked.status === 'CONVERTED'
              ? 'Este presupuesto ya se cargó a una atención'
              : 'Primero registra que el dueño aceptó el presupuesto',
          );
        const visit = await lockVisit(tx, actor.clinicId, dto.visitId);
        if (!visit) throw new NotFoundException('La atención no existe');
        if (visit.status !== 'OPEN')
          throw new ConflictException('La atención ya se cerró');
        if (visit.pet_id !== locked.pet_id)
          throw new BadRequestException('La atención es de otra mascota');

        const items = await tx.estimateItem.findMany({
          where: { estimateId: id },
          orderBy: { position: 'asc' },
        });
        const code = estimateCode(locked.number);
        const lines = await this.charges.resolveItems(
          tx,
          actor.clinicId,
          items.map((i) => ({
            careServiceId: i.careServiceId ?? undefined,
            productId: i.productId ?? undefined,
            presentationId: i.presentationId ?? undefined,
            quantity: Number(i.quantity),
          })),
          null,
          // Lo cotizado se cobra aunque luego se haya desactivado
          { allowInactive: true },
        );
        const result = await this.charges.createInTx(
          tx,
          actor,
          {
            visitId: dto.visitId,
            items: items.map((item, index) => {
              const gross = new Prisma.Decimal(lines[index].unitPrice)
                .times(item.quantity)
                .toDecimalPlaces(2);
              const discount = Prisma.Decimal.max(0, gross.minus(item.total));
              return {
                careServiceId: item.careServiceId ?? undefined,
                productId: item.productId ?? undefined,
                presentationId: item.presentationId ?? undefined,
                quantity: Number(item.quantity),
                discount: discount.toNumber(),
                discountReason: discount.gt(0) ? `Presupuesto ${code}` : null,
                prescriptionRef: item.controlled
                  ? (dto.prescriptionRef ?? null)
                  : null,
              };
            }),
          },
          // El descuento ya se autorizó al emitir el presupuesto
          {
            ...prep,
            maxDiscountPercent: new Prisma.Decimal(100),
            allowInactive: true,
          },
        );
        await tx.estimate.update({
          where: { id },
          data: {
            status: 'CONVERTED',
            visitId: dto.visitId,
            convertedAt: new Date(),
            convertedById: actor.id,
          },
        });
        return result;
      },
      { timeout: 20_000 },
    );
    await this.charges.logCreated(actor, dto.visitId, created, ip);
    await this.log(actor, 'estimate.convert', id, ip, {
      visitId: dto.visitId,
      charges: created.charges.map((c) => c.id),
    });
    return this.get(actor.clinicId, id);
  }

  private async find(clinicId: number, id: number) {
    const row = await this.prisma.estimate.findFirst({
      where: { id, clinicId },
      select: { status: true, validUntil: true },
    });
    if (!row) throw new NotFoundException('El presupuesto no existe');
    return row;
  }

  private decide(
    actor: AuthUser,
    id: number,
    status: EstimateStatus,
    note: string | null,
  ) {
    return this.prisma.estimate.update({
      where: { id },
      data: {
        status,
        decidedAt: new Date(),
        decidedById: actor.id,
        decisionNote: note,
      },
    });
  }

  private log(
    actor: AuthUser,
    action: string,
    id: number,
    ip?: string,
    data?: Prisma.InputJsonObject,
  ) {
    return this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action,
      entity: 'estimate',
      entityId: id,
      ip,
      data,
    });
  }
}

function toView(row: Row, today: string): EstimateView {
  const validUntil = fromDbDate(row.validUntil)!;
  let taxable = new Prisma.Decimal(0);
  let igv = new Prisma.Decimal(0);
  for (const item of row.items) {
    const a = lineAmounts({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      affectation: item.igvAffectation,
    });
    taxable = taxable.plus(a.taxable);
    igv = igv.plus(a.igv);
  }
  return {
    ...row,
    code: estimateCode(row.number),
    validUntil,
    status:
      row.status === 'PENDING' && validUntil < today ? 'EXPIRED' : row.status,
    total: Number(row.total),
    pet: {
      ...row.pet,
      weightKg: row.pet.weightKg === null ? null : Number(row.pet.weightKg),
    },
    items: row.items.map((i) => ({
      ...i,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      discount: Number(i.discount),
      total: Number(i.total),
    })),
    taxable: taxable.toNumber(),
    igv: igv.toNumber(),
  };
}
