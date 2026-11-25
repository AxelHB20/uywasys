import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { round2 } from '../common/money/igv.js';
import {
  purchaseCode,
  reserveNumbers,
} from '../common/sequence/clinic-sequence.js';
import { normalizeSearch } from '../common/text/search.js';
import { fromDbDate, toDbDate } from '../common/time/clinic-day.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { detectAttachmentType } from '../medical/attachments.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  PurchaseDocType,
  PurchaseStatus,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreatePurchaseDto,
  ListPurchasesQuery,
  PurchaseHeaderDto,
  UpdatePurchaseDto,
} from './dto/purchases.dto.js';
import {
  docKeyOf,
  purchaseLineAmounts,
  unitCostOf,
} from './purchase-amounts.js';
import { StockService } from './stock.service.js';
import { canSeeTotals } from './suppliers.service.js';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const PAGE_SIZE = 20;
/** Foto achicada por la web o PDF de la ficha */
export const MAX_PURCHASE_FILE_BYTES = 5 * 1024 * 1024;

export interface UploadedPurchaseFile {
  buffer: Buffer;
  size: number;
}

export interface PurchaseSummary {
  id: number;
  number: number;
  code: string;
  supplier: { id: number; name: string; ruc: string | null };
  docType: PurchaseDocType;
  docNumber: string;
  issuedAt: string;
  createdAt: Date;
  status: PurchaseStatus;
  lines: number;
  subtotal: number;
  igv: number;
  total: number;
  hasFile: boolean;
}

export interface PurchaseLineView {
  id: number;
  product: {
    id: number;
    name: string;
    baseUnit: string;
    controlled: boolean;
  };
  presentation: { id: number; name: string; factor: number };
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: number;
  igv: number;
  total: number;
  batch: {
    id: number;
    lotNumber: string | null;
    expiresAt: string | null;
    /** Unidades mínimas que entraron y las que quedan */
    initialQuantity: number;
    quantity: number;
    unitCost: number | null;
  };
}

export interface PurchaseDetail extends PurchaseSummary {
  pricesIncludeIgv: boolean;
  notes: string | null;
  createdBy: { id: number; fullName: string };
  voidedAt: Date | null;
  voidedBy: { id: number; fullName: string } | null;
  voidReason: string | null;
  file: { mime: string; size: number } | null;
  lineItems: PurchaseLineView[];
  /** Nada se usó todavía: se puede anular */
  canVoid: boolean;
  /** Insumos que se descontaron de esta compra al recibirla */
  settledShortages?: number;
}

export interface PurchaseListResult {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Total comprado con los filtros (sin anuladas): solo para el administrador */
  summary?: { count: number; subtotal: number; igv: number; total: number };
}

const SUMMARY_SELECT = {
  id: true,
  number: true,
  docType: true,
  docNumber: true,
  issuedAt: true,
  createdAt: true,
  status: true,
  subtotal: true,
  igv: true,
  total: true,
  supplier: { select: { id: true, name: true, ruc: true } },
  file: { select: { id: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.PurchaseSelect;

type SummaryRow = Prisma.PurchaseGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toSummary(r: SummaryRow): PurchaseSummary {
  return {
    id: r.id,
    number: r.number,
    code: purchaseCode(r.number),
    supplier: r.supplier,
    docType: r.docType,
    docNumber: r.docNumber,
    issuedAt: fromDbDate(r.issuedAt)!,
    createdAt: r.createdAt,
    status: r.status,
    lines: r._count.lines,
    subtotal: Number(r.subtotal),
    igv: Number(r.igv),
    total: Number(r.total),
    hasFile: !!r.file,
  };
}

export const DOC_LABELS: Record<PurchaseDocType, string> = {
  FACTURA: 'Factura',
  BOLETA: 'Boleta',
  GUIA: 'Guía de remisión',
  OTRO: 'Otro',
};

const dmy = (day: string) => day.split('-').reverse().join('/');

/**
 * Compras: la ficha del proveedor pasada al sistema. Cada línea es un lote nuevo (FEFO, kardex y
 * margen siguen igual). El stock solo se toca por StockService.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async list(
    clinicId: number,
    role: AuthUser['role'],
    query: ListPurchasesQuery,
  ): Promise<PurchaseListResult> {
    const page = query.page ?? 1;
    const where: Prisma.PurchaseWhereInput = { clinicId };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;
    if (query.from || query.to)
      where.issuedAt = {
        ...(query.from ? { gte: toDbDate(query.from) } : {}),
        ...(query.to ? { lte: toDbDate(query.to) } : {}),
      };
    const raw = (query.q ?? '').trim();
    if (raw) {
      const term = normalizeSearch(raw);
      const code = /^\s*co\s*-?\s*0*(\d{1,9})\s*$/i.exec(raw);
      where.OR = [
        { docKey: { contains: docKeyOf(raw) } },
        { docNumber: { contains: raw, mode: 'insensitive' } },
        ...(term ? [{ supplier: { nameSearch: { contains: term } } }] : []),
        ...(/^\d{3,11}$/.test(raw)
          ? [{ supplier: { ruc: { startsWith: raw } } }]
          : []),
        ...(term
          ? [
              {
                lines: {
                  some: { product: { nameSearch: { contains: term } } },
                },
              },
            ]
          : []),
        ...(code ? [{ number: Number(code[1]) }] : []),
      ];
    }
    const [rows, total, sums] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: SUMMARY_SELECT,
      }),
      this.prisma.purchase.count({ where }),
      this.prisma.purchase.aggregate({
        where: { AND: [where, { status: 'RECEIVED' }] },
        _count: { _all: true },
        _sum: { subtotal: true, igv: true, total: true },
      }),
    ]);
    return {
      items: rows.map(toSummary),
      total,
      page,
      pageSize: PAGE_SIZE,
      ...(canSeeTotals(role)
        ? {
            summary: {
              count: sums._count._all,
              subtotal: Number(sums._sum.subtotal ?? 0),
              igv: Number(sums._sum.igv ?? 0),
              total: Number(sums._sum.total ?? 0),
            },
          }
        : {}),
    };
  }

  async get(clinicId: number, id: number): Promise<PurchaseDetail> {
    const row = await this.prisma.purchase.findFirst({
      where: { id, clinicId },
      select: {
        ...SUMMARY_SELECT,
        pricesIncludeIgv: true,
        notes: true,
        voidedAt: true,
        voidReason: true,
        createdBy: { select: { id: true, fullName: true } },
        voidedBy: { select: { id: true, fullName: true } },
        file: { select: { id: true, mime: true, size: true } },
        lines: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            description: true,
            quantity: true,
            unitPrice: true,
            taxable: true,
            igv: true,
            total: true,
            product: {
              select: {
                id: true,
                name: true,
                baseUnit: true,
                controlled: true,
              },
            },
            presentation: { select: { id: true, name: true, factor: true } },
            batch: {
              select: {
                id: true,
                lotNumber: true,
                expiresAt: true,
                quantity: true,
                initialQuantity: true,
                unitCost: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('La compra no existe');
    const lineItems: PurchaseLineView[] = row.lines.map((l) => ({
      id: l.id,
      product: l.product,
      presentation: {
        ...l.presentation,
        factor: Number(l.presentation.factor),
      },
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxable: Number(l.taxable),
      igv: Number(l.igv),
      total: Number(l.total),
      batch: {
        id: l.batch.id,
        lotNumber: l.batch.lotNumber,
        expiresAt: fromDbDate(l.batch.expiresAt),
        quantity: Number(l.batch.quantity),
        initialQuantity: Number(l.batch.initialQuantity),
        unitCost: l.batch.unitCost === null ? null : Number(l.batch.unitCost),
      },
    }));
    return {
      ...toSummary(row),
      pricesIncludeIgv: row.pricesIncludeIgv,
      notes: row.notes,
      createdBy: row.createdBy,
      voidedAt: row.voidedAt,
      voidedBy: row.voidedBy,
      voidReason: row.voidReason,
      file: row.file ? { mime: row.file.mime, size: row.file.size } : null,
      lineItems,
      canVoid:
        row.status === 'RECEIVED' &&
        lineItems.every((l) => l.batch.quantity === l.batch.initialQuantity),
    };
  }

  /** Último costo sin IGV por unidad mínima del producto (para comparar al llenar la ficha) */
  async lastCost(
    clinicId: number,
    productId: number,
  ): Promise<{
    unitCost: number;
    supplier: string | null;
    receivedAt: Date;
  } | null> {
    const batch = await this.prisma.productBatch.findFirst({
      where: {
        clinicId,
        productId,
        unitCost: { not: null },
        // Una bonificación (costo 0) no es "el último costo"
        NOT: { unitCost: 0 },
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      select: { unitCost: true, supplier: true, receivedAt: true },
    });
    if (!batch) return null;
    return {
      unitCost: Number(batch.unitCost),
      supplier: batch.supplier,
      receivedAt: batch.receivedAt,
    };
  }

  async create(
    actor: AuthUser,
    dto: CreatePurchaseDto,
    ip?: string,
  ): Promise<PurchaseDetail> {
    const today = await clinicToday(this.prisma, actor.clinicId);
    const supplier = await this.checkHeader(actor.clinicId, dto, today);
    const docKey = docKeyOf(dto.docNumber);
    await this.ensureNotRepeated(actor.clinicId, dto, docKey);

    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, clinicId: actor.clinicId },
      select: {
        id: true,
        name: true,
        active: true,
        igv: true,
        tracksExpiry: true,
        controlled: true,
        presentations: { select: { id: true, name: true, factor: true } },
      },
    });

    // Validar y calcular cada línea antes de tocar el stock
    const lines = dto.lines.map((line, index) => {
      const n = index + 1;
      const product = products.find((p) => p.id === line.productId);
      if (!product)
        throw new BadRequestException(`Línea ${n}: el producto no existe`);
      if (!product.active)
        throw new BadRequestException(
          `Línea ${n}: ${product.name} está inactivo. Actívalo antes de ingresar stock`,
        );
      const presentation = product.presentations.find(
        (p) => p.id === line.presentationId,
      );
      if (!presentation)
        throw new BadRequestException(
          `Línea ${n}: elige una presentación de ${product.name}`,
        );
      const lotNumber = line.lotNumber ?? null;
      if ((product.tracksExpiry || product.controlled) && !lotNumber)
        throw new BadRequestException(
          `Línea ${n}: ingresa el lote de ${product.name}`,
        );
      let expiresAt: string | null = null;
      if (product.tracksExpiry) {
        if (!line.expiresAt)
          throw new BadRequestException(
            `Línea ${n}: ingresa el vencimiento de ${product.name}`,
          );
        if (fromDbDate(toDbDate(line.expiresAt)) !== line.expiresAt)
          throw new BadRequestException(
            `Línea ${n}: la fecha de vencimiento no es válida`,
          );
        if (line.expiresAt < today)
          throw new BadRequestException(
            `Línea ${n}: ese lote de ${product.name} ya está vencido`,
          );
        expiresAt = line.expiresAt;
      }
      const amounts = purchaseLineAmounts({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        pricesIncludeIgv: dto.pricesIncludeIgv,
        affectation: product.igv,
      });
      const units = new D(line.quantity).times(presentation.factor);
      return {
        product,
        presentation,
        line,
        lotNumber,
        expiresAt,
        amounts,
        units,
        unitCost: unitCostOf(amounts.taxable, units),
      };
    });

    const subtotal = lines.reduce(
      (s, l) => s.plus(l.amounts.taxable),
      new D(0),
    );
    const igv = lines.reduce((s, l) => s.plus(l.amounts.igv), new D(0));

    let settled = 0;
    const purchaseId = await this.prisma
      .$transaction(async (tx) => {
        const number = await reserveNumbers(tx, actor.clinicId, 'purchase');
        const purchase = await tx.purchase.create({
          data: {
            clinicId: actor.clinicId,
            number,
            supplierId: supplier.id,
            docType: dto.docType,
            docNumber: dto.docNumber,
            docKey,
            issuedAt: toDbDate(dto.issuedAt),
            pricesIncludeIgv: dto.pricesIncludeIgv,
            subtotal: round2(subtotal),
            igv: round2(igv),
            total: round2(subtotal.plus(igv)),
            notes: dto.notes ?? null,
            createdById: actor.id,
          },
          select: { id: true },
        });
        const reason = `Compra ${purchaseCode(number)} · ${dto.docNumber} · ${supplier.name}`;
        // Por producto, para bloquear siempre en el mismo orden (dos compras a la vez no se traban)
        const ordered = lines
          .map((l, i) => ({ ...l, i }))
          .sort((a, b) => a.product.id - b.product.id || a.i - b.i);
        const batchOf = new Map<number, number>();
        for (const l of ordered) {
          const { batchId } = await this.stock.receive(tx, {
            clinicId: actor.clinicId,
            productId: l.product.id,
            userId: actor.id,
            quantity: l.units,
            lotNumber: l.lotNumber,
            expiresAt: l.expiresAt,
            unitCost: l.unitCost,
            supplier: supplier.name,
            documentNumber: dto.docNumber,
            supplierId: supplier.id,
            purchaseId: purchase.id,
            reason,
          });
          batchOf.set(l.i, batchId);
        }
        await tx.purchaseLine.createMany({
          data: lines.map((l, i) => ({
            purchaseId: purchase.id,
            productId: l.product.id,
            presentationId: l.presentation.id,
            batchId: batchOf.get(i)!,
            description: `${l.product.name} · ${l.presentation.name}`.slice(
              0,
              200,
            ),
            quantity: new D(l.line.quantity),
            unitPrice: new D(l.line.unitPrice),
            taxable: l.amounts.taxable,
            igv: l.amounts.igv,
            total: l.amounts.total,
          })),
        });
        if (dto.settleShortages)
          settled = await this.settleShortages(
            tx,
            actor,
            productIds,
            today,
            number,
          );
        return purchase.id;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Esta ficha de compra ya se registró (mismo proveedor, tipo y número)',
          );
        throw error;
      });

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'purchase.create',
      entity: 'purchase',
      entityId: purchaseId,
      ip,
      data: {
        supplier: supplier.name,
        doc: `${DOC_LABELS[dto.docType]} ${dto.docNumber}`,
        lines: lines.length,
        total: Number(round2(subtotal.plus(igv))),
        settledShortages: settled,
      },
    });
    const detail = await this.get(actor.clinicId, purchaseId);
    return { ...detail, settledShortages: settled };
  }

  /** Corrige el comprobante (llegó la factura después de la guía, se eligió otro proveedor). El stock no cambia. */
  async update(
    actor: AuthUser,
    id: number,
    dto: UpdatePurchaseDto,
    ip?: string,
  ): Promise<PurchaseDetail> {
    const current = await this.prisma.purchase.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: {
        status: true,
        docType: true,
        docNumber: true,
        supplierId: true,
      },
    });
    if (!current) throw new NotFoundException('La compra no existe');
    if (current.status === 'VOIDED')
      throw new ConflictException('La compra está anulada');
    const today = await clinicToday(this.prisma, actor.clinicId);
    const supplier = await this.checkHeader(actor.clinicId, dto, today);
    const docKey = docKeyOf(dto.docNumber);
    await this.ensureNotRepeated(actor.clinicId, dto, docKey, id);
    await this.prisma
      .$transaction([
        this.prisma.purchase.update({
          where: { id },
          data: {
            supplierId: supplier.id,
            docType: dto.docType,
            docNumber: dto.docNumber,
            docKey,
            issuedAt: toDbDate(dto.issuedAt),
            notes: dto.notes ?? null,
          },
        }),
        this.prisma.productBatch.updateMany({
          where: { clinicId: actor.clinicId, purchaseId: id },
          data: {
            supplierId: supplier.id,
            supplier: supplier.name,
            documentNumber: dto.docNumber,
          },
        }),
      ])
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('Esa ficha de compra ya está registrada');
        throw error;
      });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'purchase.update',
      entity: 'purchase',
      entityId: id,
      ip,
      data: {
        before: `${DOC_LABELS[current.docType]} ${current.docNumber}`,
        after: `${DOC_LABELS[dto.docType]} ${dto.docNumber}`,
        supplierChanged: current.supplierId !== supplier.id,
      },
    });
    return this.get(actor.clinicId, id);
  }

  /** Anula la compra si nada se usó todavía: el stock que entró sale con un movimiento propio. */
  async void(
    actor: AuthUser,
    id: number,
    reason: string,
    ip?: string,
  ): Promise<PurchaseDetail> {
    const row = await this.prisma.purchase.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: {
        number: true,
        status: true,
        createdById: true,
        docNumber: true,
        lines: { select: { productId: true, batchId: true } },
      },
    });
    if (!row) throw new NotFoundException('La compra no existe');
    if (actor.role !== 'ADMIN' && row.createdById !== actor.id)
      throw new ForbiddenException(
        'Solo quien registró la compra o el administrador pueden anularla',
      );
    if (row.status === 'VOIDED')
      throw new ConflictException('La compra ya estaba anulada');

    await this.prisma.$transaction(async (tx) => {
      // Vuelve a mirar el estado con la fila bloqueada: dos anulaciones a la vez no pasan
      const [locked] = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`
        SELECT status::text FROM purchases WHERE id = ${id} FOR UPDATE`);
      if (locked?.status !== 'RECEIVED')
        throw new ConflictException('La compra ya estaba anulada');
      const ordered = [...row.lines].sort(
        (a, b) => a.productId - b.productId || a.batchId - b.batchId,
      );
      for (const line of ordered)
        await this.stock.voidReceipt(tx, {
          clinicId: actor.clinicId,
          productId: line.productId,
          batchId: line.batchId,
          userId: actor.id,
          reason: `Compra ${purchaseCode(row.number)} anulada: ${reason}`,
        });
      await tx.purchase.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedById: actor.id,
          voidReason: reason,
        },
      });
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'purchase.void',
      entity: 'purchase',
      entityId: id,
      ip,
      data: { code: purchaseCode(row.number), doc: row.docNumber, reason },
    });
    return this.get(actor.clinicId, id);
  }

  async uploadFile(
    actor: AuthUser,
    id: number,
    file: UploadedPurchaseFile | undefined,
    ip?: string,
  ): Promise<{ mime: string; size: number }> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Elige la foto o el PDF de la ficha');
    const mime = detectAttachmentType(file.buffer);
    if (!mime)
      throw new BadRequestException('Sube una foto (JPG, PNG o WEBP) o un PDF');
    const exists = await this.prisma.purchase.count({
      where: { id, clinicId: actor.clinicId },
    });
    if (!exists) throw new NotFoundException('La compra no existe');
    const data = new Uint8Array(file.buffer);
    await this.prisma.purchaseFile.upsert({
      where: { purchaseId: id },
      create: {
        purchaseId: id,
        mime,
        size: data.length,
        data,
        createdById: actor.id,
      },
      update: { mime, size: data.length, data, createdById: actor.id },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'purchase.file',
      entity: 'purchase',
      entityId: id,
      ip,
      data: { mime, size: data.length },
    });
    return { mime, size: data.length };
  }

  async file(
    clinicId: number,
    id: number,
  ): Promise<{ data: Buffer; mime: string; fileName: string }> {
    const row = await this.prisma.purchaseFile.findFirst({
      where: { purchaseId: id, purchase: { clinicId } },
      select: {
        mime: true,
        data: true,
        purchase: { select: { number: true } },
      },
    });
    if (!row)
      throw new NotFoundException('La compra no tiene foto de la ficha');
    const ext = row.mime === 'application/pdf' ? 'pdf' : row.mime.split('/')[1];
    return {
      data: Buffer.from(row.data),
      mime: row.mime,
      fileName: `ficha-${purchaseCode(row.purchase.number)}.${ext}`,
    };
  }

  async removeFile(actor: AuthUser, id: number, ip?: string): Promise<void> {
    const removed = await this.prisma.purchaseFile.deleteMany({
      where: { purchaseId: id, purchase: { clinicId: actor.clinicId } },
    });
    if (!removed.count)
      throw new NotFoundException('La compra no tiene foto de la ficha');
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'purchase.file_remove',
      entity: 'purchase',
      entityId: id,
      ip,
    });
  }

  /** Registro de compras para el contador: comprobantes, por proveedor y el detalle. Sin anuladas. */
  async excel(clinicId: number, from: string, to: string): Promise<Buffer> {
    if (from > to)
      throw new BadRequestException('La fecha inicial es posterior a la final');
    const rows = await this.prisma.purchase.findMany({
      where: {
        clinicId,
        status: 'RECEIVED',
        issuedAt: { gte: toDbDate(from), lte: toDbDate(to) },
      },
      orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
      select: {
        number: true,
        docType: true,
        docNumber: true,
        issuedAt: true,
        subtotal: true,
        igv: true,
        total: true,
        supplier: { select: { id: true, name: true, ruc: true } },
        lines: {
          orderBy: { id: 'asc' },
          select: {
            description: true,
            quantity: true,
            unitPrice: true,
            taxable: true,
            igv: true,
            total: true,
            batch: { select: { lotNumber: true, expiresAt: true } },
          },
        },
      },
    });
    const book = new ExcelJS.Workbook();
    const money = '#,##0.00';
    const title = `Compras del ${dmy(from)} al ${dmy(to)}`;

    const docs = book.addWorksheet('Compras');
    docs.addRow([title]).font = { bold: true, size: 13 };
    docs.addRow(['Sin las compras anuladas. Montos en soles.']);
    docs.addRow([]);
    docs.addRow([
      'Fecha',
      'Tipo',
      'Serie y número',
      'RUC',
      'Proveedor',
      'Valor sin IGV',
      'IGV',
      'Total',
      'N.º interno',
    ]).font = { bold: true };
    for (const r of rows) {
      const row = docs.addRow([
        dmy(fromDbDate(r.issuedAt)!),
        DOC_LABELS[r.docType],
        r.docNumber,
        r.supplier.ruc ?? '',
        r.supplier.name,
        Number(r.subtotal),
        Number(r.igv),
        Number(r.total),
        purchaseCode(r.number),
      ]);
      for (const c of [6, 7, 8]) row.getCell(c).numFmt = money;
    }
    const sum = (k: 'subtotal' | 'igv' | 'total') =>
      rows.reduce((s, r) => s.plus(r[k]), new D(0)).toNumber();
    const totalRow = docs.addRow([
      'Total',
      '',
      '',
      '',
      `${rows.length} ${rows.length === 1 ? 'compra' : 'compras'}`,
      sum('subtotal'),
      sum('igv'),
      sum('total'),
    ]);
    totalRow.font = { bold: true };
    for (const c of [6, 7, 8]) totalRow.getCell(c).numFmt = money;
    docs.columns = [12, 18, 18, 14, 36, 15, 12, 14, 12].map((width) => ({
      width,
    }));

    const bySupplier = book.addWorksheet('Por proveedor');
    bySupplier.addRow([title]).font = { bold: true, size: 13 };
    bySupplier.addRow([]);
    bySupplier.addRow([
      'RUC',
      'Proveedor',
      'Compras',
      'Valor sin IGV',
      'IGV',
      'Total',
    ]).font = { bold: true };
    const groups = new Map<
      number,
      {
        ruc: string;
        name: string;
        n: number;
        subtotal: Decimal;
        igv: Decimal;
        total: Decimal;
      }
    >();
    for (const r of rows) {
      const g = groups.get(r.supplier.id) ?? {
        ruc: r.supplier.ruc ?? '',
        name: r.supplier.name,
        n: 0,
        subtotal: new D(0),
        igv: new D(0),
        total: new D(0),
      };
      g.n += 1;
      g.subtotal = g.subtotal.plus(r.subtotal);
      g.igv = g.igv.plus(r.igv);
      g.total = g.total.plus(r.total);
      groups.set(r.supplier.id, g);
    }
    for (const g of [...groups.values()].sort((a, b) => b.total.cmp(a.total))) {
      const row = bySupplier.addRow([
        g.ruc,
        g.name,
        g.n,
        g.subtotal.toNumber(),
        g.igv.toNumber(),
        g.total.toNumber(),
      ]);
      for (const c of [4, 5, 6]) row.getCell(c).numFmt = money;
    }
    bySupplier.columns = [14, 36, 10, 15, 12, 14].map((width) => ({ width }));

    const detail = book.addWorksheet('Detalle');
    detail.addRow([title]).font = { bold: true, size: 13 };
    detail.addRow([]);
    detail.addRow([
      'Fecha',
      'Comprobante',
      'Proveedor',
      'Producto y presentación',
      'Cantidad',
      'Precio en la ficha',
      'Lote',
      'Vence',
      'Valor sin IGV',
      'IGV',
      'Total',
    ]).font = { bold: true };
    for (const r of rows)
      for (const l of r.lines) {
        const expires = fromDbDate(l.batch.expiresAt);
        const row = detail.addRow([
          dmy(fromDbDate(r.issuedAt)!),
          r.docNumber,
          r.supplier.name,
          l.description,
          Number(l.quantity),
          Number(l.unitPrice),
          l.batch.lotNumber ?? '',
          expires ? dmy(expires) : '',
          Number(l.taxable),
          Number(l.igv),
          Number(l.total),
        ]);
        for (const c of [6, 9, 10, 11]) row.getCell(c).numFmt = money;
      }
    detail.columns = [12, 16, 28, 40, 10, 14, 12, 12, 14, 11, 13].map(
      (width) => ({
        width,
      }),
    );

    return Buffer.from(await book.xlsx.writeBuffer());
  }

  /** Proveedor activo de la clínica y fecha del comprobante que no sea futura */
  private async checkHeader(
    clinicId: number,
    dto: PurchaseHeaderDto,
    today: string,
  ): Promise<{ id: number; name: string }> {
    if (fromDbDate(toDbDate(dto.issuedAt)) !== dto.issuedAt)
      throw new BadRequestException('La fecha del comprobante no es válida');
    if (dto.issuedAt > today)
      throw new BadRequestException(
        'La fecha del comprobante no puede ser futura',
      );
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, clinicId },
      select: { id: true, name: true, active: true },
    });
    if (!supplier) throw new BadRequestException('El proveedor no existe');
    if (!supplier.active)
      throw new BadRequestException(
        'El proveedor está inactivo: actívalo en Proveedores',
      );
    return supplier;
  }

  /** La misma ficha del mismo proveedor no entra dos veces */
  private async ensureNotRepeated(
    clinicId: number,
    dto: PurchaseHeaderDto,
    docKey: string,
    exceptId?: number,
  ): Promise<void> {
    const other = await this.prisma.purchase.findFirst({
      where: {
        clinicId,
        supplierId: dto.supplierId,
        docType: dto.docType,
        docKey,
        status: 'RECEIVED',
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { number: true, createdAt: true },
    });
    if (other)
      throw new ConflictException(
        `Esta ficha ya se registró como ${purchaseCode(other.number)} el ${other.createdAt.toLocaleDateString(
          'es-PE',
          { timeZone: 'America/Lima' },
        )}`,
      );
  }

  /**
   * Los insumos que un servicio usó sin stock se descuentan ahora que llegó la mercadería: el
   * movimiento queda ligado al cargo (si el cargo se anula, vuelve). Lo que todavía no alcance
   * sigue como alerta, con la cantidad que falta.
   */
  private async settleShortages(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    productIds: number[],
    today: string,
    number: number,
  ): Promise<number> {
    const open = await tx.stockShortage.findMany({
      where: {
        clinicId: actor.clinicId,
        productId: { in: productIds },
        resolvedAt: null,
      },
      orderBy: [{ productId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        productId: true,
        quantity: true,
        chargeId: true,
        charge: { select: { description: true } },
      },
    });
    let settled = 0;
    const now = new Date();
    for (const s of open) {
      const { missing } = await this.stock.deductAvailable(tx, {
        clinicId: actor.clinicId,
        productId: s.productId,
        quantity: s.quantity,
        type: 'TREATMENT',
        userId: actor.id,
        today,
        reason: `Usado sin stock en ${s.charge.description} (regularizado con ${purchaseCode(number)})`,
        refType: 'charge',
        refId: s.chargeId,
      });
      if (missing.isZero()) {
        await tx.stockShortage.update({
          where: { id: s.id },
          data: {
            resolvedAt: now,
            resolvedById: actor.id,
            resolution: `Descontado de la compra ${purchaseCode(number)}`,
          },
        });
        settled += 1;
      } else if (!missing.equals(s.quantity)) {
        await tx.stockShortage.update({
          where: { id: s.id },
          data: { quantity: missing },
        });
      }
    }
    return settled;
  }
}
