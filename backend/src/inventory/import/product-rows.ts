import type { SheetColumn, SheetRow } from '../../common/excel/sheet.js';
import { normalizeSearch } from '../../common/text/search.js';
import type {
  BaseUnit,
  IgvAffectation,
  ProductCategory,
} from '../../generated/prisma/enums.js';
import { COUNTING_UNITS } from '../unit-names.js';

export type ProductField =
  | 'code'
  | 'name'
  | 'category'
  | 'baseUnit'
  | 'presentation'
  | 'factor'
  | 'barcode'
  | 'price'
  | 'igv'
  | 'minStock'
  | 'requiresPrescription'
  | 'controlled'
  | 'lotNumber'
  | 'expiresAt'
  | 'quantity'
  | 'cost'
  | 'supplier';

export const PRODUCT_COLUMNS: SheetColumn<ProductField>[] = [
  { field: 'code', header: 'Código', width: 12 },
  { field: 'name', header: 'Producto', required: true, width: 30 },
  { field: 'category', header: 'Categoría', required: true, width: 16 },
  { field: 'baseUnit', header: 'Se cuenta por', required: true, width: 14 },
  { field: 'presentation', header: 'Presentación', required: true, width: 18 },
  {
    field: 'factor',
    header: 'Trae (1 si es una sola)',
    required: true,
    width: 16,
  },
  { field: 'barcode', header: 'Código de barras', width: 16 },
  { field: 'price', header: 'Precio con IGV', width: 12 },
  { field: 'igv', header: 'IGV (Gravado/Exonerado/Inafecto)', width: 16 },
  { field: 'minStock', header: 'Stock mínimo', width: 12 },
  { field: 'requiresPrescription', header: 'Con receta (Sí/No)', width: 12 },
  { field: 'controlled', header: 'Psicotrópico DIGEMID (Sí/No)', width: 14 },
  { field: 'lotNumber', header: 'Lote', width: 14 },
  { field: 'expiresAt', header: 'Vencimiento (MM/AAAA)', width: 14 },
  {
    field: 'quantity',
    header: 'Stock que tienes (en esta presentación)',
    width: 16,
  },
  { field: 'cost', header: 'Costo por presentación', width: 14 },
  { field: 'supplier', header: 'Proveedor', width: 20 },
];

const ALIASES: Record<string, ProductField> = {
  nombre: 'name',
  unidad: 'baseUnit',
  precio: 'price',
  cantidad: 'quantity',
  stock: 'quantity',
  costo: 'cost',
  barras: 'barcode',
  'codigo barras': 'barcode',
  'cod barras': 'barcode',
  ean: 'barcode',
  igv: 'igv',
  'afectacion igv': 'igv',
  'tipo igv': 'igv',
};

/** Encabezados de plantillas anteriores (v0.4.11 y antes): se siguen leyendo */
const LEGACY_PREFIXES: [string, ProductField][] = [
  ['unidad minima', 'baseUnit'],
  ['equivalencia', 'factor'],
  ['controlado', 'controlled'],
  ['psicotropico', 'controlled'],
  ['cantidad inicial', 'quantity'],
  ['vencimiento', 'expiresAt'],
];

/** De más largo a más corto: "Código de barras" no debe caer en "Código" */
const BY_LENGTH = [...PRODUCT_COLUMNS].sort(
  (a, b) => b.header.length - a.header.length,
);

export function productFieldFor(header: string): ProductField | null {
  const h = normalizeSearch(header);
  if (!h) return null;
  // Primero los nombres cortos exactos: "Stock" a secas es la cantidad, no el stock mínimo
  if (ALIASES[h]) return ALIASES[h];
  const exact = PRODUCT_COLUMNS.find((c) => normalizeSearch(c.header) === h);
  if (exact) return exact.field;
  const legacy = LEGACY_PREFIXES.find(([prefix]) => h.startsWith(prefix));
  if (legacy) return legacy[1];
  for (const column of BY_LENGTH) {
    const expected = normalizeSearch(column.header);
    const base = expected.split(' ').slice(0, 2).join(' ');
    if (
      h === expected ||
      h.startsWith(base) ||
      (h.length >= 4 && expected.startsWith(h))
    )
      return column.field;
  }
  return null;
}

const CATEGORIES: Record<string, ProductCategory> = {
  medicamento: 'MEDICINE',
  medicina: 'MEDICINE',
  farmaco: 'MEDICINE',
  vacuna: 'VACCINE',
  biologico: 'VACCINE',
  antiparasitario: 'ANTIPARASITIC',
  desparasitante: 'ANTIPARASITIC',
  alimento: 'FOOD',
  comida: 'FOOD',
  accesorio: 'ACCESSORY',
  higiene: 'HYGIENE',
  insumo: 'SUPPLY',
  material: 'SUPPLY',
};

const UNITS: Record<string, BaseUnit> = {
  unidad: 'UNIT',
  und: 'UNIT',
  unid: 'UNIT',
  un: 'UNIT',
  u: 'UNIT',
  pieza: 'UNIT',
  tableta: 'TABLET',
  tab: 'TABLET',
  pastilla: 'TABLET',
  comprimido: 'TABLET',
  capsula: 'TABLET',
  caja: 'BOX',
  cajas: 'BOX',
  frasco: 'BOTTLE',
  frascos: 'BOTTLE',
  fco: 'BOTTLE',
  ml: 'ML',
  mililitro: 'ML',
  cc: 'ML',
  g: 'G',
  gr: 'G',
  gramo: 'G',
};

const IGV: Record<string, IgvAffectation> = {
  gravado: 'TAXED',
  '10': 'TAXED',
  exonerado: 'EXEMPT',
  '20': 'EXEMPT',
  inafecto: 'UNAFFECTED',
  '30': 'UNAFFECTED',
};

/** Busca en un diccionario aceptando plurales y puntos: "Medicamentos", "Unid.", "Tabs" */
function lookup<T>(dict: Record<string, T>, v: string): T | undefined {
  const k = normalizeSearch(v);
  if (!k) return undefined;
  if (dict[k] !== undefined) return dict[k];
  if (k.endsWith('es') && dict[k.slice(0, -2)] !== undefined)
    return dict[k.slice(0, -2)];
  if (k.endsWith('s')) return dict[k.slice(0, -1)];
  return undefined;
}

/** Vencimiento cercano: avisa (no bloquea) */
const SOON_DAYS = 30;

export interface ProductImportRow {
  row: number;
  /** Agrupa las presentaciones del mismo producto */
  key: string;
  product: {
    code: string | null;
    name: string;
    category: ProductCategory;
    baseUnit: BaseUnit;
    minStock: number;
    requiresPrescription: boolean;
    controlled: boolean;
    igv: IgvAffectation;
  };
  presentation: {
    name: string;
    factor: number;
    price: number | null;
    barcode: string | null;
  };
  /** Otra fila de la misma presentación que solo suma un lote: no crea la presentación de nuevo */
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
  /** Avisos que no impiden importar (sin precio, sin costo, vence pronto) */
  warnings: string[];
}

const text = (v: string | Date | undefined) =>
  v instanceof Date ? '' : (v ?? '').toString().trim();
const yes = (v: string | Date | undefined) =>
  ['si', 'x', '1', 'true', 'verdadero'].includes(normalizeSearch(text(v)));

function number(v: string | Date | undefined): number | null | 'invalid' {
  const raw = text(v)
    .replace(/^s\/\s*/i, '')
    .replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 'invalid';
}

type ParsedDate = { value: string | null; invalid: boolean };

/** Días entre dos fechas AAAA-MM-DD */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Acepta fecha de Excel, MM/AAAA (último día del mes), AAAA-MM-DD o DD/MM/AAAA. */
function date(v: string | Date | undefined): ParsedDate {
  const bad = { value: null, invalid: true };
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? bad
      : { value: v.toISOString().slice(0, 10), invalid: false };
  const raw = text(v);
  if (!raw) return { value: null, invalid: false };
  const month = /^(\d{1,2})[/-](\d{4})$/.exec(raw);
  if (month) {
    const [mo, y] = [+month[1], +month[2]];
    if (mo < 1 || mo > 12) return bad;
    return {
      value: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10),
      invalid: false,
    };
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const parts = m ? [+m[1], +m[2], +m[3]] : null;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const [y, mo, d] = parts ?? (m ? [+m[3], +m[2], +m[1]] : [0, 0, 0]);
  if (!y) return bad;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    ? { value: dt.toISOString().slice(0, 10), invalid: false }
    : bad;
}

/** Valida cada fila (una por presentación) sin tocar la base. `today` = AAAA-MM-DD de la clínica. */
export function validateProductRows(
  rows: SheetRow<ProductField>[],
  today: string,
): ProductImportRow[] {
  return blockIncompleteProducts(requireBase(validateEach(rows, today)));
}

/**
 * Cada producto necesita la presentación que trae 1 (la unidad en que se cuenta).
 * Si falta, casi siempre es que pusieron el stock en «Trae».
 */
function requireBase(rows: ProductImportRow[]): ProductImportRow[] {
  // Si una fila del producto ya tiene error, ese error manda (la fila con Trae 1 puede ser la mala)
  const hasBase = new Set<string>();
  for (const r of rows)
    if (
      r.status === 'error' ||
      r.presentation.factor === 1 ||
      // En ml y g, "Frasco x 10 ml = 10" es una conversión de verdad
      !COUNTING_UNITS.includes(r.product.baseUnit)
    )
      hasBase.add(r.key);
  const reported = new Set<string>();
  for (const r of rows) {
    if (r.status !== 'ok' || hasBase.has(r.key) || reported.has(r.key))
      continue;
    reported.add(r.key);
    r.status = 'error';
    r.warnings = [];
    r.errors = [
      'Falta una fila con «Trae» = 1 (la unidad). ¿Pusiste el stock en «Trae»? El stock va en «Stock que tienes»',
    ];
  }
  return rows;
}

/** Un producto se importa completo o no se importa: si una de sus filas falla, se marcan todas. */
function blockIncompleteProducts(rows: ProductImportRow[]): ProductImportRow[] {
  const failed = new Map<string, number>();
  for (const r of rows)
    if (r.status === 'error' && !failed.has(r.key)) failed.set(r.key, r.row);
  for (const r of rows) {
    const bad = failed.get(r.key);
    if (r.status === 'ok' && bad !== undefined) {
      r.status = 'error';
      r.errors = [
        `Corrige la fila ${bad} de este mismo producto; se importa completo o no se importa`,
      ];
    }
  }
  return rows;
}

function validateEach(
  rows: SheetRow<ProductField>[],
  today: string,
): ProductImportRow[] {
  const groups = new Map<
    string,
    {
      row: number;
      category: string;
      baseUnit: string;
      controlled: boolean;
      igv: string;
      /** presentación → equivalencia y precio, para aceptar otra fila con otro lote */
      presentations: Map<string, { factor: number; price: number | null }>;
    }
  >();
  const barcodes = new Map<
    string,
    { key: string; pres: string; row: number }
  >();

  return rows.map(({ row, values }) => {
    const errors: string[] = [];
    const name = text(values.name).replace(/\s+/g, ' ').slice(0, 120);
    if (name.length < 2) errors.push('Falta el nombre del producto');
    const code = text(values.code).slice(0, 30) || null;
    if (code && !/^[\w.-]{1,30}$/.test(code))
      errors.push('El código admite letras, números, punto y guion');

    const category = lookup(CATEGORIES, text(values.category));
    if (!category)
      errors.push(`Categoría «${text(values.category)}» no reconocida`);
    const baseUnit = lookup(UNITS, text(values.baseUnit));
    if (!baseUnit)
      errors.push(
        `«Se cuenta por» no reconoce «${text(values.baseUnit)}» (Unidad, Tableta, Caja o Frasco)`,
      );

    const presName = text(values.presentation).slice(0, 60);
    if (!presName) errors.push('Falta la presentación');
    const factor = number(values.factor);
    if (factor === null || factor === 'invalid' || factor <= 0)
      errors.push('«Trae» debe ser un número mayor a 0 (1 si es una sola)');
    const price = number(values.price);
    if (price === 'invalid' || (typeof price === 'number' && price < 0))
      errors.push('El precio no es válido');
    const igvText = text(values.igv);
    const igv = igvText ? lookup(IGV, igvText) : 'TAXED';
    if (!igv)
      errors.push(
        `IGV «${igvText}» no reconocido (Gravado, Exonerado o Inafecto)`,
      );
    const barcode =
      text(values.barcode).replace(/\s+/g, '').slice(0, 30) || null;
    if (barcode && !/^[\w-]{3,30}$/.test(barcode))
      errors.push('El código de barras admite solo letras, números y guion');
    const minStock = number(values.minStock);
    if (
      minStock === 'invalid' ||
      (typeof minStock === 'number' && minStock < 0)
    )
      errors.push('El stock mínimo no es válido');

    const controlled = yes(values.controlled);
    let stock: ProductImportRow['stock'] = null;
    const warnings: string[] = [];
    const qty = number(values.quantity);
    if (qty === 'invalid' || (typeof qty === 'number' && qty < 0))
      errors.push('El stock no es válido');
    else if (typeof qty === 'number' && qty > 0) {
      const lot = text(values.lotNumber).slice(0, 40) || null;
      const { value: exp, invalid: badDate } = date(values.expiresAt);
      const cost = number(values.cost);
      if (badDate)
        errors.push('El vencimiento no es válido (usa MM/AAAA, ej.: 03/2027)');
      else if (exp && exp < today)
        errors.push('Ese lote ya está vencido: no se puede ingresar');
      else if (exp && daysBetween(today, exp) <= SOON_DAYS)
        warnings.push(`Vence en ${daysBetween(today, exp)} días`);
      // Vacunas y controlados: lote obligatorio (trazabilidad). Lo demás que vence: basta la fecha
      if ((category === 'VACCINE' || controlled) && !lot)
        errors.push(
          category === 'VACCINE'
            ? 'Con stock, indica el lote: va en el carné de vacunación'
            : 'Con stock, indica el lote: DIGEMID lo pide en los psicotrópicos',
        );
      if (category && category !== 'ACCESSORY' && !exp && !badDate)
        errors.push('Con stock, indica el vencimiento (MM/AAAA)');
      if (cost === 'invalid' || (typeof cost === 'number' && cost < 0))
        errors.push('El costo no es válido');
      else if (cost === null)
        warnings.push('Sin costo: el margen de este lote saldrá incompleto');
      stock = {
        quantity: qty,
        lotNumber: lot,
        expiresAt: exp,
        cost: typeof cost === 'number' ? cost : null,
        supplier: text(values.supplier).slice(0, 120) || null,
      };
    }

    const key = code
      ? `code:${code.toUpperCase()}`
      : `name:${normalizeSearch(name)}`;
    const group = groups.get(key);
    const presKey = normalizeSearch(presName);
    const numFactor = typeof factor === 'number' ? factor : 0;
    const numPrice =
      typeof price === 'number' ? Math.round(price * 100) / 100 : null;
    let extraLot = false;
    if (group) {
      if (
        group.category !== category ||
        group.baseUnit !== baseUnit ||
        group.controlled !== controlled ||
        group.igv !== igv
      )
        errors.push(
          `El producto está en la fila ${group.row} con otra categoría, «Se cuenta por», IGV o marca de psicotrópico`,
        );
      const same = group.presentations.get(presKey);
      if (same) {
        // Otra fila de la misma presentación vale solo para sumar otro lote
        if (!stock)
          errors.push(
            `La presentación «${presName}» está repetida (para otro lote, pon su cantidad)`,
          );
        else if (
          same.factor !== numFactor ||
          (numPrice !== null && same.price !== null && same.price !== numPrice)
        )
          errors.push(
            `La presentación «${presName}» está repetida con otro «Trae» o precio`,
          );
        else extraLot = true;
      }
    }
    if (barcode && !extraLot) {
      const seen = barcodes.get(barcode);
      if (seen && (seen.key !== key || seen.pres !== presKey))
        errors.push(`El código de barras ya está en la fila ${seen.row}`);
    }
    if (!errors.length) {
      if (barcode && !barcodes.has(barcode))
        barcodes.set(barcode, { key, pres: presKey, row });
      if (group) {
        if (!extraLot)
          group.presentations.set(presKey, {
            factor: numFactor,
            price: numPrice,
          });
      } else
        groups.set(key, {
          row,
          category: category!,
          baseUnit: baseUnit!,
          controlled,
          igv: igv!,
          presentations: new Map([
            [presKey, { factor: numFactor, price: numPrice }],
          ]),
        });
    }
    if (numPrice === null && !extraLot)
      warnings.push('Sin precio: no se podrá cobrar hasta ponérselo');

    return {
      row,
      key,
      product: {
        code,
        name,
        category: category ?? 'SUPPLY',
        baseUnit: baseUnit ?? 'UNIT',
        minStock: typeof minStock === 'number' ? minStock : 0,
        requiresPrescription: yes(values.requiresPrescription) || controlled,
        controlled,
        igv: igv ?? 'TAXED',
      },
      presentation: {
        name: presName,
        factor: numFactor,
        price: numPrice,
        barcode,
      },
      extraLot,
      stock,
      status: errors.length ? 'error' : 'ok',
      errors,
      warnings: errors.length ? [] : warnings,
    };
  });
}
