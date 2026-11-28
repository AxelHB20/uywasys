import type { IconName } from '../../shared/ui/icon/icons';
import { PetSize } from './grooming.models';
import { Role } from '../auth/auth.models';

export type ProductCategory =
  'MEDICINE' | 'VACCINE' | 'ANTIPARASITIC' | 'FOOD' | 'ACCESSORY' | 'HYGIENE' | 'SUPPLY';
export type BaseUnit = 'UNIT' | 'TABLET' | 'BOX' | 'BOTTLE' | 'ML' | 'G';
export type IgvAffectation = 'TAXED' | 'EXEMPT' | 'UNAFFECTED';
export type MovementType =
  'PURCHASE' | 'WASTE' | 'TREATMENT' | 'COUNT_ADJUST' | 'RETURN' | 'SALE' | 'PURCHASE_VOID';
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

/** Un ícono y un tono por categoría para leer la lista de un vistazo */
export const CATEGORY_ICON: Record<ProductCategory, IconName> = {
  MEDICINE: 'pill',
  VACCINE: 'syringe',
  ANTIPARASITIC: 'shield-check',
  FOOD: 'package',
  ACCESSORY: 'paw',
  HYGIENE: 'scissors',
  SUPPLY: 'clipboard-list',
};
export const CATEGORY_TINT: Record<ProductCategory, string> = {
  MEDICINE: 'bg-anil-50 text-anil-700',
  VACCINE: 'bg-sky-50 text-sky-700',
  ANTIPARASITIC: 'bg-emerald-50 text-emerald-700',
  FOOD: 'bg-amber-50 text-amber-800',
  ACCESSORY: 'bg-violet-50 text-violet-700',
  HYGIENE: 'bg-teal-50 text-teal-700',
  SUPPLY: 'bg-slate-100 text-slate-600',
};

/** [singular, plural] */
export const BASE_UNIT_LABELS: Record<BaseUnit, [string, string]> = {
  UNIT: ['unidad', 'unidades'],
  TABLET: ['tableta', 'tabletas'],
  BOX: ['caja', 'cajas'],
  BOTTLE: ['frasco', 'frascos'],
  ML: ['ml', 'ml'],
  G: ['g', 'g'],
};
export const BASE_UNITS = Object.keys(BASE_UNIT_LABELS) as BaseUnit[];
/**
 * Unidades que se ofrecen al agregar un producto: la clínica vende entero (no por ml ni por g).
 * ml y g siguen existiendo para los productos que ya los usan.
 */
export const NEW_PRODUCT_UNITS: BaseUnit[] = ['UNIT', 'TABLET', 'BOX', 'BOTTLE'];

/** Textos que explican el inventario, iguales en todas las pantallas (sin jerga) */
export const INVENTORY_HELP = {
  controlled:
    'Solo para ketamina, tramadol, diazepam, fenobarbital y similares. Queda en el libro de DIGEMID y cada uso pide receta, paciente y veterinario colegiado. Los demás medicamentos (antibióticos, vitaminas, antiparasitarios) no se marcan.',
  supply:
    'Para lo que se gasta al atender y no se le vende al cliente: jeringas, guantes, gasas, alcohol. No aparece al cobrar (Caja, atención ni presupuestos). Su stock baja al anotarlo en la atención («Insumos usados»), con un servicio que lo usa o en «Registrar salida».',
  cost: 'Lo que pagaste al proveedor, con IGV (precio final) o sin IGV (valor de la factura): elígelo al lado. Se guarda sin IGV.',
  price: 'Lo que paga el cliente, con IGV incluido.',
  expiry: 'Como en la caja: 08/2027.',
} as const;

/** Nombre de lo que antes se llamaba "controlado": lo que de verdad significa */
export const CONTROLLED_LABEL = 'Psicotrópico (DIGEMID)';
export const CONTROLLED_QUESTION = 'Estupefaciente o psicotrópico (libro de DIGEMID)';

/** Por qué se pide (o no) el lote, en palabras de la clínica */
export function lotHint(category: ProductCategory | null, controlled: boolean): string {
  if (controlled) return 'Obligatorio: DIGEMID pide el lote de los psicotrópicos.';
  if (category === 'VACCINE') return 'Obligatorio: el lote va en el carné de vacunación.';
  return 'Opcional: anótalo si la caja lo trae.';
}

/** Mensaje cuando falta un lote obligatorio */
export function lotMissingText(category: ProductCategory | null, controlled: boolean): string {
  return controlled
    ? 'Falta el lote: DIGEMID lo pide en los psicotrópicos'
    : category === 'VACCINE'
      ? 'Falta el lote: va en el carné de vacunación'
      : 'Falta el lote';
}

/** Vacunas (carné) y controlados (DIGEMID) piden lote; lo demás que vence, solo la fecha */
export function lotRequired(category: ProductCategory | null, controlled: boolean): boolean {
  return category === 'VACCINE' || controlled;
}

export const IGV_LABELS: Record<IgvAffectation, string> = {
  TAXED: 'Gravado (10)',
  EXEMPT: 'Exonerado (20)',
  UNAFFECTED: 'Inafecto (30)',
};

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE: 'Compra',
  WASTE: 'Merma',
  TREATMENT: 'Usado en la clínica',
  COUNT_ADJUST: 'Ajuste por conteo',
  RETURN: 'Devolución',
  SALE: 'Venta',
  PURCHASE_VOID: 'Compra anulada',
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
  /** Se cobra al cliente; los insumos no (servidores anteriores no lo mandan: se asume que sí) */
  chargeable?: boolean;
  /** Tiene lote y vencimiento (medicamentos, vacunas, alimentos); camas o juguetes no */
  tracksExpiry: boolean;
  /** Afectación del IGV (servidores anteriores no la mandan: se asume gravado) */
  igv?: IgvAffectation;
  active: boolean;
  presentations: Presentation[];
  nextExpiry: (ExpiryStatus & { date: string; lotNumber: string | null }) | null;
  /** Último costo sin IGV por unidad mínima (null si nunca se compró por el sistema) */
  unitCost?: number | null;
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
  /** Ficha de compra en la que entró (solo para quien ve costos; nulo en ingresos antiguos) */
  purchase?: { id: number; code: string } | null;
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
  /** 'charge' = salió por un cargo de la atención (insumo de un servicio o venta) */
  refType?: string | null;
  /** Venta suelta: a quién y con qué comprobante */
  sale?: { client: string; document: string | null } | null;
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
  /** En las entradas: de qué proveedor y ficha vino (DIGEMID) */
  batch: {
    lotNumber: string | null;
    supplier?: string | null;
    documentNumber?: string | null;
  } | null;
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
  chargeable: boolean;
  tracksExpiry: boolean;
  sunatUnit: string;
  igv: IgvAffectation;
  notes: string | null;
}

/** "Cargar stock": producto activo sin stock */
export interface PendingStockProduct {
  id: number;
  name: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  controlled: boolean;
  tracksExpiry: boolean;
  igv: IgvAffectation;
  /** De la más grande a la más chica */
  presentations: { id: number; name: string; factor: number }[];
}

export interface StockLoadItem {
  productId: number;
  presentationId: number;
  quantity: number;
  lotNumber: string | null;
  expiresAt: string | null;
  costPerPresentation: number | null;
  controlled?: boolean;
}

/** "Corregir productos": «Trae» con el stock puesto o insumo con precio */
export interface ProductFixRow {
  id: number;
  name: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  totalStock: number;
  /** Sin movimientos: se puede cambiar cómo se cuenta */
  canChangeUnit: boolean;
  /** Presentación con «Trae» mal puesto (se le pone 1) */
  presentation: { id: number; name: string; factor: number } | null;
  supplyWithPrice: boolean;
}

export interface ProductFixItem {
  productId: number;
  presentationId?: number;
  baseUnit?: BaseUnit;
  sellable?: boolean;
}

/** Lo que estaba en «Trae»: cantidad sugerida en "Cargar stock" */
export interface StockSuggestion {
  productId: number;
  presentationId: number;
  quantity: number;
}

/** Stock con el que entra el producto al agregarlo (misma operación) */
export interface InitialStockInput {
  /** Posición de la presentación en la lista (0 = la primera) */
  presentationIndex: number;
  quantity: number;
  lotNumber: string | null;
  expiresAt: string | null;
  costPerPresentation: number | null;
}

export interface PurchaseInput {
  presentationId: number;
  quantity: number;
  lotNumber: string | null;
  expiresAt: string | null;
  /** Costo sin IGV de cada presentación */
  costPerPresentation: number | null;
  supplier: string | null;
  /** Proveedor de la lista (manda sobre el texto) */
  supplierId?: number | null;
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

/** expiring = 60 días o vencido · expired · exp30 = en 30 días · exp60 = de 31 a 60 días */
export type StockFilter = 'all' | 'low' | 'expiring' | 'expired' | 'exp30' | 'exp60';

export interface ProductImportRow {
  row: number;
  key: string;
  product: {
    code: string | null;
    name: string;
    category: ProductCategory;
    baseUnit: BaseUnit;
    controlled: boolean;
    igv: IgvAffectation;
  };
  presentation: {
    name: string;
    factor: number;
    price: number | null;
    barcode: string | null;
  };
  /** Otra fila de la misma presentación: solo suma un lote */
  extraLot: boolean;
  stock: {
    quantity: number;
    lotNumber: string | null;
    expiresAt: string | null;
    cost: number | null;
    supplier: string | null;
  } | null;
  status: 'ok' | 'exists' | 'error';
  errors: string[];
  /** No impiden importar: sin precio, sin costo, vence pronto */
  warnings: string[];
}

export interface ProductImportPreview {
  rows: ProductImportRow[];
  summary: {
    rows: number;
    ok: number;
    exists: number;
    errors: number;
    warnings: number;
    products: number;
    presentations: number;
    batches: number;
  };
}

export interface ProductImportResult {
  products: number;
  presentations: number;
  batches: number;
  skipped: number;
  errors: number;
}

export type CareServiceCategory =
  | 'CONSULTATION'
  | 'VACCINATION'
  | 'DEWORMING'
  | 'SURGERY'
  | 'LAB'
  | 'GROOMING'
  | 'HOSPITALIZATION'
  | 'OTHER';

export const SERVICE_CATEGORY_LABELS: Record<CareServiceCategory, string> = {
  CONSULTATION: 'Consultas',
  VACCINATION: 'Vacunación',
  DEWORMING: 'Desparasitación',
  SURGERY: 'Cirugías y procedimientos',
  LAB: 'Laboratorio',
  GROOMING: 'Baño y grooming',
  HOSPITALIZATION: 'Hospitalización',
  OTHER: 'Otros',
};
export const SERVICE_CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS) as CareServiceCategory[];

export interface CareService {
  /** Presupuestos emitidos o aceptados que lo incluyen (se cobran aunque se desactive) */
  pendingEstimates?: number;
  id: number;
  name: string;
  category: CareServiceCategory;
  price: number;
  igv: IgvAffectation;
  durationMin: number | null;
  active: boolean;
  /** Grooming: precio según el tamaño de la mascota (si falta, rige `price`) */
  sizePrices: { size: PetSize; price: number }[];
  supplies: {
    productId: number;
    name: string;
    baseUnit: BaseUnit;
    quantity: number;
    /** Controlado: el cargo exige receta y veterinario con colegiatura */
    controlled: boolean;
    /** Último costo sin IGV por unidad mínima (null si nunca se compró por el sistema) */
    unitCost?: number | null;
  }[];
}

export interface CareServiceInput {
  name: string;
  category: CareServiceCategory;
  price: number;
  igv: IgvAffectation;
  durationMin: number | null;
  active?: boolean;
  supplies: { productId: number; quantity: number }[];
  sizePrices: { size: PetSize; price: number }[];
}

/** Insumo usado sin stock registrado: hay que regularizarlo (compra o conteo) */
export interface Shortage {
  id: number;
  product: { id: number; name: string; baseUnit: BaseUnit };
  quantity: number;
  createdAt: string;
  charge: {
    id: number;
    description: string;
    visitId: number | null;
    pet: { id: number; name: string } | null;
  };
  resolvedAt: string | null;
  resolution: string | null;
}

/** Lo que por defecto no vence: accesorios (camas, juguetes, correas, collares) */
export const defaultTracksExpiry = (category: ProductCategory): boolean => category !== 'ACCESSORY';
/** Los insumos (jeringas, guantes…) no se cobran aparte: se descuentan con el servicio */
export const defaultChargeable = (category: ProductCategory): boolean => category !== 'SUPPLY';
