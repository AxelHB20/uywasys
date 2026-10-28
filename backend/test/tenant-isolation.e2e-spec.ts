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
import { PRODUCT_COLUMNS } from '../src/inventory/import/product-rows.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Aislamiento entre clínicas (cada clínica es un cliente distinto del SaaS).
 * La clínica B nunca debe ver, cambiar ni usar nada de la clínica A, aunque conozca sus ids.
 * Requiere la base de datos levantada y las migraciones aplicadas.
 */
describe('Aislamiento entre clínicas: inventario y servicios (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinic: Record<'A' | 'B', number> = { A: 0, B: 0 };
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const exp = addDays(clinicDay('America/Lima'), 200);
  const http = () => request(app.getHttpServer());

  // Datos de la clínica A
  const a = { product: 0, presentation: 0, batch: 0, service: 0, pet: 0 };
  // Datos propios de la clínica B
  const b = { product: 0, presentation: 0, batch: 0 };

  async function login(key: 'A' | 'B', role: 'ADMIN' | 'VET') {
    const email = `${role.toLowerCase()}-${key.toLowerCase()}-iso-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId: clinic[key],
        fullName: `${role} ${key}`,
        email,
        role,
        licenseNumber: role === 'VET' ? `CMVP-${key}` : null,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    return String(res.headers['set-cookie']).split(';')[0];
  }

  async function createProduct(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<{ product: number; presentation: number; batch: number }> {
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookie)
      .send({
        category: 'MEDICINE',
        baseUnit: 'ML',
        minStock: 50,
        presentations: [{ name: 'Frasco x 10 ml', factor: 10, price: 80 }],
        ...body,
      })
      .expect(201);
    const presentation = res.body.presentations[0].id as number;
    const bought = await http()
      .post(`/api/inventory/products/${res.body.id}/purchases`)
      .set('Cookie', cookie)
      .send({
        presentationId: presentation,
        quantity: 2,
        lotNumber: 'L1',
        expiresAt: exp,
      })
      .expect(201);
    return {
      product: res.body.id,
      presentation,
      batch: bought.body.batches[0].id,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const key of ['A', 'B'] as const) {
      clinic[key] = (
        await prisma.clinic.create({
          data: { name: `Clínica ${key} aislamiento` },
        })
      ).id;
      cookies[`admin${key}`] = await login(key, 'ADMIN');
      cookies[`vet${key}`] = await login(key, 'VET');
    }

    // Clínica A: producto controlado con stock, un tratamiento registrado y un servicio que lo usa
    Object.assign(
      a,
      await createProduct(cookies.adminA, {
        code: 'KET-1',
        name: 'Ketamina 50 mg/ml',
        controlled: true,
      }),
    );
    const client = await prisma.client.create({
      data: {
        clinicId: clinic.A,
        number: 1,
        name: 'Cliente A',
        phone: '987654321',
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: 'cliente a',
        pets: {
          create: {
            clinicId: clinic.A,
            number: 1,
            name: 'Toby',
            nameSearch: 'toby',
            species: 'DOG',
          },
        },
      },
      include: { pets: true },
    });
    a.pet = client.pets[0].id;
    await http()
      .post(`/api/inventory/products/${a.product}/outflows`)
      .set('Cookie', cookies.vetA)
      .send({
        type: 'TREATMENT',
        quantity: 2,
        reason: 'Cirugía',
        petId: a.pet,
        prescriptionRef: 'R-1',
      })
      .expect(201);
    a.service = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.adminA)
        .send({
          name: 'Castración',
          category: 'SURGERY',
          price: 180,
          supplies: [{ productId: a.product, quantity: 2 }],
        })
        .expect(201)
    ).body.id;

    // Clínica B: su propio producto
    Object.assign(
      b,
      await createProduct(cookies.adminB, { name: 'Meloxicam gotas' }),
    );
  });

  afterAll(async () => {
    const ids = Object.values(clinic).filter(Boolean);
    if (prisma && ids.length) {
      const where = { clinicId: { in: ids } };
      await prisma.careServiceSupply.deleteMany({
        where: { service: { clinicId: { in: ids } } },
      });
      await prisma.careService.deleteMany({ where });
      await prisma.stockMovement.deleteMany({ where });
      await prisma.productBatch.deleteMany({ where });
      await prisma.productPresentation.deleteMany({ where });
      await prisma.product.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  it('B no ve los productos de A en su lista, alertas ni libro de controlados', async () => {
    const list = await http()
      .get('/api/inventory/products?status=all')
      .set('Cookie', cookies.adminB)
      .expect(200);
    expect(list.body.items.map((p: { id: number }) => p.id)).toEqual([
      b.product,
    ]);

    const alerts = await http()
      .get('/api/inventory/alerts')
      .set('Cookie', cookies.adminB)
      .expect(200);
    expect(JSON.stringify(alerts.body)).not.toContain('Ketamina');

    const controlled = await http()
      .get('/api/inventory/controlled')
      .set('Cookie', cookies.adminB)
      .expect(200);
    expect(JSON.stringify(controlled.body)).not.toContain('Ketamina');

    // A sí lo ve: la prueba no pasa por estar vacío
    const own = await http()
      .get('/api/inventory/controlled')
      .set('Cookie', cookies.adminA)
      .expect(200);
    expect(JSON.stringify(own.body)).toContain('Ketamina');
  });

  it('B recibe 404 al leer o cambiar un producto de A, aunque conozca su id', async () => {
    const url = `/api/inventory/products/${a.product}`;
    const B = cookies.adminB;
    await http().get(url).set('Cookie', B).expect(404);
    await http().get(`${url}/movements`).set('Cookie', B).expect(404);
    await http()
      .patch(url)
      .set('Cookie', B)
      .send({ name: 'Hackeado' })
      .expect(404);
    await http()
      .post(`${url}/presentations`)
      .set('Cookie', B)
      .send({ name: 'Ampolla', factor: 1, price: 5 })
      .expect(404);
    await http()
      .patch(`/api/inventory/presentations/${a.presentation}`)
      .set('Cookie', B)
      .send({ price: 1 })
      .expect(404);
    await http()
      .post(`${url}/purchases`)
      .set('Cookie', B)
      .send({
        presentationId: a.presentation,
        quantity: 1,
        lotNumber: 'X',
        expiresAt: exp,
      })
      .expect(404);
    await http()
      .post(`${url}/outflows`)
      .set('Cookie', B)
      .send({ type: 'WASTE', quantity: 1, reason: 'Roto' })
      .expect(404);
    await http()
      .post(`${url}/counts`)
      .set('Cookie', B)
      .send({ reason: 'Conteo', items: [{ batchId: a.batch, counted: 0 }] })
      .expect(404);

    // Nada cambió en A
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: a.product },
    });
    expect(product.name).toBe('Ketamina 50 mg/ml');
    expect(Number(product.totalStock)).toBe(18);
    const presentation = await prisma.productPresentation.findUniqueOrThrow({
      where: { id: a.presentation },
    });
    expect(Number(presentation.price)).toBe(80);
  });

  it('B no puede usar lotes, presentaciones ni mascotas de A dentro de sus propios productos', async () => {
    const url = `/api/inventory/products/${b.product}`;
    await http()
      .post(`${url}/purchases`)
      .set('Cookie', cookies.adminB)
      .send({
        presentationId: a.presentation,
        quantity: 1,
        lotNumber: 'X',
        expiresAt: exp,
      })
      .expect(400);
    await http()
      .post(`${url}/counts`)
      .set('Cookie', cookies.adminB)
      .send({ reason: 'Conteo', items: [{ batchId: a.batch, counted: 0 }] })
      .expect(400);
    const outflow = await http()
      .post(`${url}/outflows`)
      .set('Cookie', cookies.vetB)
      .send({ type: 'WASTE', quantity: 1, reason: 'Roto', batchId: a.batch });
    expect(outflow.status).toBeGreaterThanOrEqual(400);
    const treatment = await http()
      .post(`${url}/outflows`)
      .set('Cookie', cookies.vetB)
      .send({
        type: 'TREATMENT',
        quantity: 1,
        reason: 'Aplicación',
        petId: a.pet,
      });
    expect([400, 404]).toContain(treatment.status);

    const batchA = await prisma.productBatch.findUniqueOrThrow({
      where: { id: a.batch },
    });
    expect(Number(batchA.quantity)).toBe(18);
  });

  it('servicios: B no ve ni edita los de A, ni usa productos de A como insumo', async () => {
    const list = await http()
      .get('/api/care-services')
      .set('Cookie', cookies.adminB)
      .expect(200);
    expect(list.body).toEqual([]);
    await http()
      .patch(`/api/care-services/${a.service}`)
      .set('Cookie', cookies.adminB)
      .send({ price: 1 })
      .expect(404);
    const res = await http()
      .post('/api/care-services')
      .set('Cookie', cookies.adminB)
      .send({
        name: 'Castración',
        category: 'SURGERY',
        price: 150,
        supplies: [{ productId: a.product, quantity: 1 }],
      });
    expect([400, 404]).toContain(res.status);
    // El mismo nombre en otra clínica no choca
    await http()
      .post('/api/care-services')
      .set('Cookie', cookies.adminB)
      .send({ name: 'Castración', category: 'SURGERY', price: 150 })
      .expect(201);
    const service = await prisma.careService.findUniqueOrThrow({
      where: { id: a.service },
    });
    expect(Number(service.price)).toBe(180);
  });

  it('importar: un código que existe en A es nuevo para B y queda solo en B', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Productos');
    sheet.addRow(PRODUCT_COLUMNS.map((c) => c.header));
    sheet.addRow([
      'KET-1',
      'Ketamina B',
      'Medicamento',
      'ml',
      'Frasco x 10 ml',
      10,
      90,
    ]);
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const preview = await http()
      .post('/api/inventory/import/preview')
      .set('Cookie', cookies.adminB)
      .attach('file', file, 'productos.xlsx')
      .expect(200);
    expect(preview.body.rows[0].status).toBe('ok');
    await http()
      .post('/api/inventory/import')
      .set('Cookie', cookies.adminB)
      .attach('file', file, 'productos.xlsx')
      .expect(201);

    const ket = await prisma.product.findMany({
      where: { code: 'KET-1', clinicId: { in: [clinic.A, clinic.B] } },
      select: { clinicId: true, name: true },
      orderBy: { id: 'asc' },
    });
    expect(ket).toEqual([
      { clinicId: clinic.A, name: 'Ketamina 50 mg/ml' },
      { clinicId: clinic.B, name: 'Ketamina B' },
    ]);
  });
});
