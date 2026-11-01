import { CareService, ProductSummary } from '../../core/services/inventory.models';
import { formatQty, unitLabel } from '../utils/stock';

/** Opción de un buscador de cargos: un servicio del catálogo o un producto en una de sus presentaciones. */
export interface CatalogOption {
  key: string;
  kind: 'SERVICE' | 'PRODUCT';
  careServiceId?: number;
  productId?: number;
  presentationId?: number;
  description: string;
  detail: string;
  unitPrice: number;
  /** Lleva un producto controlado: pide N.º de receta */
  controlled: boolean;
}

/** Servicios activos cuyo nombre contiene el texto (sin tildes ni mayúsculas). */
export function toServiceOptions(catalog: CareService[], term: string, max = 5): CatalogOption[] {
  const q = normalizeText(term);
  if (q.length < 2) return [];
  return catalog
    .filter((s) => s.active && normalizeText(s.name).includes(q))
    .slice(0, max)
    .map((s) => ({
      key: `s${s.id}`,
      kind: 'SERVICE',
      careServiceId: s.id,
      description: s.name,
      detail: s.supplies.length ? `usa ${s.supplies.map((x) => x.name).join(', ')}` : '',
      unitPrice: s.price,
      controlled: s.supplies.some((x) => x.controlled),
    }));
}

/** Cada presentación con precio es una opción: "Pipeta antipulgas · Unidad". */
export function toProductOptions(products: ProductSummary[]): CatalogOption[] {
  return products.flatMap((p) =>
    p.presentations
      .filter((pr) => pr.active && pr.price !== null)
      .map((pr) => ({
        key: `p${pr.id}`,
        kind: 'PRODUCT' as const,
        productId: p.id,
        presentationId: pr.id,
        description: `${p.name} · ${pr.name}`,
        detail: `stock ${formatQty(p.totalStock)} ${unitLabel(p.baseUnit, p.totalStock)}`,
        unitPrice: pr.price as number,
        controlled: p.controlled,
      })),
  );
}

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
