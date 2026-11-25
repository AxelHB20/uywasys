import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { clinicDay } from '../src/common/time/clinic-day.js';
import { addDays } from '../src/inventory/expiry.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Importación de productos desde Excel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const exp = addDays(clinicDay('America/Lima'), 200);

  async function login(role: 'ADMIN' | 'VET') {
    const email = `${role.toLowerCase()}-pimp-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: role,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    return String(res.headers['set-cookie']).split(';')[0];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    clinicId = (
      await prisma.clinic.create({
        data: { name: 'Clínica e2e importación productos' },
      })
    ).id;
    cookies.admin = await login('ADMIN');
    cookies.vet = await login('VET');
  });

  afterAll(async () => {
    if (prisma && clinicId) {
      const where = { clinicId };
      await prisma.stockMovement.deleteMany({ where });
      await prisma.productBatch.deleteMany({ where });
      await prisma.productPresentation.deleteMany({ where });
      await prisma.product.deleteMany({ where });
      await prisma.supplier.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinic.delete({ where: { id: clinicId } });
    }
    await app?.close();
  });

  let file: Buffer;

  it('solo el administrador descarga la plantilla; se arma un archivo desde ella', async () => {
    await http()
      .get('/api/inventory/import/template')
      .set('Cookie', cookies.vet)
      .expect(403);
    const res = await http()
      .get('/api/inventory/import/template')
      .set('Cookie', cookies.admin)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const sheet = wb.worksheets[0];
    sheet.spliceRows(2, 4);
    // Por encabezado: el orden de las columnas de la plantilla puede cambiar
    const headers = (sheet.getRow(1).values as unknown[]).map((v) =>
      String(v ?? ''),
    );
    const col = (h: string) => headers.indexOf(h);
    // Sin restos de las filas de ejemplo
    for (let n = 2; n <= 8; n++)
      for (let c = 1; c < headers.length; c++)
        sheet.getRow(n).getCell(c).value = null;
    const put = (n: number, data: Record<string, string | number>) => {
      const row = sheet.getRow(n);
      for (const [h, v] of Object.entries(data)) {
        expect(col(h)).toBeGreaterThan(0);
        row.getCell(col(h)).value = v;
      }
    };
    const mel = {
      Código: 'MEL-1',
      Producto: 'Meloxicam 1 mg',
      Categoría: 'Medicamentos',
      'Unidad mínima': 'Tableta',
    };
    put(2, {
      ...mel,
      Presentación: 'Caja x 100',
      'Equivalencia (unidades mínimas)': 100,
      'Código de barras': '7750000000011',
      'Precio con IGV': 150,
      'Stock mínimo': 50,
      'Con receta (Sí/No)': 'Sí',
      'Controlado (Sí/No)': 'No',
      Lote: 'MX1',
      'Vencimiento (AAAA-MM-DD)': exp,
      'Cantidad inicial (en esta presentación)': 2,
      'Costo por presentación': 90,
      Proveedor: 'Droguería Andina',
    });
    put(3, {
      ...mel,
      Presentación: 'Tableta',
      'Equivalencia (unidades mínimas)': 1,
      'Precio con IGV': 2,
    });
    put(4, {
      Producto: 'Collar isabelino M',
      Categoría: 'Accesorio',
      'Unidad mínima': 'Unid.',
      Presentación: 'Unidad',
      'Equivalencia (unidades mínimas)': 1,
      'Precio con IGV': 25,
      'IGV (Gravado/Exonerado/Inafecto)': 'Exonerado',
      'Stock mínimo': 3,
      'Cantidad inicial (en esta presentación)': 5,
      'Costo por presentación': 9,
    });
    put(5, {
      Producto: 'Vacuna rota',
      Categoría: 'Vacuna',
      'Unidad mínima': 'Unidad',
      Presentación: 'Dosis',
      'Equivalencia (unidades mínimas)': 0,
    });
    // Segundo lote de la misma caja: solo suma stock
    put(6, {
      ...mel,
      Presentación: 'Caja x 100',
      'Equivalencia (unidades mínimas)': 100,
      Lote: 'MX2',
      'Vencimiento (AAAA-MM-DD)': exp,
      'Cantidad inicial (en esta presentación)': 1,
      'Costo por presentación': 95,
      Proveedor: 'droguería andina',
    });
    file = Buffer.from(await wb.xlsx.writeBuffer());
  });

  it('la vista previa resume sin guardar nada', async () => {
    const res = await http()
      .post('/api/inventory/import/preview')
      .set('Cookie', cookies.admin)
      .attach('file', file, 'productos.xlsx')
      .expect(200);
    expect(res.body.summary).toMatchObject({
      rows: 5,
      ok: 4,
      errors: 1,
      products: 2,
      presentations: 3,
      batches: 3,
    });
    expect(await prisma.product.count({ where: { clinicId } })).toBe(0);
  });

  it('importa productos, presentaciones y stock inicial con su kardex; repetir no duplica', async () => {
    const res = await http()
      .post('/api/inventory/import')
      .set('Cookie', cookies.admin)
      .attach('file', file, 'productos.xlsx')
      .expect(201);
    expect(res.body).toEqual({
      products: 2,
      presentations: 3,
      batches: 3,
      skipped: 0,
      errors: 1,
    });

    const mel = await prisma.product.findFirstOrThrow({
      where: { clinicId, code: 'MEL-1' },
      include: { presentations: true, batches: true, movements: true },
    });
    expect(Number(mel.totalStock)).toBe(300);
    expect(mel.batches.map((b) => Number(b.unitCost)).sort()).toEqual([
      0.9, 0.95,
    ]);
    expect(mel.presentations).toHaveLength(2);
    expect(
      mel.presentations.find((p) => p.name === 'Caja x 100')?.barcode,
    ).toBe('7750000000011');
    // El proveedor queda en la lista (uno solo, aunque venga escrito distinto)
    const suppliers = await prisma.supplier.findMany({ where: { clinicId } });
    expect(suppliers.map((x) => x.name)).toEqual(['Droguería Andina']);
    expect(mel.batches.every((b) => b.supplierId === suppliers[0].id)).toBe(
      true,
    );
    const collar = await prisma.product.findFirstOrThrow({
      where: { clinicId, name: 'Collar isabelino M' },
    });
    expect(collar.igv).toBe('EXEMPT');
    expect(mel.requiresPrescription).toBe(true);
    expect(mel.movements[0].reason).toBe('Inventario inicial (importación)');

    const again = await http()
      .post('/api/inventory/import/preview')
      .set('Cookie', cookies.admin)
      .attach('file', file, 'productos.xlsx')
      .expect(200);
    expect(again.body.summary).toMatchObject({ ok: 0, exists: 4, errors: 1 });
  });
});
