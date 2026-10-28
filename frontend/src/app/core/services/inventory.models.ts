import { Role } from '../auth/auth.models';

export type ProductCategory =
  'MEDICINE' | 'VACCINE' | 'ANTIPARASITIC' | 'FOOD' | 'ACCESSORY' | 'HYGIENE' | 'SUPPLY';
export type BaseUnit = 'UNIT' | 'TABLET' | 'ML' | 'G';
export type IgvAffectation = 'TAXED' | 'EXEMPT' | 'UNAFFECTED';
export type MovementType = 'PURCHASE' | 'WASTE' | 'TREATMENT' | 'COUNT_ADJUST' | 'RETURN' | 'SALE';
export type ExpiryLevel = 'EXPIRED' | 'RED' | 'YELLOW' | 'GREEN';

/** Compras, salidas y catálogo (igual que el backend). El ajuste por conteo es solo del ADMIN. */
export const STOCK_ROLES: Role[] = ['ADMIN', 'VET'];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  MEDICINE: 'Medicamento',
  VACCINE: 'Vacuna',
  ANTIPARASITIC: 'Antiparasitario',
  FOOD: 'Alimento',
  ACCESSORY: 'Accesorio',
  HYGIENE: 'Higiene',
  SUPPLY: 'Insumo',
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as ProductCategory[];

/** [singular, plural] */
export const BASE_UNIT_LABELS: Record<BaseUnit, [string, string]> = {
  UNIT: ['unidad', 'unidades'],
  TABLET: ['tableta', 'tabletas'],
  ML: ['ml', 'ml'],
  G: ['g', 'g'],
};
export const BASE_UNITS = Object.keys(BASE_UNIT_LABELS) as BaseUnit[];

export const IGV_LABELS: Record<IgvAffectation, string> = {
  TAXED: 'Gravado (10)',
  EXEMPT: 'Exonerado (20)',
  UNAFFECTED: 'Inafecto (30)',
};

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE: 'Compra',
  WASTE: 'Merma',
  TREATMENT: 'Uso interno',
  COUNT_ADJUST: 'Ajuste por conteo',
  RETURN: 'Devolución',
  SALE: 'Venta',
};

export interface ExpiryStatus {
  days: number;
  level: ExpiryLevel;
}

export interface Presentation {
  id: number;
  name: string;
  factor: number;
  price: number | null;
  barcode: string | null;
  active: boolean;
}

export interface ProductSummary {
  id: number;
  code: string | null;
  name: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  totalStock: number;
  minStock: number;
  lowStock: boolean;
  controlled: boolean;
  requiresPrescription: boolean;
  active: boolean;
  presentations: Presentation[];
  nextExpiry: (ExpiryStatus & { date: string; lotNumber: string | null }) | null;
}

export interface ProductPage {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Batch {
  id: number;
  lotNumber: string | null;
  expiresAt: string | null;
  expiry: ExpiryStatus | null;
  quantity: number;
  initialQuantity: number;
  unitCost: number | null;
  supplier: string | null;
  documentNumber: string | null;
  receivedAt: string;
}

export interface ProductDetail extends Omit<ProductSummary, 'nextExpiry'> {
  barcode: string | null;
  sunatUnit: string;
  igv: IgvAffectation;
  notes: string | null;
  batches: Batch[];
  usedIn: { id: number; name: string; quantity: number }[];
}

export interface Movement {
  id: number;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  prescriptionRef: string | null;
  createdAt: string;
  batch: { id: number; lotNumber: string | null } | null;
  user: { fullName: string };
  vet: { fullName: string } | null;
  pet: { id: number; name: string; clientId: number } | null;
}

export interface ControlledMovement {
  id: number;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  prescriptionRef: string | null;
  createdAt: string;
  product: { id: number; name: string; baseUnit: BaseUnit };
  batch: { lotNumber: string | null } | null;
  user: { fullName: string };
  vet: { fullName: string; licenseNumber: string | null } | null;
  pet: { id: number; name: string; client: { id: number; name: string } } | null;
}

export interface InventoryAlerts {
  expired: number;
  red: number;
  yellow: number;
  lowStock: number;
  batches: {
    id: number;
    lotNumber: string | null;
    expiresAt: string | null;
    expiry: ExpiryStatus | null;
    quantity: number;
    product: { id: number; name: string; baseUnit: BaseUnit };
  }[];
  low: { id: number; name: string; baseUnit: BaseUnit; totalStock: number; minStock: number }[];
}

export interface PresentationInput {
  name: string;
  factor: number;
  price: number | null;
  barcode?: string | null;
}

export interface ProductInput {
  code: string | null;
  barcode: string | null;
  name: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  minStock: number;
  requiresPrescription: boolean;
  controlled: boolean;
  sunatUnit: string;
  igv: IgvAffectation;
  notes: string | null;
}

export interface PurchaseInput {
  presentationId: number;
  quantity: number;
  lotNumber: string | null;
  expiresAt: string | null;
  costPerPresentation: number | null;
  supplier: string | null;
  documentNumber: string | null;
}

export interface OutflowInput {
  type: 'WASTE' | 'TREATMENT';
  quantity: number;
  presentationId: number | null;
  batchId: number | null;
  reason: string;
  petId: number | null;
  prescriptionRef: string | null;
}

export type StockFilter = 'all' | 'low' | 'expiring';
