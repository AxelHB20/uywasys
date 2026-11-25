import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Último costo sin IGV por unidad mínima de cada producto (la compra más reciente con costo;
 * una bonificación a costo 0 no cuenta). Lo que no se compró por el sistema no aparece.
 */
export async function lastUnitCosts(
  prisma: PrismaService,
  clinicId: number,
  productIds: number[],
): Promise<Map<number, number>> {
  if (!productIds.length) return new Map();
  const rows = await prisma.$queryRaw<
    { product_id: number; unit_cost: string }[]
  >`
    SELECT DISTINCT ON (product_id) product_id, unit_cost::text AS unit_cost
    FROM product_batches
    WHERE clinic_id = ${clinicId}
      AND product_id = ANY(${productIds}::int[])
      AND unit_cost IS NOT NULL AND unit_cost > 0
    ORDER BY product_id, received_at DESC, id DESC`;
  return new Map(rows.map((r) => [r.product_id, Number(r.unit_cost)]));
}
