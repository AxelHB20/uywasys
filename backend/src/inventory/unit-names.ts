import type { BaseUnit } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { normalizeSearch } from '../common/text/search.js';

/** Unidades en que se cuenta un producto nuevo (se venden enteras) */
export const COUNTING_UNITS: BaseUnit[] = ['UNIT', 'TABLET', 'BOX', 'BOTTLE'];

/** Nombre de la presentación suelta para cada unidad */
export const UNIT_NAME: Record<BaseUnit, string> = {
  UNIT: 'Unidad',
  TABLET: 'Tableta',
  BOX: 'Caja',
  BOTTLE: 'Frasco',
  ML: 'ml',
  G: 'g',
};

/**
 * Al cambiar "Unidad" por "Frasco", la presentación que se llamaba "Unidad" pasa a "Frasco"
 * (si no hay ya una con ese nombre).
 */
export async function renameUnitPresentations(
  tx: Prisma.TransactionClient,
  productId: number,
  from: BaseUnit,
  to: BaseUnit,
): Promise<void> {
  const list = await tx.productPresentation.findMany({
    where: { productId },
    select: { id: true, name: true },
  });
  const target = UNIT_NAME[to];
  if (list.some((p) => normalizeSearch(p.name) === normalizeSearch(target)))
    return;
  const old = list.find(
    (p) => normalizeSearch(p.name) === normalizeSearch(UNIT_NAME[from]),
  );
  if (old)
    await tx.productPresentation.update({
      where: { id: old.id },
      data: { name: target },
    });
}

/**
 * La presentación "de 1" mal cargada en un producto sin ninguna que traiga 1: una sin número en el
 * nombre ("Frasco", "Unidad", "Tableta x1"), que casi siempre tiene el stock puesto en «Trae».
 * "Caja x 30" no cuenta: ese número es de verdad lo que trae.
 */
export function wrongBasePresentation<
  P extends { name: string; factor: number },
>(presentations: P[], baseUnit: BaseUnit): P | null {
  // En ml y g, "Por kilo = 1000" es una conversión de verdad
  if (!COUNTING_UNITS.includes(baseUnit)) return null;
  if (!presentations.length || presentations.some((p) => p.factor === 1))
    return null;
  const plain = presentations.filter(
    (p) => !/\d/.test(p.name.replace(/\bx\s*1\b/i, '')),
  );
  const unit = normalizeSearch(UNIT_NAME[baseUnit]);
  const named = plain.find((p) => {
    const n = normalizeSearch(p.name);
    return n.startsWith(unit) || /\bx\s*1\b/i.test(p.name);
  });
  // Si no se llama como la unidad, solo cuando es la única presentación (no hay con qué confundirla)
  return (
    named ??
    (presentations.length === 1 && plain.length === 1 ? plain[0] : null)
  );
}
