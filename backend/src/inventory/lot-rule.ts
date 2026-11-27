import type { ProductCategory } from '../generated/prisma/enums.js';

/**
 * ¿El ingreso de stock exige el número de lote?
 * Vacunas (trazabilidad del carné) y controlados (DIGEMID): sí. Lo demás que vence: basta la fecha.
 * La misma regla en el alta con stock, "Registrar compra", "Recibir compra" y el Excel.
 */
export function lotRequired(
  category: ProductCategory,
  controlled: boolean,
): boolean {
  return category === 'VACCINE' || controlled;
}
