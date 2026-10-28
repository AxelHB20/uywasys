import type { Prisma } from '../../generated/prisma/client.js';

/** Correlativos visibles por clínica. Las series SUNAT (B001, F001) se agregan en la Fase 4. */
export type SequenceKey = 'client' | 'pet' | 'sale_note';

/**
 * Reserva `count` números seguidos para la clínica y devuelve el primero.
 *
 * Debe llamarse dentro de la transacción que guarda los registros: el UPDATE bloquea la fila
 * del contador hasta el commit, así dos registros simultáneos nunca reciben el mismo número,
 * y si la transacción falla el número vuelve a quedar libre (sin huecos).
 */
export async function reserveNumbers(
  tx: Prisma.TransactionClient,
  clinicId: number,
  key: SequenceKey,
  count = 1,
): Promise<number> {
  if (count < 1) throw new Error('count debe ser mayor a 0');
  const [row] = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO "clinic_sequences" ("clinic_id", "key", "last_value")
    VALUES (${clinicId}, ${key}, ${count})
    ON CONFLICT ("clinic_id", "key")
    DO UPDATE SET "last_value" = "clinic_sequences"."last_value" + ${count}
    RETURNING "last_value"`;
  return row.last_value - count + 1;
}

/** C-00012 */
export const clientCode = (number: number) =>
  `C-${String(number).padStart(5, '0')}`;

/** HC-00045 */
export const petCode = (number: number) =>
  `HC-${String(number).padStart(5, '0')}`;

/** Reconoce "C-12", "c00012", "HC-45" o "hc 45" escritos en un buscador. */
export function parseRecordCode(
  text: string,
): { kind: 'client' | 'pet'; number: number } | null {
  const m = /^\s*(hc|c)\s*-?\s*0*(\d{1,9})\s*$/i.exec(text);
  if (!m) return null;
  const number = Number(m[2]);
  if (!number || number > 2_147_483_647) return null;
  return { kind: m[1].toLowerCase() === 'hc' ? 'pet' : 'client', number };
}
