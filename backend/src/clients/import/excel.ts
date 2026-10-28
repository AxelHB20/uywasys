import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { COLUMNS, fieldForHeader } from './import-rows.js';
import type { ImportField, RawRow } from './import-rows.js';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

/** Un .xlsx es un ZIP: empieza con "PK\x03\x04". */
export function isXlsx(buffer: Buffer): boolean {
  return (
    buffer.length > 4 &&
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  );
}

/** Texto de una celda de exceljs (fórmulas, enlaces y texto enriquecido incluidos). */
function cellValue(value: ExcelJS.CellValue): string | Date {
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

/** Lee la primera hoja: la fila 1 son los encabezados; se saltan las filas vacías. */
export async function readWorkbook(buffer: Buffer): Promise<RawRow[]> {
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

  const fields = new Map<number, ImportField>();
  sheet.getRow(1).eachCell((cell, col) => {
    const field = fieldForHeader(String(cellValue(cell.value)));
    if (field && ![...fields.values()].includes(field)) fields.set(col, field);
  });
  const missing = COLUMNS.filter(
    (c) => c.required && ![...fields.values()].includes(c.field),
  );
  if (missing.length)
    throw new BadRequestException(
      `Faltan columnas en la fila 1: ${missing.map((c) => c.header).join(', ')}. Usa la plantilla de Uywa.`,
    );

  const rows: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: RawRow['values'] = {};
    let filled = false;
    for (const [col, field] of fields) {
      const value = cellValue(row.getCell(col).value);
      if (value instanceof Date || value.trim()) filled = true;
      values[field] = value;
    }
    if (filled) rows.push({ row: rowNumber, values });
  });
  if (rows.length === 0)
    throw new BadRequestException(
      'El archivo no tiene clientes: llena desde la fila 2',
    );
  if (rows.length > MAX_IMPORT_ROWS)
    throw new BadRequestException(
      `El archivo tiene ${rows.length} filas; el máximo es ${MAX_IMPORT_ROWS}. Divídelo en varios archivos.`,
    );
  return rows;
}

/** Plantilla con listas desplegables, columnas de texto para no perder ceros y una hoja de instrucciones. */
export async function buildTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Uywa';
  const sheet = workbook.addWorksheet('Clientes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.field,
    width: c.width,
  }));

  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell((cell, col) => {
    const required = COLUMNS[col - 1]?.required;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: required ? 'FF2D2E8C' : 'FF4446C8' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  // Documento y celular como texto: Excel no se come los ceros
  for (const key of ['docNumber', 'phone']) sheet.getColumn(key).numFmt = '@';

  sheet.addRows([
    {
      docType: 'DNI',
      docNumber: '45678912',
      name: 'Rosa Quispe Mamani',
      phone: '987654321',
      email: 'rosa@correo.com',
      district: 'Chosica',
      petName: 'Toby',
      species: 'Perro',
      breed: 'Mestizo',
      sex: 'Macho',
      birthDate: '2022-05-01',
      weightKg: 12.5,
      allergies: '',
      neutered: 'Sí',
    },
    {
      docType: 'DNI',
      docNumber: '45678912',
      name: 'Rosa Quispe Mamani',
      phone: '987654321',
      petName: 'Mishi',
      species: 'Gato',
      sex: 'Hembra',
      neutered: 'No',
    },
    {
      docType: '',
      docNumber: '',
      name: 'Juan Pérez',
      phone: '912345678',
      petName: 'Copito',
      species: 'Conejo',
    },
  ]);
  for (let r = 2; r <= 4; r++)
    sheet.getRow(r).font = { color: { argb: 'FF64748B' }, italic: true };

  const last = MAX_IMPORT_ROWS + 1;
  // exceljs tiene validaciones por rango, pero sus tipos no lo declaran
  const validations = (
    sheet as unknown as {
      dataValidations: {
        add(range: string, rule: ExcelJS.DataValidation): void;
      };
    }
  ).dataValidations;
  const list = (col: string, values: string) =>
    validations.add(`${col}2:${col}${last}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`"${values}"`],
      showErrorMessage: true,
      errorTitle: 'Valor no válido',
      error: `Elige uno de la lista: ${values}`,
    });
  list('A', 'DNI,CE,RUC,Pasaporte');
  list('I', 'Perro,Gato,Conejo,Cuy,Ave,Reptil,Otro');
  list('K', 'Macho,Hembra');
  list('O', 'Sí,No');

  const help = workbook.addWorksheet('Instrucciones');
  help.getColumn(1).width = 110;
  [
    'Cómo llenar la plantilla de clientes de Uywa',
    '',
    '• Una fila = un cliente con una mascota. Si el cliente tiene varias mascotas, repite su documento, nombre y celular en otra fila.',
    '• Obligatorios: nombre del cliente y celular (9 dígitos, empieza con 9). Si escribes una mascota, también su especie.',
    '• Documento: DNI (8 dígitos), CE, RUC (11 dígitos) o Pasaporte. Puede quedar vacío si el cliente no lo dio.',
    '• Fecha de nacimiento: AAAA-MM-DD (ej.: 2022-05-01). Si no la sabes, déjala vacía.',
    '• Borra las filas de ejemplo (en gris) antes de importar.',
    '• Si un documento ya existe en Uywa, esa fila se salta: la importación nunca sobrescribe datos.',
    '• Máximo 2000 filas y 2 MB por archivo.',
    '',
    'Protección de datos (Ley N.º 29733): importa solo clientes que autorizaron a la clínica a usar sus datos.',
  ].forEach((line, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = line;
    cell.alignment = { wrapText: true };
    if (i === 0) cell.font = { bold: true, size: 14 };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
