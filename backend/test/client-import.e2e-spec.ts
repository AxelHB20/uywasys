import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Importación de clientes desde Excel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());

  async function login(role: 'ADMIN' | 'RECEPTION') {
    const email = `${role.toLowerCase()}-imp-${stamp}@uywa.pe`;
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

  /** Toma la plantilla oficial, borra los ejemplos y escribe filas propias. */
  async function workbookFrom(
    template: Buffer,
    rows: (string | number)[][],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template as unknown as ExcelJS.Buffer);
    const sheet = wb.worksheets[0];
    sheet.spliceRows(2, 3);
    rows.forEach((values, i) => {
      sheet.getRow(i + 2).values = values;
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
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
      await prisma.clinic.create({ data: { name: 'Clínica e2e importación' } })
    ).id;
    cookies.admin = await login('ADMIN');
    cookies.reception = await login('RECEPTION');
  });

  afterAll(async () => {
    if (prisma && clinicId) {
      await prisma.pet.deleteMany({ where: { clinicId } });
      await prisma.client.deleteMany({ where: { clinicId } });
      await prisma.auditLog.deleteMany({ where: { clinicId } });
      await prisma.user.deleteMany({ where: { clinicId } });
      await prisma.clinic.delete({ where: { id: clinicId } });
    }
    await app?.close();
  });

  let file: Buffer;

  it('solo el administrador descarga la plantilla', async () => {
    await http()
      .get('/api/clients/import/template')
      .set('Cookie', cookies.reception)
      .expect(403);
    const res = await http()
      .get('/api/clients/import/template')
      .set('Cookie', cookies.admin)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toContain(
      'plantilla-clientes-uywa.xlsx',
    );
    const dni = String(stamp).slice(-8);
    file = await workbookFrom(res.body as Buffer, [
      [
        'DNI',
        dni,
        'Rosa Quispe',
        '987654321',
        '',
        '',
        '',
        'Toby',
        'Perro',
        '',
        'Macho',
        '2022-05-01',
        12.5,
        'Penicilina',
        'Sí',
      ],
      ['DNI', dni, 'Rosa Quispe', '987654321', '', '', '', 'Mishi', 'Gato'],
      ['', '', 'Juan Pérez', '912345678', '', '', '', 'Copito', 'Conejo'],
      ['DNI', '123', 'Mal Documento', '812345678'],
    ]);
  });

  it('rechaza archivos que no son Excel', async () => {
    const res = await http()
      .post('/api/clients/import/preview')
      .set('Cookie', cookies.admin)
      .attach('file', Buffer.from('nombre,celular\n'), 'clientes.csv')
      .expect(400);
    expect(res.body.message).toContain('.xlsx');
  });

  it('la vista previa valida sin guardar nada', async () => {
    const res = await http()
      .post('/api/clients/import/preview')
      .set('Cookie', cookies.admin)
      .attach('file', file, 'clientes.xlsx')
      .expect(200);
    expect(res.body.summary).toMatchObject({
      rows: 4,
      ok: 3,
      errors: 1,
      clients: 2,
      pets: 3,
    });
    expect(res.body.rows[3].errors).toContain('El DNI debe tener 8 dígitos');
    expect(await prisma.client.count({ where: { clinicId } })).toBe(0);
  });

  it('sin declarar el consentimiento no importa', async () => {
    await http()
      .post('/api/clients/import')
      .set('Cookie', cookies.admin)
      .attach('file', file, 'clientes.xlsx')
      .expect(400);
  });

  it('importa las filas válidas con consentimiento IMPORT y no duplica al repetir', async () => {
    const res = await http()
      .post('/api/clients/import')
      .set('Cookie', cookies.admin)
      .field('consentDeclared', 'true')
      .attach('file', file, 'clientes.xlsx')
      .expect(201);
    expect(res.body).toEqual({ clients: 2, pets: 3, skipped: 0, errors: 1 });

    const rosa = await prisma.client.findFirst({
      where: { clinicId, name: 'Rosa Quispe' },
      include: { pets: true },
    });
    expect(rosa?.consentChannel).toBe('IMPORT');
    expect(rosa?.pets.map((p) => p.name).sort()).toEqual(['Mishi', 'Toby']);

    const again = await http()
      .post('/api/clients/import')
      .set('Cookie', cookies.admin)
      .field('consentDeclared', 'true')
      .attach('file', file, 'clientes.xlsx')
      .expect(201);
    expect(again.body).toEqual({ clients: 0, pets: 0, skipped: 3, errors: 1 });
  });
});
