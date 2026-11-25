import { documentCode } from '../billing/billing.types.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clinicLogoUrl } from '../auth/session-user.js';
import { BillingSender } from '../billing/billing.sender.js';
import { BillingService, TicketDocument } from '../billing/billing.service.js';
import { OpeningHours, readOpeningHours } from '../clinic/opening-hours.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { reserveNumbers } from '../common/sequence/clinic-sequence.js';
import { clinicDay, startOfDayIn } from '../common/time/clinic-day.js';
import { Prisma } from '../generated/prisma/client.js';
import type { DocumentType, PaymentMethod } from '../generated/prisma/enums.js';
import { addDays } from '../inventory/expiry.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChargesService } from '../visits/charges.service.js';
import type { CreatedCharges } from '../visits/charges.service.js';
import {
  METHOD_LABELS,
  NEEDS_CODE,
  allocate,
  soles,
  checkPayments,
  expectedCash,
  saleNoteCode,
} from './cash-math.js';
import type { PaymentInput } from './cash-math.js';
import type {
  CashVoidDto,
  CloseSessionDto,
  CollectDto,
  CounterSaleDto,
  ExpenseDto,
  OpenSessionDto,
  SalesReportQuery,
} from './dto/cash.dto.js';

type Tx = Prisma.TransactionClient;
type Decimal = Prisma.Decimal;
const D = Prisma.Decimal;

/** Desde este monto la boleta exige identificar al cliente (SUNAT) */
/** SUNAT: la boleta que supera S/ 700 identifica al comprador (RCP art. 8) */
const ANONYMOUS_LIMIT = new D(700);
const DEFAULT_REGISTER = 'Caja principal';
const LEGEND = 'Nota de venta interna — no es comprobante de pago';
const SESSIONS_PAGE = 20;

export interface ReceiptTicket {
  id: number;
  number: number;
  code: string;
  status: 'ACTIVE' | 'VOID';
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  legend: string;
  clinic: {
    name: string;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
    openingHours: OpeningHours;
  };
  client: {
    id: number;
    number: number;
    name: string;
    docType: DocumentType | null;
    docNumber: string | null;
    walkIn: boolean;
  };
  /** Boleta o factura electrónica del cobro; null = nota de venta interna */
  document: TicketDocument | null;
  cashier: string;
  register: string;
  lines: {
    chargeId: number;
    description: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
    /** Lo que este cobro pagó de esa línea */
    paid: number;
    /** Producto vendido en caja: al anular se puede devolver al stock */
    returnable: boolean;
  }[];
  totals: {
    /** Op. gravada, exonerada e inafecta e IGV de las líneas (montos completos de los cargos) */
    taxed: number;
    exempt: number;
    unaffected: number;
    igv: number;
    lines: number;
    /** Pagado en este cobro */
    paid: number;
    change: number;
    /** Lo que el cliente sigue debiendo hoy */
    balance: number;
  };
  payments: {
    method: PaymentMethod;
    label: string;
    amount: number;
    tendered: number | null;
    operationCode: string | null;
  }[];
}

export interface SessionSummary {
  id: number;
  status: 'OPEN' | 'CLOSED';
  register: { id: number; name: string };
  openingAmount: number;
  openedAt: Date;
  openedBy: { id: number; fullName: string };
  closedAt: Date | null;
  closedBy: { id: number; fullName: string } | null;
  /** Calculado al momento si está abierta; congelado al cerrar */
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  closingNote: string | null;
  byMethod: {
    method: PaymentMethod;
    label: string;
    collected: number;
    refunded: number;
    net: number;
    /** Cuántos pagos entraron por este medio */
    payments: number;
    /** Yape, Plin o transferencia sin código de operación: revisar en la app al cerrar */
    withoutCode: number;
  }[];
  expenses: number;
  totals: {
    collected: number;
    refunded: number;
    net: number;
    receipts: number;
  };
  receipts: {
    id: number;
    /** Nota de venta interna (NV-000123) */
    code: string;
    /** El comprobante electrónico real, si se emitió (B001-00000123) */
    document: {
      type: 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';
      code: string;
      status: string;
    } | null;
    client: string;
    total: number;
    status: 'ACTIVE' | 'VOID';
    createdAt: Date;
    createdBy: string;
    /** Cómo se pagó (dos o más medios en un pago dividido) */
    payments: {
      method: PaymentMethod;
      label: string;
      amount: number;
      hasCode: boolean;
    }[];
  }[];
  movements: {
    id: number;
    kind: 'EXPENSE' | 'REFUND';
    method: PaymentMethod;
    amount: number;
    reason: string;
    receiptCode: string | null;
    createdAt: Date;
    createdBy: string;
    voided: boolean;
  }[];
}

/**
 * Caja: sesiones con arqueo, cobros (ticket NV), venta de mostrador, egresos y devoluciones.
 * Regla de oro: no se mueve dinero sin una caja abierta, y todo queda en la sesión.
 */
export type PendingSource =
  'CONSULTATION' | 'GROOMING' | 'HOSPITALIZATION' | 'COUNTER';

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargesService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly sender: BillingSender,
  ) {}

  // ── Cajas y sesiones ──

  async registers(clinicId: number) {
    await this.ensureRegister(clinicId);
    const rows = await this.prisma.cashRegister.findMany({
      where: { clinicId, active: true },
      select: {
        id: true,
        name: true,
        sessions: {
          where: { status: 'OPEN' },
          select: {
            id: true,
            openedAt: true,
            openedBy: { select: { fullName: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map(({ sessions, ...r }) => ({
      ...r,
      openSession: sessions[0] ?? null,
    }));
  }

  async open(
    actor: AuthUser,
    dto: OpenSessionDto,
    ip?: string,
  ): Promise<SessionSummary> {
    const registerId =
      dto.registerId ?? (await this.ensureRegister(actor.clinicId));
    const id = await this.prisma.$transaction(async (tx) => {
      // Bloquea la caja: dos aperturas simultáneas no crean dos sesiones
      const [register] = await tx.$queryRaw<{ id: number; active: boolean }[]>`
        SELECT id, active FROM cash_registers
        WHERE id = ${registerId} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!register?.active) throw new NotFoundException('La caja no existe');
      const open = await tx.cashSession.findFirst({
        where: { registerId, status: 'OPEN' },
        select: { id: true },
      });
      if (open)
        throw new ConflictException({
          message: 'La caja ya está abierta',
          sessionId: open.id,
        });
      const session = await tx.cashSession.create({
        data: {
          clinicId: actor.clinicId,
          registerId,
          openingAmount: dto.openingAmount,
          openedById: actor.id,
        },
        select: { id: true },
      });
      return session.id;
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'cash.open',
      entity: 'cash_session',
      entityId: id,
      ip,
      data: { openingAmount: dto.openingAmount },
    });
    return this.summary(actor.clinicId, id);
  }

  /** Sesión abierta de la caja indicada (o la única abierta), o null. */
  async current(
    clinicId: number,
    registerId?: number,
  ): Promise<SessionSummary | null> {
    const open = await this.prisma.cashSession.findMany({
      where: {
        clinicId,
        status: 'OPEN',
        ...(registerId ? { registerId } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return open.length ? this.summary(clinicId, open[0].id) : null;
  }

  async sessions(clinicId: number, page = 1) {
    const where = { clinicId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cashSession.findMany({
        where,
        select: {
          id: true,
          status: true,
          openedAt: true,
          closedAt: true,
          openingAmount: true,
          expectedCash: true,
          countedCash: true,
          difference: true,
          register: { select: { name: true } },
          openedBy: { select: { fullName: true } },
          closedBy: { select: { fullName: true } },
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * SESSIONS_PAGE,
        take: SESSIONS_PAGE,
      }),
      this.prisma.cashSession.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        ...r,
        openingAmount: Number(r.openingAmount),
        expectedCash: num(r.expectedCash),
        countedCash: num(r.countedCash),
        difference: num(r.difference),
      })),
      total,
      page,
      pageSize: SESSIONS_PAGE,
    };
  }

  async summary(
    clinicId: number,
    id: number,
    tx?: Tx,
  ): Promise<SessionSummary> {
    const db = tx ?? this.prisma;
    const session = await db.cashSession.findFirst({
      where: { id, clinicId },
      select: {
        id: true,
        status: true,
        openingAmount: true,
        openedAt: true,
        closedAt: true,
        expectedCash: true,
        countedCash: true,
        difference: true,
        closingNote: true,
        register: { select: { id: true, name: true } },
        openedBy: { select: { id: true, fullName: true } },
        closedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!session) throw new NotFoundException('La sesión de caja no existe');

    const [payments, uncoded, movements, receipts] = await Promise.all([
      db.payment.groupBy({
        by: ['method'],
        where: { receipt: { sessionId: id } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      db.payment.groupBy({
        by: ['method'],
        where: {
          receipt: { sessionId: id },
          method: { in: NEEDS_CODE },
          operationCode: null,
        },
        _count: { _all: true },
      }),
      db.cashMovement.findMany({
        where: { sessionId: id },
        select: {
          id: true,
          kind: true,
          method: true,
          amount: true,
          reason: true,
          createdAt: true,
          voidedAt: true,
          receipt: {
            select: {
              number: true,
              documents: {
                where: { type: { in: ['BOLETA', 'FACTURA'] } },
                select: { series: true, number: true },
                orderBy: { id: 'desc' },
                take: 1,
              },
            },
          },
          createdBy: { select: { fullName: true } },
        },
        orderBy: { id: 'asc' },
      }),
      db.receipt.findMany({
        where: { sessionId: id },
        select: {
          id: true,
          number: true,
          total: true,
          status: true,
          createdAt: true,
          client: { select: { name: true } },
          createdBy: { select: { fullName: true } },
          payments: {
            select: { method: true, amount: true, operationCode: true },
            orderBy: { id: 'asc' },
          },
          // La boleta o factura de este cobro (la nota de crédito no reemplaza su número)
          documents: {
            where: { type: { in: ['BOLETA', 'FACTURA'] } },
            select: { type: true, series: true, number: true, status: true },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
        orderBy: { id: 'asc' },
      }),
    ]);

    const live = movements.filter((m) => !m.voidedAt);
    const sumBy = (kind: 'EXPENSE' | 'REFUND', method: PaymentMethod) =>
      live
        .filter((m) => m.kind === kind && m.method === method)
        .reduce((acc, m) => acc.plus(m.amount), new D(0));
    // Todo lo que entró en la sesión (también lo de cobros anulados: el dinero sí entró;
    // su devolución sale como movimiento REFUND)
    const collected = (method: PaymentMethod) =>
      new D(payments.find((p) => p.method === method)?._sum.amount ?? 0);

    const methods: PaymentMethod[] = [
      'CASH',
      'YAPE',
      'PLIN',
      'CARD',
      'TRANSFER',
    ];
    const byMethod = methods.map((method) => {
      const inn = collected(method);
      const out = sumBy('REFUND', method);
      return {
        method,
        label: METHOD_LABELS[method],
        collected: inn.toNumber(),
        refunded: out.toNumber(),
        net: inn.minus(out).toNumber(),
        payments: payments.find((p) => p.method === method)?._count._all ?? 0,
        withoutCode: uncoded.find((p) => p.method === method)?._count._all ?? 0,
      };
    });
    const expenses = sumBy('EXPENSE', 'CASH');
    const expected =
      session.status === 'CLOSED' && session.expectedCash
        ? session.expectedCash
        : expectedCash({
            opening: session.openingAmount,
            cashIn: collected('CASH'),
            expenses,
            cashRefunds: sumBy('REFUND', 'CASH'),
          });
    const totalIn =
      byMethod.reduce((acc, m) => acc + m.collected * 100, 0) / 100;
    const totalOut =
      byMethod.reduce((acc, m) => acc + m.refunded * 100, 0) / 100;

    return {
      id: session.id,
      status: session.status,
      register: session.register,
      openingAmount: Number(session.openingAmount),
      openedAt: session.openedAt,
      openedBy: session.openedBy,
      closedAt: session.closedAt,
      closedBy: session.closedBy,
      expectedCash: Number(expected),
      countedCash: num(session.countedCash),
      difference: num(session.difference),
      closingNote: session.closingNote,
      byMethod,
      expenses: expenses.toNumber(),
      totals: {
        collected: totalIn,
        refunded: totalOut,
        net: Math.round((totalIn - totalOut) * 100) / 100,
        receipts: receipts.filter((r) => r.status === 'ACTIVE').length,
      },
      receipts: receipts.map((r) => ({
        id: r.id,
        code: saleNoteCode(r.number),
        document: r.documents[0]
          ? {
              type: r.documents[0].type,
              code: documentCode(r.documents[0].series, r.documents[0].number),
              status: r.documents[0].status,
            }
          : null,
        client: r.client.name,
        total: Number(r.total),
        status: r.status,
        createdAt: r.createdAt,
        createdBy: r.createdBy.fullName,
        payments: r.payments.map((p) => ({
          method: p.method,
          label: METHOD_LABELS[p.method],
          amount: Number(p.amount),
          hasCode: p.operationCode !== null,
        })),
      })),
      movements: movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        method: m.method,
        amount: Number(m.amount),
        // El motivo sin el prefijo "Devolución NV-…:" que se guarda para la auditoría
        reason: m.reason.replace(/^Devolución NV-\d+:\s*/, ''),
        // El comprobante que se devolvió (la boleta o factura; si no hubo, la nota de venta)
        receiptCode: m.receipt
          ? m.receipt.documents[0]
            ? documentCode(
                m.receipt.documents[0].series,
                m.receipt.documents[0].number,
              )
            : saleNoteCode(m.receipt.number)
          : null,
        createdAt: m.createdAt,
        createdBy: m.createdBy.fullName,
        voided: m.voidedAt !== null,
      })),
    };
  }

  /** Cierre con arqueo: lo esperado queda congelado junto a lo contado y la diferencia. */
  async close(
    actor: AuthUser,
    id: number,
    dto: CloseSessionDto,
    ip?: string,
  ): Promise<SessionSummary> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Espera a que terminen los cobros en curso de esta sesión
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM cash_sessions
        WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!row) throw new NotFoundException('La sesión de caja no existe');
      if (row.status !== 'OPEN')
        throw new ConflictException('La caja ya está cerrada');

      const live = await this.summary(actor.clinicId, id, tx);
      const expected = new D(live.expectedCash);
      const counted = new D(dto.countedCash);
      const difference = counted.minus(expected);
      if (!difference.isZero() && !dto.note)
        throw new BadRequestException(
          `Lo contado no coincide con lo esperado (diferencia de S/ ${difference.toFixed(2)}): explica el motivo`,
        );
      await tx.cashSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: actor.id,
          expectedCash: expected,
          countedCash: counted,
          difference,
          closingNote: dto.note ?? null,
        },
      });
      return { expected, counted, difference };
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: result.difference.isZero()
        ? 'cash.close'
        : 'cash.close_difference',
      entity: 'cash_session',
      entityId: id,
      ip,
      data: {
        expected: result.expected.toNumber(),
        counted: result.counted.toNumber(),
        difference: result.difference.toNumber(),
        note: dto.note ?? null,
      },
    });
    return this.summary(actor.clinicId, id);
  }

  // ── Cobros ──

  async collect(
    actor: AuthUser,
    dto: CollectDto,
    ip?: string,
  ): Promise<ReceiptTicket> {
    const existing = await this.byRequestKey(actor.clinicId, dto.requestKey);
    if (existing) return existing;
    const extra = dto.items?.length ? dto.items : null;
    const prep = extra ? await this.charges.prepare(actor) : null;
    let receiptId: number;
    let added: CreatedCharges | null;
    try {
      ({ id: receiptId, added } = await this.prisma.$transaction(
        async (tx) => {
          // Lo agregado en caja se registra aquí mismo: si el cobro falla, no queda nada
          const added =
            extra && prep
              ? await this.charges.createInTx(
                  tx,
                  actor,
                  { clientId: dto.clientId, items: extra },
                  prep,
                )
              : null;
          const newIds = added?.charges.map((c) => c.id) ?? [];
          const id = await this.collectInTx(tx, actor, {
            requestKey: dto.requestKey,
            clientId: dto.clientId,
            chargeIds: dto.chargeIds ? [...dto.chargeIds, ...newIds] : null,
            firstIds: newIds,
            amount: dto.amount ?? null,
            registerId: dto.registerId,
            payments: dto.payments,
            identified:
              !!dto.buyer && !!dto.document && dto.document !== 'NOTE',
          });
          // El comprobante se numera en la misma transacción: si algo falla, no queda cobro sin él
          if (dto.document && dto.document !== 'NOTE')
            await this.billing.issueInTx(
              tx,
              actor,
              id,
              dto.document,
              dto.buyer,
            );
          return { id, added };
        },
        { timeout: 20_000 },
      ));
    } catch (error) {
      // Dos envíos simultáneos del mismo cobro: el segundo devuelve el primero
      const retry = await this.duplicate(error, actor.clinicId, dto.requestKey);
      if (retry) return retry;
      throw error;
    }
    if (added) await this.charges.logCreated(actor, null, added, ip);
    if (dto.document && dto.document !== 'NOTE') this.sender.dispatch();
    const ticket = await this.ticket(actor.clinicId, receiptId);
    await this.logCollect(actor, ticket, ip);
    return ticket;
  }

  /** Venta de mostrador: los cargos y su cobro completo, todo o nada. */
  async counterSale(
    actor: AuthUser,
    dto: CounterSaleDto,
    ip?: string,
  ): Promise<{
    receipt: ReceiptTicket;
    shortages: CreatedCharges['shortages'];
  }> {
    const existing = await this.byRequestKey(actor.clinicId, dto.requestKey);
    if (existing) return { receipt: existing, shortages: [] };
    const prep = await this.charges.prepare(actor);

    let created: {
      receiptId: number;
      charges: CreatedCharges;
      clientId: number;
    };
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          const clientId =
            dto.clientId ?? (await this.walkInClient(tx, actor.clinicId));
          const charges = await this.charges.createInTx(
            tx,
            actor,
            { clientId, petId: dto.petId, items: dto.items },
            prep,
          );
          const total = charges.charges.reduce(
            (acc, c) => acc.plus(c.total),
            new D(0),
          );
          const receiptId = await this.collectInTx(tx, actor, {
            requestKey: dto.requestKey,
            clientId,
            chargeIds: charges.charges.map((c) => c.id),
            amount: total.toNumber(),
            registerId: dto.registerId,
            payments: dto.payments,
            identified:
              !!dto.buyer && !!dto.document && dto.document !== 'NOTE',
          });
          if (dto.document && dto.document !== 'NOTE')
            await this.billing.issueInTx(
              tx,
              actor,
              receiptId,
              dto.document,
              dto.buyer,
            );
          return { receiptId, charges, clientId };
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      const retry = await this.duplicate(error, actor.clinicId, dto.requestKey);
      if (retry) return { receipt: retry, shortages: [] };
      throw error;
    }
    await this.charges.logCreated(actor, null, created.charges, ip);
    if (dto.document && dto.document !== 'NOTE') this.sender.dispatch();
    const ticket = await this.ticket(actor.clinicId, created.receiptId);
    await this.logCollect(actor, ticket, ip);
    return { receipt: ticket, shortages: created.charges.shortages };
  }

  /**
   * Anular un cobro (solo el administrador): los cargos vuelven a quedar pendientes y el dinero
   * sale como devolución de la caja abierta, por el mismo medio con que se pagó.
   */
  async voidReceipt(
    actor: AuthUser,
    id: number,
    dto: CashVoidDto,
    ip?: string,
  ): Promise<ReceiptTicket> {
    const creditNote = await this.prisma.$transaction(async (tx) => {
      const [receipt] = await tx.$queryRaw<
        { status: string; number: number }[]
      >`
        SELECT status::text AS status, number FROM receipts
        WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!receipt) throw new NotFoundException('El cobro no existe');
      if (receipt.status !== 'ACTIVE')
        throw new ConflictException('El cobro ya fue anulado');
      const session = await this.lockOpenSession(
        tx,
        actor.clinicId,
        dto.registerId,
      );

      const allocations = await tx.paymentAllocation.findMany({
        where: { receiptId: id },
        select: { chargeId: true, amount: true },
        orderBy: { chargeId: 'asc' },
      });
      await this.lockCharges(
        tx,
        actor.clinicId,
        allocations.map((a) => a.chargeId),
      );
      for (const a of allocations)
        await tx.charge.update({
          where: { id: a.chargeId },
          data: { paidAmount: { decrement: a.amount }, status: 'PENDING' },
        });
      // Devolvió lo vendido en caja: se quita de su cuenta y el stock vuelve a sus lotes
      if (dto.returnProducts) {
        const sold = await tx.charge.findMany({
          where: {
            id: { in: allocations.map((x) => x.chargeId) },
            kind: 'PRODUCT',
            visitId: null,
            status: 'PENDING',
            paidAmount: 0,
          },
          select: { id: true },
        });
        for (const c of sold)
          await this.charges.voidInTx(
            tx,
            actor,
            c.id,
            `Devuelto al anular ${saleNoteCode(receipt.number)}: ${dto.reason}`,
            true,
          );
      }

      const payments = await tx.payment.findMany({
        where: { receiptId: id },
        select: { method: true, amount: true },
      });
      for (const p of payments)
        await tx.cashMovement.create({
          data: {
            clinicId: actor.clinicId,
            sessionId: session.id,
            kind: 'REFUND',
            method: p.method,
            amount: p.amount,
            reason: `Devolución ${saleNoteCode(receipt.number)}: ${dto.reason}`,
            receiptId: id,
            createdById: actor.id,
          },
        });
      await tx.receipt.update({
        where: { id },
        data: {
          status: 'VOID',
          voidedAt: new Date(),
          voidedById: actor.id,
          voidReason: dto.reason,
        },
      });
      // Si el cobro tenía boleta o factura, se anula con su nota de crédito
      return this.billing.creditNoteInTx(tx, actor, id, dto.reason);
    });
    if (creditNote) this.sender.dispatch();
    const ticket = await this.ticket(actor.clinicId, id);
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'cash.receipt_void',
      entity: 'receipt',
      entityId: id,
      ip,
      data: {
        code: ticket.code,
        total: ticket.totals.paid,
        reason: dto.reason,
      },
    });
    return ticket;
  }

  // ── Egresos de caja chica ──

  async expense(actor: AuthUser, dto: ExpenseDto, ip?: string) {
    const movement = await this.prisma.$transaction(async (tx) => {
      const session = await this.lockOpenSession(
        tx,
        actor.clinicId,
        dto.registerId,
      );
      // No puede salir más efectivo del que hay: el esperado quedaría negativo y el arqueo
      // ya no serviría (la sesión está bloqueada, así dos egresos a la vez no se cruzan)
      const onHand = await this.cashOnHand(tx, session.id);
      if (new D(dto.amount).gt(onHand))
        throw new BadRequestException(
          `Solo hay S/ ${onHand.toFixed(2)} en efectivo en caja: el egreso no puede ser mayor`,
        );
      return tx.cashMovement.create({
        data: {
          clinicId: actor.clinicId,
          sessionId: session.id,
          kind: 'EXPENSE',
          method: 'CASH',
          amount: dto.amount,
          reason: dto.reason,
          createdById: actor.id,
        },
        select: { id: true, sessionId: true },
      });
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'cash.expense',
      entity: 'cash_movement',
      entityId: movement.id,
      ip,
      data: { amount: dto.amount, reason: dto.reason },
    });
    return this.summary(actor.clinicId, movement.sessionId);
  }

  /** Solo el administrador, y mientras la sesión siga abierta (cerrada ya está arqueada). */
  async voidExpense(
    actor: AuthUser,
    id: number,
    dto: CashVoidDto,
    ip?: string,
  ) {
    const sessionId = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { kind: string; voided_at: Date | null; session_id: number }[]
      >`SELECT kind::text AS kind, voided_at, session_id FROM cash_movements
        WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!row || row.kind !== 'EXPENSE')
        throw new NotFoundException('El egreso no existe');
      if (row.voided_at)
        throw new ConflictException('El egreso ya fue anulado');
      const [session] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM cash_sessions WHERE id = ${row.session_id} FOR UPDATE`;
      if (session.status !== 'OPEN')
        throw new ConflictException(
          'La caja de ese egreso ya se cerró: el arqueo no se puede cambiar',
        );
      await tx.cashMovement.update({
        where: { id },
        data: {
          voidedAt: new Date(),
          voidedById: actor.id,
          voidReason: dto.reason,
        },
      });
      return row.session_id;
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'cash.expense_void',
      entity: 'cash_movement',
      entityId: id,
      ip,
      data: { reason: dto.reason },
    });
    return this.summary(actor.clinicId, sessionId);
  }

  // ── Ticket y reportes ──

  async ticket(clinicId: number, id: number): Promise<ReceiptTicket> {
    const r = await this.prisma.receipt.findFirst({
      where: { id, clinicId },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        change: true,
        createdAt: true,
        voidedAt: true,
        voidReason: true,
        clinic: {
          select: {
            name: true,
            ruc: true,
            address: true,
            phone: true,
            logoMime: true,
            logoUpdatedAt: true,
            openingHours: true,
          },
        },
        client: {
          select: {
            id: true,
            number: true,
            name: true,
            docType: true,
            docNumber: true,
            walkIn: true,
          },
        },
        createdBy: { select: { fullName: true } },
        session: { select: { register: { select: { name: true } } } },
        payments: {
          select: {
            method: true,
            amount: true,
            tendered: true,
            operationCode: true,
          },
          orderBy: { id: 'asc' },
        },
        allocations: {
          select: {
            amount: true,
            charge: {
              select: {
                id: true,
                description: true,
                quantity: true,
                unitPrice: true,
                discount: true,
                total: true,
                igvAffectation: true,
                taxableAmount: true,
                igvAmount: true,
                kind: true,
                visitId: true,
              },
            },
          },
          orderBy: { chargeId: 'asc' },
        },
      },
    });
    if (!r) throw new NotFoundException('El cobro no existe');

    const allocated = r.allocations;
    const sum = (
      pick: (c: (typeof allocated)[number]['charge']) => Decimal | null,
    ) =>
      allocated
        .reduce((acc, a) => acc.plus(pick(a.charge) ?? 0), new D(0))
        .toNumber();
    const pending = await this.prisma.charge.findMany({
      where: { clinicId, clientId: r.client.id, status: 'PENDING' },
      select: { total: true, paidAmount: true },
    });
    const balance = pending
      .reduce((acc, c) => acc.plus(c.total).minus(c.paidAmount), new D(0))
      .toNumber();
    const { logoMime, logoUpdatedAt, openingHours, ...clinic } = r.clinic;

    return {
      id: r.id,
      number: r.number,
      code: saleNoteCode(r.number),
      status: r.status,
      createdAt: r.createdAt,
      voidedAt: r.voidedAt,
      voidReason: r.voidReason,
      legend: LEGEND,
      document: await this.billing.forTicket(clinicId, r.id),
      clinic: {
        ...clinic,
        logoUrl: clinicLogoUrl({ logoMime, logoUpdatedAt }),
        openingHours: readOpeningHours(openingHours),
      },
      client: r.client,
      cashier: r.createdBy.fullName,
      register: r.session.register.name,
      lines: r.allocations.map((a) => ({
        chargeId: a.charge.id,
        description: a.charge.description,
        quantity: Number(a.charge.quantity),
        unitPrice: Number(a.charge.unitPrice),
        discount: Number(a.charge.discount),
        total: Number(a.charge.total),
        paid: Number(a.amount),
        // Producto vendido en caja (mostrador o agregado al cobro): se puede devolver al anular
        returnable: a.charge.kind === 'PRODUCT' && a.charge.visitId === null,
      })),
      totals: {
        taxed: sum((c) =>
          c.igvAffectation === 'TAXED' ? c.taxableAmount : null,
        ),
        exempt: sum((c) =>
          c.igvAffectation === 'EXEMPT' ? c.taxableAmount : null,
        ),
        unaffected: sum((c) =>
          c.igvAffectation === 'UNAFFECTED' ? c.taxableAmount : null,
        ),
        igv: sum((c) => c.igvAmount),
        lines: sum((c) => c.total),
        paid: Number(r.total),
        change: Number(r.change),
        balance,
      },
      payments: r.payments.map((p) => ({
        method: p.method,
        label: METHOD_LABELS[p.method],
        amount: Number(p.amount),
        tendered: num(p.tendered),
        operationCode: p.operationCode,
      })),
    };
  }

  /** Ventas por día y por medio de pago (fecha de Lima). Lo cobrado menos lo devuelto. */
  async report(clinicId: number, query: SalesReportQuery) {
    if (query.to < query.from)
      throw new BadRequestException('La fecha final es anterior a la inicial');
    if (addDays(query.from, 366) < query.to)
      throw new BadRequestException('El reporte admite hasta un año');
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const start = startOfDayIn(timezone, query.from);
    const end = startOfDayIn(timezone, addDays(query.to, 1));
    const rows = await this.prisma.$queryRaw<
      {
        day: string;
        method: PaymentMethod;
        collected: Decimal;
        refunded: Decimal;
      }[]
    >`
      SELECT day, method, SUM(collected) AS collected, SUM(refunded) AS refunded FROM (
        SELECT to_char(r.created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
               p.method::text AS method, p.amount AS collected, 0 AS refunded
        FROM payments p JOIN receipts r ON r.id = p.receipt_id
        WHERE r.clinic_id = ${clinicId} AND r.created_at >= ${start} AND r.created_at < ${end}
        UNION ALL
        SELECT to_char(m.created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD'),
               m.method::text, 0, m.amount
        FROM cash_movements m
        WHERE m.clinic_id = ${clinicId} AND m.kind = 'REFUND' AND m.voided_at IS NULL
          AND m.created_at >= ${start} AND m.created_at < ${end}
      ) t GROUP BY day, method ORDER BY day, method`;

    const days = new Map<
      string,
      { day: string; collected: Decimal; refunded: Decimal }
    >();
    const methods = new Map<PaymentMethod, Decimal>();
    for (const row of rows) {
      const d = days.get(row.day) ?? {
        day: row.day,
        collected: new D(0),
        refunded: new D(0),
      };
      d.collected = d.collected.plus(row.collected);
      d.refunded = d.refunded.plus(row.refunded);
      days.set(row.day, d);
      methods.set(
        row.method,
        (methods.get(row.method) ?? new D(0))
          .plus(row.collected)
          .minus(row.refunded),
      );
    }
    const list = [...days.values()].map((d) => ({
      day: d.day,
      collected: d.collected.toNumber(),
      refunded: d.refunded.toNumber(),
      net: d.collected.minus(d.refunded).toNumber(),
    }));
    return {
      from: query.from,
      to: query.to,
      days: list,
      byMethod: [...methods.entries()].map(([method, net]) => ({
        method,
        label: METHOD_LABELS[method],
        net: net.toNumber(),
      })),
      net: list.reduce((acc, d) => acc.plus(d.net), new D(0)).toNumber(),
    };
  }

  /**
   * Clientes con saldo, con sus mascotas y de dónde viene lo que deben (consulta, grooming,
   * hospitalización o mostrador): recepción reconoce al cliente por la mascota o el servicio.
   */
  async pending(clinicId: number) {
    const rows = await this.prisma.$queryRaw<
      {
        client_id: number;
        balance: Decimal;
        charges: bigint;
        since: Date;
        last: Date;
        pets: string[] | null;
        grooming: boolean;
        hospital: boolean;
        consult: boolean;
        counter: boolean;
      }[]
    >`
      SELECT c.client_id, SUM(c.total - c.paid_amount) AS balance, COUNT(*) AS charges,
             MIN(c.created_at) AS since, MAX(c.created_at) AS last,
             array_remove(array_agg(DISTINCT p.name), NULL) AS pets,
             bool_or(v.type = 'GROOMING') AS grooming,
             bool_or(v.type = 'HOSPITALIZATION') AS hospital,
             bool_or(v.type = 'CONSULTATION') AS consult,
             bool_or(c.visit_id IS NULL) AS counter
      FROM charges c
      LEFT JOIN visits v ON v.id = c.visit_id
      LEFT JOIN pets p ON p.id = v.pet_id
      WHERE c.clinic_id = ${clinicId} AND c.status = 'PENDING'
      GROUP BY c.client_id
      HAVING SUM(c.total - c.paid_amount) > 0
      ORDER BY since
      LIMIT 100`;
    const clients = rows.length
      ? await this.prisma.client.findMany({
          where: { clinicId, id: { in: rows.map((r) => r.client_id) } },
          select: { id: true, number: true, name: true, phone: true },
        })
      : [];
    return rows.map((r) => ({
      client: clients.find((c) => c.id === r.client_id)!,
      balance: Number(r.balance),
      charges: Number(r.charges),
      since: r.since,
      last: r.last,
      pets: r.pets ?? [],
      sources: [
        r.consult && 'CONSULTATION',
        r.grooming && 'GROOMING',
        r.hospital && 'HOSPITALIZATION',
        r.counter && 'COUNTER',
      ].filter((x): x is PendingSource => Boolean(x)),
    }));
  }

  /** Para el dashboard: lo cobrado hoy (menos devoluciones) y cuántos cobros. */
  async today(clinicId: number, timezone: string) {
    const day = clinicDay(timezone);
    const start = startOfDayIn(timezone, day);
    const end = startOfDayIn(timezone, addDays(day, 1));
    const [all, active, refunds, refundsOfEarlier, receipts] =
      await Promise.all([
        // Todo lo que entró hoy (también lo de cobros anulados después)
        this.prisma.payment.aggregate({
          where: {
            clinicId,
            receipt: { clinicId, createdAt: { gte: start, lt: end } },
          },
          _sum: { amount: true },
        }),
        // Lo cobrado hoy que sigue vigente: un cobro anulado el mismo día no cuenta
        this.prisma.payment.aggregate({
          where: {
            clinicId,
            receipt: {
              clinicId,
              status: 'ACTIVE',
              createdAt: { gte: start, lt: end },
            },
          },
          _sum: { amount: true },
        }),
        this.prisma.cashMovement.aggregate({
          where: {
            clinicId,
            kind: 'REFUND',
            voidedAt: null,
            createdAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        }),
        // Devoluciones de hoy por cobros de días anteriores (las de hoy ya se restaron arriba)
        this.prisma.cashMovement.aggregate({
          where: {
            clinicId,
            kind: 'REFUND',
            voidedAt: null,
            createdAt: { gte: start, lt: end },
            receipt: { createdAt: { lt: start } },
          },
          _sum: { amount: true },
        }),
        this.prisma.receipt.count({
          where: {
            clinicId,
            status: 'ACTIVE',
            createdAt: { gte: start, lt: end },
          },
        }),
      ]);
    return {
      /** Neto (todo lo que entró menos lo devuelto): lo mismo que caja y reportes */
      total: new D(all._sum.amount ?? 0)
        .minus(refunds._sum.amount ?? 0)
        .toNumber(),
      /** Lo cobrado hoy que sigue vigente */
      collected: new D(active._sum.amount ?? 0).toNumber(),
      /** Lo devuelto hoy por cobros de días anteriores (anular uno de hoy ya lo saca de "cobrado") */
      refunded: new D(refundsOfEarlier._sum.amount ?? 0).toNumber(),
      receipts,
    };
  }

  // ── Ayudas ──

  /**
   * El corazón del cobro, dentro de una transacción: bloquea la sesión y los cargos,
   * reparte el monto, registra pagos y numera el ticket.
   */
  private async collectInTx(
    tx: Tx,
    actor: AuthUser,
    input: {
      requestKey: string;
      clientId: number;
      chargeIds: number[] | null;
      /** Se pagan primero (lo agregado en caja: no se va sin pagar con un abono) */
      firstIds?: number[];
      amount: number | null;
      registerId?: number;
      payments: PaymentInput[];
      /** El comprador se identificó en el cobro (DNI o RUC escrito para la boleta o factura) */
      identified?: boolean;
    },
  ): Promise<number> {
    const session = await this.lockOpenSession(
      tx,
      actor.clinicId,
      input.registerId,
    );
    const client = await tx.client.findFirst({
      where: { id: input.clientId, clinicId: actor.clinicId },
      select: { id: true, walkIn: true },
    });
    if (!client) throw new NotFoundException('El cliente no existe');

    const ids =
      input.chargeIds ??
      (
        await tx.charge.findMany({
          where: {
            clinicId: actor.clinicId,
            clientId: client.id,
            status: 'PENDING',
          },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      ).map((c) => c.id);
    if (!ids.length)
      throw new ConflictException('El cliente no tiene nada por cobrar');
    const rows = await this.lockCharges(tx, actor.clinicId, ids);
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.client_id !== client.id)
        throw new NotFoundException(
          'Algún cargo no existe o es de otro cliente',
        );
      if (row.status !== 'PENDING')
        throw new ConflictException(
          row.status === 'PAID'
            ? 'Algún cargo ya está pagado'
            : 'Algún cargo fue quitado',
        );
    }
    // Lo agregado en caja primero; después, del más antiguo al más nuevo
    const first = new Set(input.firstIds ?? []);
    const charges = ids
      .map((id) => rows.find((r) => r.id === id)!)
      .sort(
        (a, b) =>
          Number(first.has(b.id)) - Number(first.has(a.id)) || a.id - b.id,
      )
      .map((r) => ({
        id: r.id,
        total: new D(r.total),
        balance: new D(r.total).minus(r.paid_amount),
      }));
    const owed = charges.reduce((acc, c) => acc.plus(c.balance), new D(0));
    const amount = input.amount === null ? owed : new D(input.amount);
    const mustPay = charges
      .filter((c) => first.has(c.id))
      .reduce((acc, c) => acc.plus(c.balance), new D(0));
    if (amount.lt(mustPay))
      throw new ConflictException(
        `El abono debe cubrir al menos lo agregado en caja (${soles(mustPay)})`,
      );

    if (client.walkIn) {
      if (!amount.equals(owed))
        throw new BadRequestException(
          'A "Cliente varios" no se le deja deuda: cobra el total o registra al cliente',
        );
      if (owed.gt(ANONYMOUS_LIMIT) && !input.identified)
        throw new BadRequestException(
          'Más de S/ 700 el comprobante lleva el DNI del comprador: escríbelo en el cobro',
        );
    }

    const allocations = allocate(charges, amount);
    const { lines, change } = checkPayments(input.payments, amount);
    const number = await reserveNumbers(tx, actor.clinicId, 'sale_note');

    const receipt = await tx.receipt.create({
      data: {
        clinicId: actor.clinicId,
        number,
        clientId: client.id,
        sessionId: session.id,
        total: amount,
        change,
        requestKey: input.requestKey,
        createdById: actor.id,
        payments: {
          create: lines.map((l) => ({
            clinicId: actor.clinicId,
            method: l.method,
            amount: l.amount,
            tendered: l.tendered,
            operationCode: l.operationCode,
          })),
        },
        allocations: {
          create: allocations.map((a) => ({
            chargeId: a.chargeId,
            amount: a.amount,
          })),
        },
      },
      select: { id: true },
    });
    for (const a of allocations) {
      const charge = charges.find((c) => c.id === a.chargeId)!;
      const paid = charge.total.minus(charge.balance).plus(a.amount);
      await tx.charge.update({
        where: { id: a.chargeId },
        data: {
          paidAmount: paid,
          status: paid.equals(charge.total) ? 'PAID' : 'PENDING',
        },
      });
    }
    return receipt.id;
  }

  /** Efectivo que debería haber en el cajón ahora (inicial + cobros − egresos − devoluciones) */
  private async cashOnHand(tx: Tx, sessionId: number): Promise<Decimal> {
    const [session, cashIn, out] = await Promise.all([
      tx.cashSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { openingAmount: true },
      }),
      tx.payment.aggregate({
        where: { method: 'CASH', receipt: { sessionId } },
        _sum: { amount: true },
      }),
      tx.cashMovement.groupBy({
        by: ['kind'],
        where: { sessionId, method: 'CASH', voidedAt: null },
        _sum: { amount: true },
      }),
    ]);
    const sum = (kind: 'EXPENSE' | 'REFUND') =>
      new D(out.find((o) => o.kind === kind)?._sum.amount ?? 0);
    return expectedCash({
      opening: session.openingAmount,
      cashIn: new D(cashIn._sum.amount ?? 0),
      expenses: sum('EXPENSE'),
      cashRefunds: sum('REFUND'),
    });
  }

  /** La sesión abierta de la caja indicada, o la única abierta de la clínica. Queda bloqueada. */
  private async lockOpenSession(
    tx: Tx,
    clinicId: number,
    registerId?: number,
  ): Promise<{ id: number }> {
    const open = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM cash_sessions
      WHERE clinic_id = ${clinicId} AND status = 'OPEN'
        ${registerId ? Prisma.sql`AND register_id = ${registerId}` : Prisma.empty}
      ORDER BY id
      FOR UPDATE`;
    if (!open.length)
      throw new ConflictException(
        'La caja está cerrada: ábrela para registrar dinero',
      );
    if (open.length > 1)
      throw new BadRequestException(
        'Hay varias cajas abiertas: elige cuál usar',
      );
    return open[0];
  }

  private lockCharges(tx: Tx, clinicId: number, ids: number[]) {
    if (!ids.length)
      return Promise.resolve(
        [] as {
          id: number;
          client_id: number;
          status: string;
          total: Decimal;
          paid_amount: Decimal;
        }[],
      );
    return tx.$queryRaw<
      {
        id: number;
        client_id: number;
        status: string;
        total: Decimal;
        paid_amount: Decimal;
      }[]
    >`SELECT id, client_id, status::text AS status, total, paid_amount FROM charges
      WHERE clinic_id = ${clinicId} AND id IN (${Prisma.join(ids)})
      ORDER BY id FOR UPDATE`;
  }

  /** "Caja principal": la crea si la clínica todavía no tiene ninguna. */
  private async ensureRegister(clinicId: number): Promise<number> {
    const first = await this.prisma.cashRegister.findFirst({
      where: { clinicId, active: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (first) return first.id;
    await this.prisma.$executeRaw`
      INSERT INTO cash_registers (clinic_id, name) VALUES (${clinicId}, ${DEFAULT_REGISTER})
      ON CONFLICT (clinic_id, name) DO NOTHING`;
    return (
      await this.prisma.cashRegister.findFirstOrThrow({
        where: { clinicId, name: DEFAULT_REGISTER },
        select: { id: true },
      })
    ).id;
  }

  /** "Cliente varios" (C-00000) de la clínica, creado la primera vez que se usa. */
  private async walkInClient(tx: Tx, clinicId: number): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO clients (clinic_id, number, name, phone, consent_at, consent_version,
                           consent_channel, search_text, walk_in, updated_at)
      VALUES (${clinicId}, 0, 'Cliente varios', '000000000', now(), 'N/A',
              'SYSTEM', 'cliente varios', true, now())
      ON CONFLICT (clinic_id, number) DO NOTHING`;
    return (
      await tx.client.findFirstOrThrow({
        where: { clinicId, number: 0, walkIn: true },
        select: { id: true },
      })
    ).id;
  }

  private async byRequestKey(
    clinicId: number,
    requestKey: string,
  ): Promise<ReceiptTicket | null> {
    const found = await this.prisma.receipt.findUnique({
      where: { clinicId_requestKey: { clinicId, requestKey } },
      select: { id: true },
    });
    return found ? this.ticket(clinicId, found.id) : null;
  }

  private async duplicate(
    error: unknown,
    clinicId: number,
    requestKey: string,
  ): Promise<ReceiptTicket | null> {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      return this.byRequestKey(clinicId, requestKey);
    return null;
  }

  private logCollect(actor: AuthUser, ticket: ReceiptTicket, ip?: string) {
    return this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'cash.collect',
      entity: 'receipt',
      entityId: ticket.id,
      ip,
      data: {
        code: ticket.code,
        clientId: ticket.client.id,
        paid: ticket.totals.paid,
        payments: ticket.payments.map((p) => ({
          method: p.method,
          amount: p.amount,
        })),
      },
    });
  }
}

const num = (value: Decimal | null): number | null =>
  value === null ? null : Number(value);
