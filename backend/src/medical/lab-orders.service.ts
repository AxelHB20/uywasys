import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { labCode, reserveNumbers } from '../common/sequence/clinic-sequence.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  LabDestination,
  LabOrderStatus,
  PetSex,
  Species,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChargesService } from '../visits/charges.service.js';
import { AttachmentsService } from './attachments.service.js';
import { normalizeSearch } from '../common/text/search.js';
import { LAB_OVERDUE_DAYS } from './lab.constants.js';
import type { UploadedAttachment } from './attachments.service.js';
import type {
  CreateLabOrderDto,
  LabFilter,
  ListLabOrdersQuery,
} from './dto/lab-order.dto.js';

const DAY_MS = 86_400_000;

export interface LabOrderView {
  id: number;
  code: string;
  status: LabOrderStatus;
  destination: LabDestination;
  externalLab: string | null;
  labCost: number | null;
  indication: string | null;
  visitId: number;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    sex: PetSex | null;
    birthDate: Date | null;
    weightKg: number | null;
  };
  client: { id: number; name: string; phone: string };
  items: {
    id: number;
    name: string;
    careServiceId: number;
    charged: boolean;
  }[];
  /** Lo que se cobró al cliente por estos exámenes */
  total: number;
  /** Lo ya pagado en caja: al cancelar, eso no se quita de la cuenta */
  paid: number;
  requestedAt: Date;
  requestedBy: string;
  sampleAt: Date | null;
  sampleBy: string | null;
  resultAt: Date | null;
  resultBy: string | null;
  resultText: string | null;
  attachment: { id: number; fileName: string; mime: string } | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  interpretation: string | null;
  notifiedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  /** Días esperando resultado (solo pedidos sin resultado) */
  waitingDays: number | null;
  overdue: boolean;
}

/** Una página de la pantalla Exámenes con los números de cada pestaña */
export interface LabOrderPage {
  items: LabOrderView[];
  hasMore: boolean;
  counts: {
    pending: number;
    ready: number;
    reviewed: number;
    /** Sin resultado hace 3 días o más */
    overdue: number;
    /** Revisados sin avisar al dueño */
    toNotify: number;
  };
}

const SELECT = {
  id: true,
  number: true,
  status: true,
  destination: true,
  externalLab: true,
  labCost: true,
  indication: true,
  visitId: true,
  requestedAt: true,
  requestedBy: { select: { fullName: true } },
  sampleAt: true,
  sampleById: true,
  resultAt: true,
  resultById: true,
  resultText: true,
  attachment: {
    select: { id: true, fileName: true, mime: true, voidedAt: true },
  },
  reviewedAt: true,
  reviewedById: true,
  interpretation: true,
  notifiedAt: true,
  cancelledAt: true,
  cancelledById: true,
  cancelReason: true,
  pet: {
    select: {
      id: true,
      number: true,
      name: true,
      species: true,
      breed: true,
      sex: true,
      birthDate: true,
      weightKg: true,
    },
  },
  client: { select: { id: true, name: true, phone: true } },
  items: {
    orderBy: { id: 'asc' },
    select: { id: true, name: true, careServiceId: true, chargeId: true },
  },
} satisfies Prisma.LabOrderSelect;

type Row = Prisma.LabOrderGetPayload<{ select: typeof SELECT }>;

const STATUS_FILTER: Record<LabFilter, Prisma.LabOrderWhereInput> = {
  pending: { status: { in: ['REQUESTED', 'SAMPLE_TAKEN'] } },
  ready: { status: 'RESULT_READY' },
  reviewed: { status: 'REVIEWED' },
  cancelled: { status: 'CANCELLED' },
  all: {},
};

/**
 * Orden de cada pestaña: lo que más espera primero (los demorados salen arriba); en revisados,
 * primero los que falta avisar al dueño y luego lo último.
 */
const ORDER: Record<LabFilter, Prisma.LabOrderOrderByWithRelationInput[]> = {
  pending: [{ requestedAt: 'asc' }, { id: 'asc' }],
  ready: [{ resultAt: 'asc' }, { id: 'asc' }],
  reviewed: [
    { notifiedAt: { sort: 'desc', nulls: 'first' } },
    { reviewedAt: 'desc' },
    { id: 'desc' },
  ],
  cancelled: [{ cancelledAt: 'desc' }, { id: 'desc' }],
  all: [{ requestedAt: 'desc' }, { id: 'desc' }],
};

/**
 * Exámenes de laboratorio. Se piden dentro de una atención abierta (los cargos van a la cuenta
 * del cliente), se marca la muestra, se sube el resultado y el veterinario lo revisa e interpreta.
 * Al dueño se le avisa solo con el resultado revisado.
 */
@Injectable()
export class LabOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargesService,
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    clinicId: number,
    query: ListLabOrdersQuery,
    now = new Date(),
  ): Promise<LabOrderPage> {
    const base: Prisma.LabOrderWhereInput = {
      clinicId,
      ...(query.petId ? { petId: query.petId } : {}),
      ...(query.destination ? { destination: query.destination } : {}),
      ...this.searchWhere(clinicId, query.q),
    };
    const status = query.status ?? 'all';
    const take = query.take ?? 50;
    const overdueSince = new Date(now.getTime() - LAB_OVERDUE_DAYS * DAY_MS);
    const [rows, byStatus, overdue, toNotify] = await this.prisma.$transaction([
      this.prisma.labOrder.findMany({
        where: { ...base, ...STATUS_FILTER[status] },
        select: SELECT,
        orderBy: ORDER[status],
        skip: query.skip ?? 0,
        take: take + 1,
      }),
      this.prisma.labOrder.groupBy({
        by: ['status'],
        where: base,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.labOrder.count({
        where: {
          ...base,
          ...STATUS_FILTER.pending,
          requestedAt: { lte: overdueSince },
        },
      }),
      this.prisma.labOrder.count({
        where: { ...base, status: 'REVIEWED', notifiedAt: null },
      }),
    ]);
    const n = (s: LabOrderStatus) => {
      const g = byStatus.find((b) => b.status === s)?._count;
      return typeof g === 'object' && g ? (g._all ?? 0) : 0;
    };
    return {
      items: await this.views(rows.slice(0, take), now),
      hasMore: rows.length > take,
      counts: {
        pending: n('REQUESTED') + n('SAMPLE_TAKEN'),
        ready: n('RESULT_READY'),
        reviewed: n('REVIEWED'),
        overdue,
        toNotify,
      },
    };
  }

  /** "EX-12" busca el pedido; el resto, por mascota o dueño (nombre, DNI o celular) */
  private searchWhere(
    clinicId: number,
    q: string | undefined,
  ): Prisma.LabOrderWhereInput {
    const code = /^ex[-\s]?0*(\d{1,9})$/i.exec(q?.trim() ?? '');
    if (code) return { number: Number(code[1]) };
    const term = normalizeSearch(q ?? '');
    if (!term) return {};
    return {
      OR: [
        { pet: { clinicId, nameSearch: { contains: term } } },
        { client: { clinicId, searchText: { contains: term } } },
      ],
    };
  }

  async forVisit(clinicId: number, visitId: number): Promise<LabOrderView[]> {
    const rows = await this.prisma.labOrder.findMany({
      where: { clinicId, visitId },
      select: SELECT,
      orderBy: { id: 'desc' },
    });
    return this.views(rows);
  }

  async create(
    actor: AuthUser,
    visitId: number,
    dto: CreateLabOrderDto,
    ip?: string,
  ): Promise<LabOrderView> {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, clinicId: actor.clinicId },
      select: { status: true, petId: true, clientId: true },
    });
    if (!visit) throw new NotFoundException('La atención no existe');
    if (visit.status !== 'OPEN')
      throw new ConflictException(
        'La atención ya está cerrada: los exámenes se piden en una atención abierta',
      );
    const ids = [...new Set(dto.careServiceIds)];
    const services = await this.prisma.careService.findMany({
      where: { id: { in: ids }, clinicId: actor.clinicId },
      select: { id: true, name: true, category: true, active: true },
    });
    if (services.length !== ids.length)
      throw new NotFoundException('Uno de los exámenes no existe');
    const notLab = services.find((s) => s.category !== 'LAB' || !s.active);
    if (notLab)
      throw new BadRequestException(
        `«${notLab.name}» no es un examen activo: créalo en Servicios y precios con la categoría Laboratorio`,
      );
    const ordered = ids.map((id) => services.find((s) => s.id === id)!);
    const prep = dto.charge ? await this.charges.prepare(actor) : null;

    const id = await this.prisma.$transaction(
      async (tx) => {
        const chargeIds: (number | null)[] = ordered.map(() => null);
        if (prep) {
          const created = await this.charges.createInTx(
            tx,
            actor,
            {
              visitId,
              items: ordered.map((s) => ({ careServiceId: s.id, quantity: 1 })),
            },
            prep,
          );
          // Un cargo por examen, en el mismo orden
          created.charges.forEach((c) => {
            const i = ordered.findIndex(
              (s, idx) => s.id === c.careServiceId && chargeIds[idx] === null,
            );
            if (i >= 0) chargeIds[i] = c.id;
          });
        }
        const number = await reserveNumbers(tx, actor.clinicId, 'lab');
        const order = await tx.labOrder.create({
          data: {
            clinicId: actor.clinicId,
            number,
            visitId,
            petId: visit.petId,
            clientId: visit.clientId,
            destination: dto.destination,
            externalLab:
              dto.destination === 'EXTERNAL' ? (dto.externalLab ?? null) : null,
            labCost:
              dto.destination === 'EXTERNAL' && dto.labCost != null
                ? new Prisma.Decimal(dto.labCost)
                : null,
            indication: dto.indication ?? null,
            requestedById: actor.id,
            items: {
              create: ordered.map((s, i) => ({
                careServiceId: s.id,
                name: s.name,
                chargeId: chargeIds[i],
              })),
            },
          },
          select: { id: true },
        });
        return order.id;
      },
      { timeout: 20_000 },
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'lab.order',
      entity: 'labOrder',
      entityId: id,
      ip,
      data: { visitId, exams: ordered.map((s) => s.name), charged: dto.charge },
    });
    return this.get(actor.clinicId, id);
  }

  async sample(actor: AuthUser, id: number): Promise<LabOrderView> {
    const order = await this.find(actor.clinicId, id);
    if (order.status !== 'REQUESTED')
      throw new ConflictException(
        'La muestra ya se registró o el pedido está cerrado',
      );
    await this.prisma.labOrder.update({
      where: { id },
      data: {
        status: 'SAMPLE_TAKEN',
        sampleAt: new Date(),
        sampleById: actor.id,
      },
    });
    return this.get(actor.clinicId, id);
  }

  /** Resultado: un PDF o foto (queda como adjunto "Análisis" de la atención) y/o valores escritos */
  async result(
    actor: AuthUser,
    id: number,
    resultText: string | null | undefined,
    file: UploadedAttachment | undefined,
    ip?: string,
  ): Promise<LabOrderView> {
    const order = await this.find(actor.clinicId, id);
    if (!['REQUESTED', 'SAMPLE_TAKEN', 'RESULT_READY'].includes(order.status))
      throw new ConflictException(
        order.status === 'REVIEWED'
          ? 'El resultado ya fue revisado por el veterinario'
          : 'El pedido fue cancelado',
      );
    const text = resultText?.trim() || null;
    if (!text && !file?.buffer?.length)
      throw new BadRequestException(
        'Sube el archivo del resultado o escribe los valores',
      );
    const names = order.items.map((i) => i.name).join(', ');
    const attachment = file?.buffer?.length
      ? await this.attachments.upload(
          actor,
          order.petId,
          {
            kind: 'LAB',
            title: `Resultado ${labCode(order.number)}: ${names}`.slice(0, 150),
            visitId: order.visitId,
          },
          file,
          ip,
        )
      : null;
    await this.prisma.labOrder.update({
      where: { id },
      data: {
        status: 'RESULT_READY',
        resultAt: new Date(),
        resultById: actor.id,
        resultText: text ?? order.resultText,
        ...(attachment ? { attachmentId: attachment.id } : {}),
        // Si no se marcó la muestra, el resultado la implica
        sampleAt: order.sampleAt ?? new Date(),
        sampleById: order.sampleById ?? actor.id,
      },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'lab.result',
      entity: 'labOrder',
      entityId: id,
      ip,
      data: { file: Boolean(attachment), values: Boolean(text) },
    });
    return this.get(actor.clinicId, id);
  }

  /** El veterinario revisa e interpreta: recién ahí se puede avisar al dueño */
  async review(
    actor: AuthUser,
    id: number,
    interpretation: string,
    ip?: string,
  ): Promise<LabOrderView> {
    const order = await this.find(actor.clinicId, id);
    if (order.status !== 'RESULT_READY')
      throw new ConflictException(
        order.status === 'REVIEWED'
          ? 'El resultado ya fue revisado'
          : 'Todavía no hay resultado para revisar',
      );
    await this.prisma.labOrder.update({
      where: { id },
      data: {
        status: 'REVIEWED',
        reviewedAt: new Date(),
        reviewedById: actor.id,
        interpretation,
      },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'lab.review',
      entity: 'labOrder',
      entityId: id,
      ip,
    });
    return this.get(actor.clinicId, id);
  }

  /** Recepción abrió el WhatsApp para avisar al dueño */
  async notified(actor: AuthUser, id: number): Promise<LabOrderView> {
    const order = await this.find(actor.clinicId, id);
    if (order.status !== 'REVIEWED')
      throw new ForbiddenException(
        'Al dueño se le avisa cuando el veterinario revisó el resultado',
      );
    await this.prisma.labOrder.update({
      where: { id },
      data: { notifiedAt: new Date() },
    });
    return this.get(actor.clinicId, id);
  }

  /**
   * Cancelar un pedido sin resultado: los cargos sin pagar se quitan de la cuenta. Lo ya pagado
   * se queda (si se devuelve el dinero, es con nota de crédito en Comprobantes).
   */
  async cancel(
    actor: AuthUser,
    id: number,
    reason: string,
    ip?: string,
  ): Promise<LabOrderView> {
    const order = await this.find(actor.clinicId, id);
    if (!['REQUESTED', 'SAMPLE_TAKEN'].includes(order.status))
      throw new ConflictException('Solo se cancela un pedido sin resultado');
    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items)
        if (item.chargeId) {
          const charge = await tx.charge.findUnique({
            where: { id: item.chargeId },
            select: { status: true, paidAmount: true },
          });
          if (
            charge &&
            charge.status === 'PENDING' &&
            Number(charge.paidAmount) === 0
          )
            await this.charges.voidInTx(
              tx,
              actor,
              item.chargeId,
              `Examen cancelado (${labCode(order.number)}): ${reason}`,
              true,
            );
        }
      await tx.labOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: actor.id,
          cancelReason: reason,
        },
      });
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'lab.cancel',
      entity: 'labOrder',
      entityId: id,
      ip,
      data: { reason },
    });
    return this.get(actor.clinicId, id);
  }

  async get(clinicId: number, id: number): Promise<LabOrderView> {
    const row = await this.prisma.labOrder.findFirst({
      where: { id, clinicId },
      select: SELECT,
    });
    if (!row) throw new NotFoundException('El pedido de examen no existe');
    const [view] = await this.views([row]);
    return view;
  }

  private async find(clinicId: number, id: number) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id, clinicId },
      select: {
        id: true,
        number: true,
        status: true,
        petId: true,
        visitId: true,
        sampleAt: true,
        sampleById: true,
        resultText: true,
        items: { select: { name: true, chargeId: true } },
      },
    });
    if (!order) throw new NotFoundException('El pedido de examen no existe');
    return order;
  }

  private async views(rows: Row[], now = new Date()): Promise<LabOrderView[]> {
    const userIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.sampleById, r.resultById, r.reviewedById, r.cancelledById].filter(
            (v): v is number => v !== null,
          ),
        ),
      ),
    ];
    const chargeIds = rows.flatMap((r) =>
      r.items.flatMap((i) => (i.chargeId ? [i.chargeId] : [])),
    );
    const [users, charges] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true },
          })
        : [],
      chargeIds.length
        ? this.prisma.charge.findMany({
            where: { id: { in: chargeIds } },
            select: { id: true, total: true, status: true, paidAmount: true },
          })
        : [],
    ]);
    const name = (id: number | null) =>
      id === null ? null : (users.find((u) => u.id === id)?.fullName ?? null);
    const chargeById = new Map(charges.map((c) => [c.id, c]));
    return rows.map((r) => {
      const waiting =
        r.status === 'REQUESTED' || r.status === 'SAMPLE_TAKEN'
          ? Math.floor((now.getTime() - r.requestedAt.getTime()) / DAY_MS)
          : null;
      const live = r.items.map((i) => {
        const c = i.chargeId ? chargeById.get(i.chargeId) : undefined;
        return { item: i, charge: c && c.status !== 'VOID' ? c : undefined };
      });
      return {
        id: r.id,
        code: labCode(r.number),
        status: r.status,
        destination: r.destination,
        externalLab: r.externalLab,
        labCost: r.labCost === null ? null : Number(r.labCost),
        indication: r.indication,
        visitId: r.visitId,
        pet: {
          ...r.pet,
          weightKg: r.pet.weightKg === null ? null : Number(r.pet.weightKg),
        },
        client: r.client,
        items: live.map(({ item, charge }) => ({
          id: item.id,
          name: item.name,
          careServiceId: item.careServiceId,
          charged: Boolean(charge),
        })),
        total: live.reduce(
          (sum, l) => sum + (l.charge ? Number(l.charge.total) : 0),
          0,
        ),
        paid: live.reduce(
          (sum, l) => sum + (l.charge ? Number(l.charge.paidAmount) : 0),
          0,
        ),
        requestedAt: r.requestedAt,
        requestedBy: r.requestedBy.fullName,
        sampleAt: r.sampleAt,
        sampleBy: name(r.sampleById),
        resultAt: r.resultAt,
        resultBy: name(r.resultById),
        resultText: r.resultText,
        attachment:
          r.attachment && !r.attachment.voidedAt
            ? {
                id: r.attachment.id,
                fileName: r.attachment.fileName,
                mime: r.attachment.mime,
              }
            : null,
        reviewedAt: r.reviewedAt,
        reviewedBy: name(r.reviewedById),
        interpretation: r.interpretation,
        notifiedAt: r.notifiedAt,
        cancelledAt: r.cancelledAt,
        cancelledBy: name(r.cancelledById),
        cancelReason: r.cancelReason,
        waitingDays: waiting,
        overdue: waiting !== null && waiting >= LAB_OVERDUE_DAYS,
      };
    });
  }
}
