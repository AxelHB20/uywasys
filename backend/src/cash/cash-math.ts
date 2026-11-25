import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PaymentMethod } from '../generated/prisma/enums.js';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};

/**
 * Medios con código de operación. Es opcional (el dueño no siempre lo tiene); los que
 * entran sin código se cuentan al cerrar la caja para revisarlos en la app.
 */
export const NEEDS_CODE: PaymentMethod[] = ['YAPE', 'PLIN', 'TRANSFER'];

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  tendered?: number | null;
  operationCode?: string | null;
}

export interface PaymentLine {
  method: PaymentMethod;
  amount: Decimal;
  tendered: Decimal | null;
  operationCode: string | null;
}

export const soles = (d: Decimal) => `S/ ${d.toFixed(2)}`;

/**
 * Revisa los medios de pago de un cobro: deben sumar exactamente lo que se cobra.
 * Solo el efectivo da vuelto (lo entregado menos lo que se aplica).
 */
export function checkPayments(
  payments: PaymentInput[],
  applied: Decimal,
): { lines: PaymentLine[]; change: Decimal } {
  if (!payments.length)
    throw new BadRequestException('Indica cómo paga el cliente');
  const methods = payments.map((p) => p.method);
  if (new Set(methods).size !== methods.length)
    throw new BadRequestException('Cada medio de pago va una sola vez');

  let change = new D(0);
  const lines = payments.map((p): PaymentLine => {
    const amount = new D(p.amount);
    if (amount.lte(0))
      throw new BadRequestException('Cada pago debe ser mayor a 0');
    const code = p.operationCode?.trim() || null;
    if (p.method === 'CASH') {
      const tendered = p.tendered == null ? amount : new D(p.tendered);
      if (tendered.lt(amount))
        throw new BadRequestException(
          `El efectivo recibido (${soles(tendered)}) no cubre ${soles(amount)}`,
        );
      change = tendered.minus(amount);
      return { method: p.method, amount, tendered, operationCode: null };
    }
    if (p.tendered != null)
      throw new BadRequestException('Solo el efectivo tiene vuelto');
    if (NEEDS_CODE.includes(p.method) && code && code.length < 4)
      throw new BadRequestException(
        `El código de ${METHOD_LABELS[p.method]} debe tener al menos 4 caracteres; si no lo tiene, déjalo vacío`,
      );
    return { method: p.method, amount, tendered: null, operationCode: code };
  });

  const sum = lines.reduce((acc, l) => acc.plus(l.amount), new D(0));
  if (!sum.equals(applied))
    throw new BadRequestException(
      `Los pagos suman ${soles(sum)} y el cobro es de ${soles(applied)}`,
    );
  return { lines, change };
}

/**
 * Reparte un monto entre los cargos en el orden recibido (del más antiguo al más nuevo):
 * cubre cada saldo antes de pasar al siguiente. Lo que no alcance queda como deuda.
 */
export function allocate(
  charges: { id: number; balance: Decimal }[],
  amount: Decimal,
): { chargeId: number; amount: Decimal }[] {
  const owed = charges.reduce((acc, c) => acc.plus(c.balance), new D(0));
  if (amount.lte(0))
    throw new BadRequestException('El monto a cobrar debe ser mayor a 0');
  if (amount.gt(owed))
    throw new ConflictException(
      `El monto (${soles(amount)}) supera lo que debe (${soles(owed)})`,
    );
  let left = amount;
  const result: { chargeId: number; amount: Decimal }[] = [];
  for (const charge of charges) {
    if (left.lte(0)) break;
    const take = D.min(left, charge.balance);
    if (take.lte(0)) continue;
    result.push({ chargeId: charge.id, amount: take });
    left = left.minus(take);
  }
  return result;
}

/** Arqueo: lo que debe haber en el cajón. Yape, tarjeta y demás no pasan por el cajón. */
export function expectedCash(input: {
  opening: Decimal;
  cashIn: Decimal;
  expenses: Decimal;
  cashRefunds: Decimal;
}): Decimal {
  return input.opening
    .plus(input.cashIn)
    .minus(input.expenses)
    .minus(input.cashRefunds);
}

/** NV-000123 */
export const saleNoteCode = (number: number) =>
  `NV-${String(number).padStart(6, '0')}`;
