import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  DocumentType,
  IgvAffectation,
} from '../generated/prisma/enums.js';
import { round2 } from '../common/money/igv.js';
import type { DocumentLine, DocumentTotals } from './billing.types.js';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Lo que se pagó de cada cargo en un cobro. */
export interface PaidCharge {
  amount: Decimal;
  charge: {
    id: number;
    description: string;
    quantity: Decimal;
    total: Decimal;
    taxableAmount: Decimal;
    igvAmount: Decimal;
    igvAffectation: IgvAffectation;
    igvRate: Decimal;
    sunatUnit: string;
    productId: number | null;
    careServiceId: number | null;
  };
}

/**
 * Líneas del comprobante a partir de lo cobrado. Un cargo pagado completo sale tal cual (con su
 * descuento ya aplicado en el valor unitario). Un pago a cuenta sale como una línea por el monto
 * pagado, con su base e IGV proporcionales; el saldo irá en el comprobante del siguiente pago.
 */
export function buildLines(paid: PaidCharge[]): {
  lines: DocumentLine[];
  totals: DocumentTotals;
} {
  const lines = paid
    .filter((p) => p.amount.gt(0))
    .map(({ amount, charge }): DocumentLine => {
      const full = amount.equals(charge.total);
      const quantity = full ? charge.quantity : new D(1);
      const total = amount;
      const taxable = full
        ? charge.taxableAmount
        : charge.igvAffectation === 'TAXED'
          ? round2(amount.dividedBy(new D(1).plus(charge.igvRate)))
          : amount;
      const igv = total.minus(taxable);
      return {
        code: charge.productId
          ? `P${charge.productId}`
          : charge.careServiceId
            ? `S${charge.careServiceId}`
            : `C${charge.id}`,
        description: (full
          ? charge.description
          : `${charge.description} (pago a cuenta)`
        ).slice(0, 250),
        unit: charge.sunatUnit,
        quantity: quantity.toNumber(),
        unitValue: taxable.dividedBy(quantity).toDecimalPlaces(10).toString(),
        unitPrice: total.dividedBy(quantity).toDecimalPlaces(10).toString(),
        taxable: taxable.toNumber(),
        igv: igv.toNumber(),
        total: total.toNumber(),
        affectation: charge.igvAffectation,
      };
    });
  return { lines, totals: sumLines(lines) };
}

export function sumLines(lines: DocumentLine[]): DocumentTotals {
  const sum = (pick: (l: DocumentLine) => number, when?: IgvAffectation) =>
    lines
      .filter((l) => !when || l.affectation === when)
      .reduce((acc, l) => acc.plus(pick(l)), new D(0))
      .toNumber();
  return {
    taxed: sum((l) => l.taxable, 'TAXED'),
    exempt: sum((l) => l.taxable, 'EXEMPT'),
    unaffected: sum((l) => l.taxable, 'UNAFFECTED'),
    igv: sum((l) => l.igv),
    total: sum((l) => l.total),
  };
}

/** Catálogo 06 de SUNAT a partir del documento del cliente. */
const DOC_CODES: Record<DocumentType, string> = {
  DNI: '1',
  CE: '4',
  RUC: '6',
  PASSPORT: '7',
};

/** Monto desde el que una boleta debe identificar al cliente (Res. 340-2017/SUNAT). */
export const BOLETA_ID_THRESHOLD = 700;

/** Comprador escrito en el cobro (ya validado por BuyerDto). */
export interface BuyerInput {
  docType: 'RUC' | 'DNI';
  docNumber: string;
  name: string;
  address?: string | null;
  email?: string | null;
}

/**
 * A nombre de quién sale el comprobante. Factura: lo escrito en el cobro → el RUC del cliente →
 * sus datos de facturación guardados. Boleta: lo escrito en el cobro → su documento → "clientes
 * varios" (hasta S/ 700; SUNAT pide DNI cuando supera ese monto).
 */
export function customerFor(
  kind: 'BOLETA' | 'FACTURA',
  client: {
    name: string;
    docType: DocumentType | null;
    docNumber: string | null;
    address: string | null;
    email?: string | null;
    walkIn: boolean;
    invoiceRuc?: string | null;
    invoiceName?: string | null;
    invoiceAddress?: string | null;
    invoiceEmail?: string | null;
  },
  total: number,
  buyer?: BuyerInput | null,
) {
  if (buyer) {
    if (kind === 'FACTURA' && buyer.docType !== 'RUC')
      throw new BadRequestException('La factura lleva el RUC del comprador');
    return {
      docType: buyer.docType === 'RUC' ? '6' : '1',
      docNumber: buyer.docNumber,
      name: buyer.name,
      address: buyer.address?.trim() || null,
      email: buyer.email?.trim() || null,
    };
  }
  if (kind === 'FACTURA') {
    if (!client.walkIn && client.docType === 'RUC' && client.docNumber)
      return {
        docType: '6',
        docNumber: client.docNumber,
        name: client.name,
        address: client.address,
        email: client.invoiceEmail ?? client.email ?? null,
      };
    if (!client.walkIn && client.invoiceRuc)
      return {
        docType: '6',
        docNumber: client.invoiceRuc,
        name: client.invoiceName || client.name,
        address: client.invoiceAddress ?? null,
        email: client.invoiceEmail ?? null,
      };
    throw new BadRequestException(
      'Para emitir factura escribe el RUC y la razón social del comprador',
    );
  }
  if (!client.walkIn && client.docType && client.docNumber)
    return {
      docType: DOC_CODES[client.docType],
      docNumber: client.docNumber,
      name: client.name,
      address: client.address,
      email: null,
    };
  if (total > BOLETA_ID_THRESHOLD)
    throw new BadRequestException(
      `Una boleta de más de S/ ${BOLETA_ID_THRESHOLD} lleva el DNI del comprador: escríbelo en el cobro`,
    );
  return {
    docType: '-',
    docNumber: '-',
    name: client.walkIn ? 'CLIENTES VARIOS' : client.name,
    address: null,
    email: null,
  };
}
