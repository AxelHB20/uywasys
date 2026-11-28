/** Motivos de descuento de un toque (Caja, Atención y Presupuestos) */
export const DISCOUNT_REASONS = [
  'Cliente frecuente',
  'Campaña',
  'Albergue o rescate',
  'Ajuste de precio',
] as const;

const cents = (n: number) => Math.round(n * 100);

/** Lo máximo que cualquiera puede descontar en una línea (en soles, hacia abajo) */
export function discountCap(gross: number, maxPercent: number): number {
  return Math.floor(cents(gross) * maxPercent) / 10000;
}

export type DiscountProblem = 'format' | 'tooBig' | 'cap' | 'reason';

/** Qué tiene mal un descuento (null = está bien o no hay descuento) */
export function discountProblem(
  gross: number,
  amount: number | null,
  reason: string | null,
  maxPercent: number,
  canExceed: boolean,
  /** Sobre qué se mide el tope (el precio de las líneas); por defecto, lo que se cobra */
  capBase: number = gross,
): DiscountProblem | null {
  if (amount === null || !amount) return null;
  if (amount < 0 || cents(amount) / 100 !== amount) return 'format';
  if (cents(amount) > cents(gross)) return 'tooBig';
  if (!canExceed && cents(amount) > cents(discountCap(capBase, maxPercent))) return 'cap';
  if (!reason?.trim()) return 'reason';
  return null;
}

export function discountProblemText(
  problem: DiscountProblem,
  gross: number,
  maxPercent: number,
): string {
  // gross aquí es la base del tope
  switch (problem) {
    case 'format':
      return 'Escribe el monto en soles, con hasta 2 decimales';
    case 'tooBig':
      return 'El descuento no puede ser mayor que lo que se cobra';
    case 'cap':
      return `Pasa del ${maxPercent} % (máx. S/ ${discountCap(gross, maxPercent).toFixed(2)}): solo el administrador puede darlo`;
    case 'reason':
      return 'Elige o escribe el motivo';
  }
}
