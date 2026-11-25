import { BASE_UNIT_LABELS, BaseUnit, ExpiryLevel } from '../../core/services/inventory.models';
import { BadgeTone } from '../ui/badge/badge.component';

/** Plural en español de la primera palabra: "Caja x 100" → "cajas", "Blíster x 10" → "blísteres". */
export function presentationWord(name: string, count: number): string {
  const word = (name.trim().split(/\s+/)[0] ?? name).toLowerCase();
  if (count === 1) return word;
  if (/[aeiouáéó]$/.test(word)) return `${word}s`;
  if (word.endsWith('z')) return `${word.slice(0, -1)}ces`;
  return `${word}es`;
}

export function unitLabel(unit: BaseUnit, quantity: number): string {
  const [one, many] = BASE_UNIT_LABELS[unit];
  return quantity === 1 ? one : many;
}

/** "1 500,5" con separadores peruanos, sin decimales innecesarios */
export function formatQty(value: number): string {
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 }).format(value);
}

/**
 * Stock legible a partir de las presentaciones:
 * 347 tabletas con "Caja x 100" y "Blíster x 10" → "3 cajas, 4 blísteres y 7 tabletas".
 */
export function readableStock(
  quantity: number,
  baseUnit: BaseUnit,
  presentations: { name: string; factor: number; active?: boolean }[],
): string {
  if (quantity <= 0) return 'Sin stock';
  const packs = [...presentations]
    .filter((p) => p.active !== false && p.factor > 1 && Number.isInteger(p.factor))
    .sort((a, b) => b.factor - a.factor)
    .filter((p, i, list) => list.findIndex((q) => q.factor === p.factor) === i);

  const parts: string[] = [];
  let rest = quantity;
  for (const pack of packs) {
    const count = Math.floor(rest / pack.factor);
    if (count > 0) {
      parts.push(`${count} ${presentationWord(pack.name, count)}`);
      rest = Math.round((rest - count * pack.factor) * 1000) / 1000;
    }
  }
  if (rest > 0) parts.push(`${formatQty(rest)} ${unitLabel(baseUnit, rest)}`);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
    : parts[0];
}

/**
 * "200 tabletas" debajo de "2 cajas": el total en la unidad mínima, solo cuando el stock se
 * muestra en cajas o blísteres (si ya está en la unidad mínima, null: no se repite).
 */
export function baseTotal(
  quantity: number,
  baseUnit: BaseUnit,
  presentations: { name: string; factor: number; active?: boolean }[],
): string | null {
  if (quantity <= 0) return null;
  const plain = `${formatQty(quantity)} ${unitLabel(baseUnit, quantity)}`;
  return readableStock(quantity, baseUnit, presentations) === plain ? null : plain;
}

export const EXPIRY_BADGE: Record<ExpiryLevel, { tone: BadgeTone; label: string }> = {
  EXPIRED: { tone: 'danger', label: 'Vencido' },
  RED: { tone: 'danger', label: 'Vence pronto' },
  YELLOW: { tone: 'warning', label: 'Por vencer' },
  GREEN: { tone: 'success', label: 'Vigente' },
};

/** "Vencido hace 5 días", "Vence hoy", "Vence en 20 días" */
export function expiryText(days: number): string {
  if (days < 0) return days === -1 ? 'Venció ayer' : `Venció hace ${-days} días`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days} días`;
}

/** S/ 1 234.50 */
export function money(value: number | null): string {
  if (value === null) return '—';
  return `S/ ${new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}
