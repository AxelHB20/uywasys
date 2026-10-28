import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  addHelpSheet,
  addList,
  readSheet,
  styleHeader,
} from '../../common/excel/sheet.js';
import { normalizeSearch } from '../../common/text/search.js';
import { clinicToday } from '../../common/time/clinic-today.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StockService } from '../stock.service.js';
import {
  PRODUCT_COLUMNS,
  productFieldFor,
  validateProductRows,
} from './product-rows.js';
import type { ProductImportRow } from './product-rows.js';

const D = Prisma.Decimal;

export interface ProductImportPreview {
  rows: ProductImportRow[];
  summary: {
    rows: number;
    ok: number;
    exists: number;
    errors: number;
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

/** Carga inicial del inventario desde Excel. Nunca sobrescribe productos existentes. */
@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async preview(
    clinicId: number,
    buffer: Buffer,
  ): Promise<ProductImportPreview> {
    const today = await clinicToday(this.prisma, clinicId);
    const raw = await readSheet(
      buffer,
      PRODUCT_COLUMNS,
      productFieldFor,
      'El archivo no tiene productos: llena desde la fila 2',
    );
    const rows = validateProductRows(raw, today);
    await this.markExisting(clinicId, rows);
    const ok = rows.filter((r) => r.status === 'ok');
    return {
      rows,
      summary: {
        rows: rows.length,
        ok: ok.length,
        exists: rows.filter((r) => r.status === 'exists').length,
        errors: rows.filter((r) => r.status === 'error').length,
        products: new Set(ok.map((r) => r.key)).size,
        presentations: ok.length,
        batches: ok.filter((r) => r.stock).length,
      },
    };
  }

  async import(
    actor: AuthUser,
    buffer: Buffer,
    ip?: string,
  ): Promise<ProductImportResult> {
    const { rows, summary } = await this.preview(actor.clinicId, buffer);
    const groups = new Map<string, ProductImportRow[]>();
    for (const r of rows.filter((x) => x.status === 'ok'))
      groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
    if (!groups.size)
      throw new BadRequestException('No hay filas correctas para importar');

    await this.prisma.$transaction(
      async (tx) => {
        for (const group of groups.values()) {
          const { product } = group[0];
          const created = await tx.product.create({
            data: {
              clinicId: actor.clinicId,
              code: product.code,
              name: product.name,
              nameSearch: normalizeSearch(product.name).slice(0, 120),
              category: product.category,
              baseUnit: product.baseUnit,
              minStock: product.minStock,
              requiresPrescription: product.requiresPrescription,
              controlled: product.controlled,
              presentations: {
                create: group.map((r) => ({
                  clinicId: actor.clinicId,
                  name: r.presentation.name,
                  factor: r.presentation.factor,
                  price: r.presentation.price,
                })),
              },
            },
            select: { id: true },
          });
          for (const r of group.filter((x) => x.stock)) {
            const s = r.stock!;
            const factor = new D(r.presentation.factor);
            await this.stock.receive(tx, {
              clinicId: actor.clinicId,
              productId: created.id,
              userId: actor.id,
              quantity: new D(s.quantity).times(factor),
              lotNumber: s.lotNumber,
              expiresAt: s.expiresAt,
              unitCost:
                s.cost === null
                  ? null
                  : new D(s.cost).div(factor).toDecimalPlaces(4),
              supplier: s.supplier,
              documentNumber: null,
              reason: 'Inventario inicial (importación)',
            });
          }
        }
      },
      { timeout: 120_000 },
    );

    const result = {
      products: groups.size,
      presentations: summary.presentations,
      batches: summary.batches,
      skipped: summary.exists,
      errors: summary.errors,
    };
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'product.import',
      entity: 'product',
      ip,
      data: { ...result },
    });
    return result;
  }

  async template(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Uywa';
    const sheet = workbook.addWorksheet('Productos', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = PRODUCT_COLUMNS.map((c) => ({
      header: c.header,
      key: c.field,
      width: c.width,
    }));
    styleHeader(sheet, PRODUCT_COLUMNS);
    sheet.getColumn('code').numFmt = '@';
    sheet.getColumn('lotNumber').numFmt = '@';
    sheet.addRows([
      {
        code: 'MEL-1',
        name: 'Meloxicam 1 mg',
        category: 'Medicamento',
        baseUnit: 'Tableta',
        presentation: 'Caja x 100',
        factor: 100,
        price: 150,
        minStock: 50,
        requiresPrescription: 'Sí',
        controlled: 'No',
        lotNumber: 'MX2611',
        expiresAt: '2027-03-31',
        quantity: 2,
        cost: 90,
        supplier: 'Droguería Andina',
      },
      {
        code: 'MEL-1',
        name: 'Meloxicam 1 mg',
        category: 'Medicamento',
        baseUnit: 'Tableta',
        presentation: 'Tableta',
        factor: 1,
        price: 2,
      },
      {
        name: 'Collar isabelino talla M',
        category: 'Accesorio',
        baseUnit: 'Unidad',
        presentation: 'Unidad',
        factor: 1,
        price: 25,
        minStock: 3,
        quantity: 5,
        cost: 9,
      },
    ]);
    for (let r = 2; r <= 4; r++)
      sheet.getRow(r).font = { color: { argb: 'FF64748B' }, italic: true };
    addList(sheet, 'C', [
      'Medicamento',
      'Vacuna',
      'Antiparasitario',
      'Alimento',
      'Accesorio',
      'Higiene',
      'Insumo',
    ]);
    addList(sheet, 'D', ['Unidad', 'Tableta', 'ml', 'g']);
    addList(sheet, 'I', ['Sí', 'No']);
    addList(sheet, 'J', ['Sí', 'No']);
    addHelpSheet(workbook, [
      'Cómo llenar la plantilla de productos de Uywa',
      '',
      '• Una fila = una presentación. Si un producto se vende en caja y por tableta, escribe dos filas con el mismo nombre (o el mismo código).',
      '• Unidad mínima: en la que se cuenta el stock (Tableta, ml, g o Unidad). Equivalencia: cuántas unidades mínimas trae la presentación (Caja x 100 = 100).',
      '• Precio con IGV incluido, el de la etiqueta.',
      '• Stock inicial (opcional): cantidad en esa presentación, con lote y vencimiento (AAAA-MM-DD). Los accesorios no llevan lote ni vencimiento.',
      '• Si una fila de un producto tiene error, ese producto no se importa hasta corregirlo.',
      '• Si el producto ya existe en Uywa (mismo código o mismo nombre), se salta: la importación nunca sobrescribe.',
      '• Borra las filas de ejemplo (en gris) antes de importar. Máximo 2000 filas y 2 MB.',
    ]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Ya existe si coincide el código o el nombre (sin tildes ni mayúsculas). */
  private async markExisting(
    clinicId: number,
    rows: ProductImportRow[],
  ): Promise<void> {
    const ok = rows.filter((r) => r.status === 'ok');
    if (!ok.length) return;
    const codes = [
      ...new Set(ok.map((r) => r.product.code).filter((c): c is string => !!c)),
    ];
    const names = [...new Set(ok.map((r) => normalizeSearch(r.product.name)))];
    const found = await this.prisma.product.findMany({
      where: {
        clinicId,
        OR: [
          ...(codes.length
            ? [{ code: { in: codes, mode: 'insensitive' as const } }]
            : []),
          { nameSearch: { in: names } },
        ],
      },
      select: { code: true, nameSearch: true },
    });
    const byCode = new Set(
      found.map((f) => f.code?.toUpperCase()).filter(Boolean),
    );
    const byName = new Set(found.map((f) => f.nameSearch));
    for (const r of ok) {
      if (
        (r.product.code && byCode.has(r.product.code.toUpperCase())) ||
        byName.has(normalizeSearch(r.product.name))
      ) {
        r.status = 'exists';
        r.errors = ['Ya existe en el inventario: se salta'];
      }
    }
  }
}
