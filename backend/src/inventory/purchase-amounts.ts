import { Prisma } from '../generated/prisma/client.js';
import type { IgvAffectation } from '../generated/prisma/enums.js';
import { IGV_RATE, round2 } from '../common/money/igv.js';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface PurchaseLineAmounts {
  /** Valor sin IGV de la línea: es lo que se reparte como costo del lote */
  taxable: Decimal;
  igv: Decimal;
  total: Decimal;
}

/**
 * Montos de una línea de la ficha de compra, vengan los precios con o sin IGV.
 * El costo del inventario se guarda siempre sin IGV (el margen se calcula sobre la venta sin IGV).
 * Lo exonerado o inafecto no lleva IGV aunque la ficha diga "con IGV".
 */
export function purchaseLineAmounts(input: {
  quantity: Decimal | number;
  unitPrice: Decimal | number;
  pricesIncludeIgv: boolean;
  affectation: IgvAffectation;
}): PurchaseLineAmounts {
  const amount = round2(new D(input.quantity).times(input.unitPrice));
  const taxed = input.affectation === 'TAXED';
  if (input.pricesIncludeIgv) {
    const taxable = taxed ? round2(amount.dividedBy(IGV_RATE.plus(1))) : amount;
    return { taxable, igv: amount.minus(taxable), total: amount };
  }
  const igv = taxed ? round2(amount.times(IGV_RATE)) : new D(0);
  return { taxable: amount, igv, total: amount.plus(igv) };
}

/** Costo sin IGV por unidad mínima: el valor de la línea entre las unidades que entraron */
export function unitCostOf(taxable: Decimal, units: Decimal): Decimal {
  return units.isZero()
    ? new D(0)
    : taxable.dividedBy(units).toDecimalPlaces(4);
}

/**
 * Clave para no registrar dos veces la misma ficha: "f001 - 000123" y "F001-123" son la misma.
 * Serie y número se separan por el guion o por el cambio de letras a números del final.
 */
export function docKeyOf(docNumber: string): string {
  const clean = docNumber.toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z0-9]*?)-?0*(\d+)$/.exec(clean);
  if (!m) return clean.slice(0, 30);
  const [, serie, number] = m;
  return (serie ? `${serie}-${number}` : number).slice(0, 30);
}
