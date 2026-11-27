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
import {
  defaultChargeable,
  defaultTracksExpiry,
} from '../inventory.service.js';
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
    /** Filas que entran con aviso (sin precio, sin costo, vence pronto) */
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
        warnings: ok.filter((r) => r.warnings.length).length,
        products: new Set(ok.map((r) => r.key)).size,
        presentations: ok.filter((r) => !r.extraLot).length,
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
        const supplierIds = await this.suppliersFor(
          tx,
          actor.clinicId,
          rows.filter((r) => r.status === 'ok'),
        );
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
              igv: product.igv,
              chargeable: defaultChargeable(product.category),
              tracksExpiry: defaultTracksExpiry(product.category),
              presentations: {
                create: group
                  .filter((r) => !r.extraLot)
                  .map((r) => ({
                    clinicId: actor.clinicId,
                    name: r.presentation.name,
                    factor: r.presentation.factor,
                    price: r.presentation.price,
                    barcode: r.presentation.barcode,
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
              expiresAt: defaultTracksExpiry(product.category)
                ? s.expiresAt
                : null,
              unitCost:
                s.cost === null
                  ? null
                  : new D(s.cost).div(factor).toDecimalPlaces(4),
              supplier: s.supplier,
              supplierId: s.supplier
                ? (supplierIds.get(normalizeSearch(s.supplier)) ?? null)
                : null,
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
        barcode: '7751234567890',
        price: 150,
        igv: 'Gravado',
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
        code: 'MEL-1',
        name: 'Meloxicam 1 mg',
        category: 'Medicamento',
        baseUnit: 'Tableta',
        presentation: 'Caja x 100',
        factor: 100,
        lotNumber: 'MX2702',
        expiresAt: '2027-08-31',
        quantity: 1,
        cost: 92,
        supplier: 'Droguería Andina',
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
    for (let r = 2; r <= 5; r++)
      sheet.getRow(r).font = { color: { argb: 'FF64748B' }, italic: true };
    // Letra de la columna de cada campo (las listas siguen a la columna aunque cambie el orden)
    const col = (field: string) =>
      String.fromCharCode(
        65 + PRODUCT_COLUMNS.findIndex((c) => c.field === field),
      );
    sheet.getColumn('barcode').numFmt = '@';
    addList(sheet, col('category'), [
      'Medicamento',
      'Vacuna',
      'Antiparasitario',
      'Alimento',
      'Accesorio',
      'Higiene',
      'Insumo',
    ]);
    addList(sheet, col('baseUnit'), ['Unidad', 'Tableta', 'Caja', 'Frasco']);
    addList(sheet, col('igv'), ['Gravado', 'Exonerado', 'Inafecto']);
    addList(sheet, col('requiresPrescription'), ['Sí', 'No']);
    addList(sheet, col('controlled'), ['Sí', 'No']);
    addHelpSheet(workbook, [
      'Cómo llenar la plantilla de productos de Uywa',
      '',
      '• Una fila = una presentación. Si un producto se vende en caja y por tableta, escribe dos filas con el mismo nombre (o el mismo código).',
      '• Unidad mínima: en la que se cuenta el stock (Unidad, Tableta, Caja o Frasco; se vende entero). Equivalencia: cuántas unidades mínimas trae la presentación (Caja x 100 = 100).',
      '• Precio con IGV incluido, el de la etiqueta. IGV: Gravado si lo dejas vacío (Exonerado o Inafecto solo si tu contador lo indica).',
      '• Código de barras (opcional): el de la caja o del producto, si usan lector.',
      '• Stock inicial (opcional): cantidad en esa presentación y su vencimiento (AAAA-MM-DD). El lote es obligatorio en vacunas y controlados; en lo demás, si no lo tienes, déjalo vacío. Los accesorios no llevan lote ni vencimiento.',
      '• ¿Dos lotes del mismo producto? Repite la fila de la presentación con la cantidad, lote y vencimiento del otro lote.',
      '• Los avisos en ámbar (sin precio, sin costo, vence pronto) no impiden importar.',
      '• Si una fila de un producto tiene error, ese producto no se importa hasta corregirlo.',
      '• Si el producto ya existe en Uywa (mismo código o mismo nombre), se salta: la importación nunca sobrescribe.',
      '• Borra las filas de ejemplo (en gris) antes de importar. Máximo 2000 filas y 2 MB.',
    ]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Proveedores de la lista por nombre; los que no están se crean (sin RUC) */
  private async suppliersFor(
    tx: Prisma.TransactionClient,
    clinicId: number,
    rows: ProductImportRow[],
  ): Promise<Map<string, number>> {
    const names = new Map<string, string>();
    for (const r of rows) {
      if (!r.stock?.supplier) continue;
      // Gana la primera forma escrita ("Droguería Andina" antes que "droguería andina")
      const key = normalizeSearch(r.stock.supplier).slice(0, 150);
      if (key && !names.has(key)) names.set(key, r.stock.supplier);
    }
    const ids = new Map<string, number>();
    if (!names.size) return ids;
    const found = await tx.supplier.findMany({
      where: { clinicId, nameSearch: { in: [...names.keys()] } },
      select: { id: true, nameSearch: true },
      orderBy: { id: 'asc' },
    });
    for (const f of found)
      if (!ids.has(f.nameSearch)) ids.set(f.nameSearch, f.id);
    for (const [key, name] of names)
      if (!ids.has(key)) {
        const created = await tx.supplier.create({
          data: { clinicId, name: name.slice(0, 150), nameSearch: key },
          select: { id: true },
        });
        ids.set(key, created.id);
      }
    return ids;
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
        r.warnings = [];
      }
    }
    await this.markUsedBarcodes(clinicId, rows);
  }

  /** Un código de barras que ya usa otro producto confundiría al buscar con el lector */
  private async markUsedBarcodes(
    clinicId: number,
    rows: ProductImportRow[],
  ): Promise<void> {
    const ok = rows.filter((r) => r.status === 'ok' && r.presentation.barcode);
    if (!ok.length) return;
    const codes = [...new Set(ok.map((r) => r.presentation.barcode!))];
    const [presentations, products] = await Promise.all([
      this.prisma.productPresentation.findMany({
        where: { clinicId, barcode: { in: codes } },
        select: { barcode: true, product: { select: { name: true } } },
      }),
      this.prisma.product.findMany({
        where: { clinicId, barcode: { in: codes } },
        select: { barcode: true, name: true },
      }),
    ]);
    const used = new Map<string, string>();
    for (const p of presentations) used.set(p.barcode!, p.product.name);
    for (const p of products) used.set(p.barcode!, p.name);
    for (const r of ok) {
      const owner = used.get(r.presentation.barcode!);
      if (owner) {
        r.status = 'error';
        r.errors = [`El código de barras ya lo usa «${owner}»`];
        r.warnings = [];
      }
    }
    // Se importa completo o no se importa
    const failed = new Map<string, number>();
    for (const r of rows)
      if (r.status === 'error' && !failed.has(r.key)) failed.set(r.key, r.row);
    for (const r of rows)
      if (r.status === 'ok' && failed.has(r.key)) {
        r.status = 'error';
        r.errors = [
          `Corrige la fila ${failed.get(r.key)} de este mismo producto; se importa completo o no se importa`,
        ];
        r.warnings = [];
      }
  }
}
