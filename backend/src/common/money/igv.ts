import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { IgvAffectation } from '../../generated/prisma/enums.js';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Tasa general del IGV (16 %) + IPM (2 %). Se guarda en cada cargo por si cambia. */
export const IGV_RATE = new D('0.18');

/** Redondeo comercial a céntimos, el mismo que espera SUNAT. */
export const round2 = (value: Decimal): Decimal =>
  value.toDecimalPlaces(2, D.ROUND_HALF_UP);

export interface LineAmounts {
  /** Cantidad × precio, antes del descuento */
  gross: Decimal;
  discount: Decimal;
  /** Lo que paga el cliente */
  total: Decimal;
  /** Valor de venta, sin IGV */
  taxable: Decimal;
  igv: Decimal;
  rate: Decimal;
}

/**
 * Montos de una línea con precio que ya incluye IGV (el precio de la etiqueta).
 * Única fuente de verdad: caja y comprobantes usan estos montos tal cual, sin recalcular.
 * Siempre se cumple taxable + igv = total, exacto al céntimo.
 */
export function lineAmounts(input: {
  quantity: Decimal | number | string;
  unitPrice: Decimal | number | string;
  discount?: Decimal | number | string | null;
  affectation: IgvAffectation;
}): LineAmounts {
  const quantity = new D(input.quantity);
  const unitPrice = new D(input.unitPrice);
  const discount = round2(new D(input.discount ?? 0));
  if (quantity.lte(0))
    throw new BadRequestException('La cantidad debe ser mayor a 0');
  if (unitPrice.lt(0) || discount.lt(0))
    throw new BadRequestException('Los montos no pueden ser negativos');

  const gross = round2(quantity.times(unitPrice));
  if (discount.gt(gross))
    throw new BadRequestException(
      'El descuento no puede ser mayor que el importe',
    );
  const total = gross.minus(discount);
  if (input.affectation !== 'TAXED')
    return {
      gross,
      discount,
      total,
      taxable: total,
      igv: new D(0),
      rate: new D(0),
    };

  const taxable = round2(total.dividedBy(IGV_RATE.plus(1)));
  return {
    gross,
    discount,
    total,
    taxable,
    igv: total.minus(taxable),
    rate: IGV_RATE,
  };
}

/** Porcentaje del descuento sobre el importe bruto (0 si el importe es 0). */
export function discountPercent(gross: Decimal, discount: Decimal): Decimal {
  return gross.isZero() ? new D(0) : discount.dividedBy(gross).times(100);
}
