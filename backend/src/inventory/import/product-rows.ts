import type { SheetColumn, SheetRow } from '../../common/excel/sheet.js';
import { normalizeSearch } from '../../common/text/search.js';
import type {
  BaseUnit,
  ProductCategory,
} from '../../generated/prisma/enums.js';

export type ProductField =
  | 'code'
  | 'name'
  | 'category'
  | 'baseUnit'
  | 'presentation'
  | 'factor'
  | 'price'
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
  { field: 'baseUnit', header: 'Unidad mínima', required: true, width: 14 },
  { field: 'presentation', header: 'Presentación', required: true, width: 18 },
  {
    field: 'factor',
    header: 'Equivalencia (unidades mínimas)',
    required: true,
    width: 16,
  },
  { field: 'price', header: 'Precio con IGV', width: 12 },
  { field: 'minStock', header: 'Stock mínimo', width: 12 },
  { field: 'requiresPrescription', header: 'Con receta (Sí/No)', width: 12 },
  { field: 'controlled', header: 'Controlado (Sí/No)', width: 12 },
  { field: 'lotNumber', header: 'Lote', width: 14 },
  { field: 'expiresAt', header: 'Vencimiento (AAAA-MM-DD)', width: 16 },
  {
    field: 'quantity',
    header: 'Cantidad inicial (en esta presentación)',
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
};

export function productFieldFor(header: string): ProductField | null {
  const h = normalizeSearch(header);
  if (!h) return null;
  // Primero los nombres cortos exactos: "Stock" a secas es la cantidad, no el stock mínimo
  if (ALIASES[h]) return ALIASES[h];
  for (const column of PRODUCT_COLUMNS) {
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
  vacuna: 'VACCINE',
  antiparasitario: 'ANTIPARASITIC',
  alimento: 'FOOD',
  accesorio: 'ACCESSORY',
  higiene: 'HYGIENE',
  insumo: 'SUPPLY',
};

const UNITS: Record<string, BaseUnit> = {
  unidad: 'UNIT',
  und: 'UNIT',
  tableta: 'TABLET',
  tab: 'TABLET',
  pastilla: 'TABLET',
  ml: 'ML',
  mililitro: 'ML',
  g: 'G',
  gr: 'G',
  gramo: 'G',
};

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
  };
  presentation: { name: string; factor: number; price: number | null };
  stock: {
    quantity: number;
    lotNumber: string | null;
    expiresAt: string | null;
    cost: number | null;
    supplier: string | null;
  } | null;
  status: 'ok' | 'exists' | 'error';
  errors: string[];
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

/** Acepta fecha de Excel, AAAA-MM-DD o DD/MM/AAAA. */
function date(v: string | Date | undefined): ParsedDate {
  const bad = { value: null, invalid: true };
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? bad
      : { value: v.toISOString().slice(0, 10), invalid: false };
  const raw = text(v);
  if (!raw) return { value: null, invalid: false };
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
  return blockIncompleteProducts(validateEach(rows, today));
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
      presentations: Set<string>;
    }
  >();

  return rows.map(({ row, values }) => {
    const errors: string[] = [];
    const name = text(values.name).replace(/\s+/g, ' ').slice(0, 120);
    if (name.length < 2) errors.push('Falta el nombre del producto');
    const code = text(values.code).slice(0, 30) || null;
    if (code && !/^[\w.-]{1,30}$/.test(code))
      errors.push('El código admite letras, números, punto y guion');

    const category = CATEGORIES[normalizeSearch(text(values.category))];
    if (!category)
      errors.push(`Categoría «${text(values.category)}» no reconocida`);
    const baseUnit = UNITS[normalizeSearch(text(values.baseUnit))];
    if (!baseUnit)
      errors.push(
        `Unidad mínima «${text(values.baseUnit)}» no reconocida (Unidad, Tableta, ml o g)`,
      );

    const presName = text(values.presentation).slice(0, 60);
    if (!presName) errors.push('Falta la presentación');
    const factor = number(values.factor);
    if (factor === null || factor === 'invalid' || factor <= 0)
      errors.push('La equivalencia debe ser un número mayor a 0');
    const price = number(values.price);
    if (price === 'invalid' || (typeof price === 'number' && price < 0))
      errors.push('El precio no es válido');
    const minStock = number(values.minStock);
    if (
      minStock === 'invalid' ||
      (typeof minStock === 'number' && minStock < 0)
    )
      errors.push('El stock mínimo no es válido');

    let stock: ProductImportRow['stock'] = null;
    const qty = number(values.quantity);
    if (qty === 'invalid' || (typeof qty === 'number' && qty < 0))
      errors.push('La cantidad inicial no es válida');
    else if (typeof qty === 'number' && qty > 0) {
      const lot = text(values.lotNumber).slice(0, 40) || null;
      const { value: exp, invalid: badDate } = date(values.expiresAt);
      const cost = number(values.cost);
      if (badDate)
        errors.push('El vencimiento no es válido (usa AAAA-MM-DD)');
      else if (exp && exp < today)
        errors.push('Ese lote ya está vencido: no se puede ingresar');
      if (category && category !== 'ACCESSORY' && (!lot || !exp))
        errors.push('Con cantidad inicial, indica el lote y el vencimiento');
      if (cost === 'invalid' || (typeof cost === 'number' && cost < 0))
        errors.push('El costo no es válido');
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
    const controlled = yes(values.controlled);
    const group = groups.get(key);
    if (group) {
      if (
        group.category !== category ||
        group.baseUnit !== baseUnit ||
        group.controlled !== controlled
      )
        errors.push(
          `El producto está en la fila ${group.row} con otra categoría, unidad o marca de controlado`,
        );
      if (group.presentations.has(normalizeSearch(presName)))
        errors.push(`La presentación «${presName}» está repetida`);
    }
    if (!errors.length) {
      if (group) group.presentations.add(normalizeSearch(presName));
      else
        groups.set(key, {
          row,
          category: category,
          baseUnit: baseUnit,
          controlled,
          presentations: new Set([normalizeSearch(presName)]),
        });
    }

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
      },
      presentation: {
        name: presName,
        factor: typeof factor === 'number' ? factor : 0,
        price: typeof price === 'number' ? Math.round(price * 100) / 100 : null,
      },
      stock,
      status: errors.length ? 'error' : 'ok',
      errors,
    };
  });
}
