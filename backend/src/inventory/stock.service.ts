import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { MovementType } from '../generated/prisma/enums.js';
import { toDbDate } from '../common/time/clinic-day.js';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface LockedProduct {
  id: number;
  name: string;
  category: string;
  baseUnit: string;
  controlled: boolean;
  totalStock: Decimal;
}

export interface DeductRequest {
  clinicId: number;
  productId: number;
  /** En unidad mínima, mayor a 0 */
  quantity: Decimal;
  type: Extract<MovementType, 'WASTE' | 'TREATMENT' | 'SALE'>;
  userId: number;
  /** AAAA-MM-DD de la clínica: los lotes vencidos antes de hoy no se usan */
  today: string;
  reason?: string | null;
  /** Descontar de un lote específico (frasco roto, lote vencido) */
  batchId?: number | null;
  /** Merma: puede sacar lotes vencidos (los primeros en salir) */
  includeExpired?: boolean;
  petId?: number | null;
  vetId?: number | null;
  prescriptionRef?: string | null;
  refType?: string | null;
  refId?: number | null;
}

export interface MovementLine {
  batchId: number | null;
  quantity: Decimal;
  balanceAfter: Decimal;
}

interface BatchRow {
  id: number;
  quantity: Decimal;
  expires_at: Date | null;
}

/**
 * Única puerta de entrada al stock. Caja, el módulo médico y las mermas llaman aquí:
 * la regla FEFO y el "nunca negativo" viven en un solo lugar.
 * Todas las operaciones deben correr dentro de una transacción (`prisma.$transaction`).
 */
@Injectable()
export class StockService {
  /**
   * Bloquea la fila del producto hasta que termine la transacción.
   * Dos operaciones sobre el mismo producto se atienden una detrás de otra.
   */
  async lockProduct(
    tx: Tx,
    clinicId: number,
    productId: number,
  ): Promise<LockedProduct> {
    const rows = await tx.$queryRaw<
      {
        id: number;
        name: string;
        category: string;
        base_unit: string;
        controlled: boolean;
        total_stock: Decimal | string;
      }[]
    >(Prisma.sql`
      SELECT id, name, category::text, base_unit::text, controlled, total_stock
      FROM products
      WHERE id = ${productId} AND clinic_id = ${clinicId}
      FOR UPDATE`);
    const row = rows[0];
    if (!row) throw new NotFoundException('El producto no existe');
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      baseUnit: row.base_unit,
      controlled: row.controlled,
      totalStock: new D(row.total_stock.toString()),
    };
  }

  /**
   * FEFO: descuenta primero del lote que vence antes y pasa al siguiente si hace falta.
   * Si no alcanza, responde 409 con lo disponible y no descuenta nada.
   */
  async deduct(tx: Tx, req: DeductRequest): Promise<MovementLine[]> {
    return (await this.take(tx, req, false)).lines;
  }

  /**
   * Como `deduct`, pero nunca falla por falta de stock: descuenta lo que haya (FEFO, sin vencidos)
   * y devuelve cuánto faltó. Lo usan los insumos de un servicio, que se cobra aunque el sistema
   * no tenga registrado el frasco (decisión 5 del plan).
   */
  async deductAvailable(
    tx: Tx,
    req: Omit<DeductRequest, 'batchId' | 'includeExpired'>,
  ): Promise<{ lines: MovementLine[]; missing: Decimal }> {
    return this.take(tx, req, true);
  }

  /**
   * Devuelve al mismo lote todo lo que salió con una referencia (por ejemplo, un cargo anulado).
   * Calcula el neto por lote con los movimientos de esa referencia, así llamarlo dos veces no
   * devuelve dos veces.
   */
  async restore(
    tx: Tx,
    req: {
      clinicId: number;
      refType: string;
      refId: number;
      userId: number;
      reason: string;
    },
  ): Promise<MovementLine[]> {
    const moves = await tx.stockMovement.findMany({
      where: { clinicId: req.clinicId, refType: req.refType, refId: req.refId },
      select: {
        productId: true,
        batchId: true,
        quantity: true,
        petId: true,
        vetId: true,
        prescriptionRef: true,
      },
      orderBy: { id: 'asc' },
    });
    // Neto por producto y lote: lo que salió menos lo que ya volvió
    const net = new Map<string, (typeof moves)[number] & { sum: Decimal }>();
    for (const m of moves) {
      const key = `${m.productId}:${m.batchId ?? ''}`;
      const current = net.get(key);
      const qty = new D(m.quantity.toString());
      if (current) current.sum = current.sum.plus(qty);
      else net.set(key, { ...m, sum: qty });
    }
    const byProduct = new Map<
      number,
      ((typeof moves)[number] & { sum: Decimal })[]
    >();
    for (const line of net.values()) {
      if (line.sum.gte(0) || line.batchId === null) continue;
      byProduct.set(line.productId, [
        ...(byProduct.get(line.productId) ?? []),
        line,
      ]);
    }

    const result: MovementLine[] = [];
    // Siempre en el mismo orden de productos, para no cruzar bloqueos con otra transacción
    for (const productId of [...byProduct.keys()].sort((x, y) => x - y)) {
      const product = await this.lockProduct(tx, req.clinicId, productId);
      let balance = product.totalStock;
      for (const line of byProduct.get(productId)!) {
        const back = line.sum.neg();
        await tx.productBatch.update({
          where: { id: line.batchId! },
          data: { quantity: { increment: back } },
        });
        balance = balance.plus(back);
        await tx.stockMovement.create({
          data: {
            clinicId: req.clinicId,
            productId,
            batchId: line.batchId,
            type: 'RETURN',
            quantity: back,
            balanceAfter: balance,
            reason: req.reason,
            userId: req.userId,
            petId: line.petId,
            vetId: line.vetId,
            prescriptionRef: line.prescriptionRef,
            refType: req.refType,
            refId: req.refId,
          },
        });
        result.push({
          batchId: line.batchId,
          quantity: back,
          balanceAfter: balance,
        });
      }
      await tx.product.update({
        where: { id: productId },
        data: { totalStock: balance },
      });
    }
    return result;
  }

  private async take(
    tx: Tx,
    req: DeductRequest,
    partial: boolean,
  ): Promise<{ lines: MovementLine[]; missing: Decimal }> {
    if (req.quantity.lte(0))
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    const product = await this.lockProduct(tx, req.clinicId, req.productId);
    const today = toDbDate(req.today);

    const batches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
      SELECT id, quantity, expires_at
      FROM product_batches
      WHERE product_id = ${req.productId}
        AND clinic_id = ${req.clinicId}
        AND quantity > 0
        ${req.batchId ? Prisma.sql`AND id = ${req.batchId}` : Prisma.empty}
      ORDER BY expires_at ASC NULLS LAST, id ASC
      FOR UPDATE`);

    const usable = batches.filter(
      (b) => req.includeExpired || !b.expires_at || b.expires_at >= today,
    );
    if (req.batchId && batches.length && !usable.length)
      throw new ConflictException(
        'Ese lote está vencido: solo se puede sacar como merma',
      );
    const available = usable.reduce(
      (sum, b) => sum.plus(b.quantity.toString()),
      new D(0),
    );
    if (!partial && available.lt(req.quantity))
      throw new ConflictException({
        message: `Stock insuficiente de ${product.name}: hay ${available.toNumber()} disponibles`,
        available: available.toNumber(),
      });

    let pending = req.quantity;
    let balance = product.totalStock;
    const lines: MovementLine[] = [];
    for (const batch of usable) {
      if (pending.lte(0)) break;
      const take = D.min(pending, new D(batch.quantity.toString()));
      await tx.productBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: take } },
      });
      balance = balance.minus(take);
      pending = pending.minus(take);
      lines.push({
        batchId: batch.id,
        quantity: take.neg(),
        balanceAfter: balance,
      });
    }
    if (!lines.length) return { lines, missing: pending };

    await tx.product.update({
      where: { id: req.productId },
      data: { totalStock: balance },
    });
    await tx.stockMovement.createMany({
      data: lines.map((line) => ({
        clinicId: req.clinicId,
        productId: req.productId,
        batchId: line.batchId,
        type: req.type,
        quantity: line.quantity,
        balanceAfter: line.balanceAfter,
        reason: req.reason ?? null,
        userId: req.userId,
        petId: req.petId ?? null,
        vetId: req.vetId ?? null,
        prescriptionRef: req.prescriptionRef ?? null,
        refType: req.refType ?? null,
        refId: req.refId ?? null,
      })),
    });
    return { lines, missing: pending };
  }

  /** Ingreso de un lote nuevo (compra) con su movimiento de kardex. */
  async receive(
    tx: Tx,
    req: {
      clinicId: number;
      productId: number;
      userId: number;
      quantity: Decimal;
      lotNumber: string | null;
      expiresAt: string | null;
      unitCost: Decimal | null;
      supplier: string | null;
      documentNumber: string | null;
      /** Motivo del kardex; por defecto "Compra <comprobante> · <proveedor>" */
      reason?: string;
    },
  ): Promise<{ batchId: number; balanceAfter: Decimal }> {
    const product = await this.lockProduct(tx, req.clinicId, req.productId);
    const balance = product.totalStock.plus(req.quantity);
    const batch = await tx.productBatch.create({
      data: {
        clinicId: req.clinicId,
        productId: req.productId,
        lotNumber: req.lotNumber,
        expiresAt: req.expiresAt ? toDbDate(req.expiresAt) : null,
        quantity: req.quantity,
        initialQuantity: req.quantity,
        unitCost: req.unitCost,
        supplier: req.supplier,
        documentNumber: req.documentNumber,
        createdById: req.userId,
      },
      select: { id: true },
    });
    await tx.product.update({
      where: { id: req.productId },
      data: { totalStock: balance },
    });
    await tx.stockMovement.create({
      data: {
        clinicId: req.clinicId,
        productId: req.productId,
        batchId: batch.id,
        type: 'PURCHASE',
        quantity: req.quantity,
        balanceAfter: balance,
        reason:
          req.reason ??
          (req.documentNumber
            ? `Compra ${req.documentNumber}${req.supplier ? ` · ${req.supplier}` : ''}`
            : (req.supplier ?? null)),
        userId: req.userId,
      },
    });
    return { batchId: batch.id, balanceAfter: balance };
  }

  /** Conteo físico: deja cada lote en lo contado y registra la diferencia. */
  async adjustCount(
    tx: Tx,
    req: {
      clinicId: number;
      productId: number;
      userId: number;
      reason: string;
      items: { batchId: number; counted: Decimal }[];
    },
  ): Promise<MovementLine[]> {
    const product = await this.lockProduct(tx, req.clinicId, req.productId);
    const ids = req.items.map((i) => i.batchId);
    const batches = await tx.$queryRaw<{ id: number; quantity: Decimal }[]>(
      Prisma.sql`
        SELECT id, quantity FROM product_batches
        WHERE product_id = ${req.productId} AND clinic_id = ${req.clinicId}
          AND id IN (${Prisma.join(ids)})
        FOR UPDATE`,
    );
    if (batches.length !== new Set(ids).size)
      throw new BadRequestException('Algún lote no pertenece a este producto');

    let balance = product.totalStock;
    const lines: MovementLine[] = [];
    for (const item of req.items) {
      if (item.counted.lt(0))
        throw new BadRequestException(
          'La cantidad contada no puede ser negativa',
        );
      const batch = batches.find((b) => b.id === item.batchId)!;
      const diff = item.counted.minus(batch.quantity.toString());
      if (diff.isZero()) continue;
      await tx.productBatch.update({
        where: { id: batch.id },
        data: { quantity: item.counted },
      });
      balance = balance.plus(diff);
      lines.push({ batchId: batch.id, quantity: diff, balanceAfter: balance });
    }
    if (!lines.length) return [];

    await tx.product.update({
      where: { id: req.productId },
      data: { totalStock: balance },
    });
    await tx.stockMovement.createMany({
      data: lines.map((line) => ({
        clinicId: req.clinicId,
        productId: req.productId,
        batchId: line.batchId,
        type: 'COUNT_ADJUST' as const,
        quantity: line.quantity,
        balanceAfter: line.balanceAfter,
        reason: req.reason,
        userId: req.userId,
      })),
    });
    return lines;
  }
}
