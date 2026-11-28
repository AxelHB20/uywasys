import { Prisma } from '../generated/prisma/client.js';
import { soles } from '../cash/cash-math.js';

/**
 * "Pasa del 10 % en Consulta (máx. S/ 4.60): solo el administrador puede darlo". El límite va en
 * soles porque el descuento se escribe en soles.
 */
export function discountCapMessage(
  description: string,
  gross: Prisma.Decimal,
  maxDiscountPercent: Prisma.Decimal,
): string {
  const max = gross
    .times(maxDiscountPercent)
    .dividedBy(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  return `Pasa del ${Number(maxDiscountPercent)} % en ${description} (máx. ${soles(max)}): solo el administrador puede darlo`;
}
