import ExcelJS from 'exceljs';
import {
  MAX_IMPORT_BYTES,
  addHelpSheet,
  addList,
  readSheet,
  styleHeader,
} from '../../common/excel/sheet.js';
import { COLUMNS, fieldForHeader } from './import-rows.js';
import type { RawRow } from './import-rows.js';

export { MAX_IMPORT_BYTES };

export function readWorkbook(buffer: Buffer): Promise<RawRow[]> {
  return readSheet(
    buffer,
    COLUMNS,
    fieldForHeader,
    'El archivo no tiene clientes: llena desde la fila 2',
  );
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
  styleHeader(sheet, COLUMNS);
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

  addList(sheet, 'A', ['DNI', 'CE', 'RUC', 'Pasaporte']);
  addList(sheet, 'I', [
    'Perro',
    'Gato',
    'Conejo',
    'Cuy',
    'Ave',
    'Reptil',
    'Otro',
  ]);
  addList(sheet, 'K', ['Macho', 'Hembra']);
  addList(sheet, 'O', ['Sí', 'No']);

  addHelpSheet(workbook, [
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
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
