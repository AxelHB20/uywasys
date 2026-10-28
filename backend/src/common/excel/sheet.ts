import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

export interface SheetColumn<F extends string> {
  field: F;
  header: string;
  required?: boolean;
  width: number;
}

export interface SheetRow<F extends string> {
  row: number;
  values: Partial<Record<F, string | Date>>;
}

/** Un .xlsx es un ZIP: empieza con "PK\x03\x04". */
export function isXlsx(buffer: Buffer): boolean {
  return (
    buffer.length > 4 &&
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  );
}

/** Texto de una celda de exceljs (fórmulas, enlaces y texto enriquecido incluidos). */
export function cellValue(value: ExcelJS.CellValue): string | Date {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result as ExcelJS.CellValue);
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('richText' in value)
      return value.richText.map((part) => part.text).join('');
    return '';
  }
  return String(value as string | number | boolean);
}

/**
 * Lee la primera hoja: la fila 1 son los encabezados (reconocidos con `fieldOf`),
 * se saltan las filas vacías y se valida el máximo de filas.
 */
export async function readSheet<F extends string>(
  buffer: Buffer,
  columns: SheetColumn<F>[],
  fieldOf: (header: string) => F | null,
  emptyMessage: string,
): Promise<SheetRow<F>[]> {
  if (!isXlsx(buffer))
    throw new BadRequestException(
      'Sube un archivo de Excel (.xlsx). Usa la plantilla de Uywa.',
    );
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new BadRequestException(
      'No se pudo leer el archivo. Guárdalo de nuevo como .xlsx e inténtalo otra vez.',
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('El archivo no tiene hojas');

  const fields = new Map<number, F>();
  sheet.getRow(1).eachCell((cell, col) => {
    const field = fieldOf(String(cellValue(cell.value)));
    if (field && ![...fields.values()].includes(field)) fields.set(col, field);
  });
  const missing = columns.filter(
    (c) => c.required && ![...fields.values()].includes(c.field),
  );
  if (missing.length)
    throw new BadRequestException(
      `Faltan columnas en la fila 1: ${missing.map((c) => c.header).join(', ')}. Usa la plantilla de Uywa.`,
    );

  const rows: SheetRow<F>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: SheetRow<F>['values'] = {};
    let filled = false;
    for (const [col, field] of fields) {
      const value = cellValue(row.getCell(col).value);
      if (value instanceof Date || value.trim()) filled = true;
      values[field] = value;
    }
    if (filled) rows.push({ row: rowNumber, values });
  });
  if (rows.length === 0) throw new BadRequestException(emptyMessage);
  if (rows.length > MAX_IMPORT_ROWS)
    throw new BadRequestException(
      `El archivo tiene ${rows.length} filas; el máximo es ${MAX_IMPORT_ROWS}. Divídelo en varios archivos.`,
    );
  return rows;
}

/** Encabezado con color (los obligatorios más oscuros) y fila congelada. */
export function styleHeader<F extends string>(
  sheet: ExcelJS.Worksheet,
  columns: SheetColumn<F>[],
): void {
  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell((cell, col) => {
    const required = columns[col - 1]?.required;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: required ? 'FF2D2E8C' : 'FF4446C8' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
}

/** Lista desplegable en una columna (A2:A2001). exceljs la soporta aunque sus tipos no la declaren. */
export function addList(
  sheet: ExcelJS.Worksheet,
  col: string,
  values: string[],
): void {
  const validations = (
    sheet as unknown as {
      dataValidations: {
        add(range: string, rule: ExcelJS.DataValidation): void;
      };
    }
  ).dataValidations;
  const joined = values.join(',');
  validations.add(`${col}2:${col}${MAX_IMPORT_ROWS + 1}`, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${joined}"`],
    showErrorMessage: true,
    errorTitle: 'Valor no válido',
    error: `Elige uno de la lista: ${joined}`,
  });
}

/** Hoja de instrucciones: primera línea en negrita. */
export function addHelpSheet(
  workbook: ExcelJS.Workbook,
  lines: string[],
): void {
  const help = workbook.addWorksheet('Instrucciones');
  help.getColumn(1).width = 110;
  lines.forEach((line, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = line;
    cell.alignment = { wrapText: true };
    if (i === 0) cell.font = { bold: true, size: 14 };
  });
}
