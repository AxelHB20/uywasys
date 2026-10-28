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
    sheet.spliceRows(2, 3);
    [
      [
        'MEL-1',
        'Meloxicam 1 mg',
        'Medicamento',
        'Tableta',
        'Caja x 100',
        100,
        150,
        50,
        'Sí',
        'No',
        'MX1',
        exp,
        2,
        90,
        'Droguería Andina',
      ],
      ['MEL-1', 'Meloxicam 1 mg', 'Medicamento', 'Tableta', 'Tableta', 1, 2],
      [
        '',
        'Collar isabelino M',
        'Accesorio',
        'Unidad',
        'Unidad',
        1,
        25,
        3,
        '',
        '',
        '',
        '',
        5,
        9,
      ],
      ['', 'Vacuna rota', 'Vacuna', 'Unidad', 'Dosis', 0],
    ].forEach((values, i) => {
      sheet.getRow(i + 2).values = values;
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
      rows: 4,
      ok: 3,
      errors: 1,
      products: 2,
      presentations: 3,
      batches: 2,
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
      batches: 2,
      skipped: 0,
      errors: 1,
    });

    const mel = await prisma.product.findFirstOrThrow({
      where: { clinicId, code: 'MEL-1' },
      include: { presentations: true, batches: true, movements: true },
    });
    expect(Number(mel.totalStock)).toBe(200);
    expect(Number(mel.batches[0].unitCost)).toBe(0.9);
    expect(mel.presentations).toHaveLength(2);
    expect(mel.requiresPrescription).toBe(true);
    expect(mel.movements[0].reason).toBe('Inventario inicial (importación)');

    const again = await http()
      .post('/api/inventory/import/preview')
      .set('Cookie', cookies.admin)
      .attach('file', file, 'productos.xlsx')
      .expect(200);
    expect(again.body.summary).toMatchObject({ ok: 0, exists: 3, errors: 1 });
  });
});
