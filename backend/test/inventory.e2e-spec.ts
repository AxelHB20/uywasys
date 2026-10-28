import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { clinicDay } from '../src/common/time/clinic-day.js';
import { addDays } from '../src/inventory/expiry.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Inventario: FEFO, kardex y permisos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  let petId: number;
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());

  async function login(
    role: 'ADMIN' | 'VET' | 'RECEPTION',
    licenseNumber?: string,
  ) {
    const email = `${role.toLowerCase()}-inv-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} Inventario`,
        email,
        role,
        licenseNumber: licenseNumber ?? null,
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
      await prisma.clinic.create({ data: { name: 'Clínica e2e inventario' } })
    ).id;
    cookies.admin = await login('ADMIN');
    cookies.vet = await login('VET', 'CMVP-1234');
    cookies.reception = await login('RECEPTION');
    const client = await prisma.client.create({
      data: {
        clinicId,
        number: 1,
        name: 'Rosa Quispe',
        phone: '987654321',
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: 'rosa quispe',
        pets: {
          create: {
            clinicId,
            number: 1,
            name: 'Toby',
            nameSearch: 'toby',
            species: 'DOG',
          },
        },
      },
      include: { pets: true },
    });
    petId = client.pets[0].id;
  });

  afterAll(async () => {
    if (prisma && clinicId) {
      const where = { clinicId };
      await prisma.stockMovement.deleteMany({ where });
      await prisma.careServiceSupply.deleteMany({
        where: { service: { clinicId } },
      });
      await prisma.careService.deleteMany({ where });
      await prisma.productBatch.deleteMany({ where });
      await prisma.productPresentation.deleteMany({ where });
      await prisma.product.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where: { clinicId } });
      await prisma.clinic.delete({ where: { id: clinicId } });
    }
    await app?.close();
  });

  let productId: number;
  let caja: number;
  let blister: number;
  const batch: Record<string, number> = {};

  const outflow = (cookie: string, body: Record<string, unknown>) =>
    http()
      .post(`/api/inventory/products/${productId}/outflows`)
      .set('Cookie', cookie)
      .send(body);
  const batchQty = async (id: number) =>
    Number(
      (await prisma.productBatch.findUniqueOrThrow({ where: { id } })).quantity,
    );
  const total = async () =>
    Number(
      (await prisma.product.findUniqueOrThrow({ where: { id: productId } }))
        .totalStock,
    );

  it('recepción no crea productos; el veterinario sí, con sus presentaciones', async () => {
    const body = {
      name: 'Meloxicam 1 mg',
      category: 'MEDICINE',
      baseUnit: 'TABLET',
      minStock: 20,
      requiresPrescription: true,
      presentations: [
        { name: 'Caja x 100', factor: 100, price: 150 },
        { name: 'Blíster x 10', factor: 10, price: 18 },
        { name: 'Tableta', factor: 1, price: 2 },
      ],
    };
    await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.reception)
      .send(body)
      .expect(403);
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send(body)
      .expect(201);
    productId = res.body.id;
    caja = res.body.presentations.find(
      (p: { factor: number }) => p.factor === 100,
    ).id;
    blister = res.body.presentations.find(
      (p: { factor: number }) => p.factor === 10,
    ).id;
    expect(res.body.presentations).toHaveLength(3);
  });

  it('la compra exige lote y vencimiento, y no acepta lotes vencidos', async () => {
    const url = `/api/inventory/products/${productId}/purchases`;
    await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({
        presentationId: caja,
        quantity: 1,
        expiresAt: addDays(today, 20),
      })
      .expect(400);
    const res = await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({
        presentationId: caja,
        quantity: 1,
        lotNumber: 'L-OLD',
        expiresAt: addDays(today, -1),
      })
      .expect(400);
    expect(res.body.message).toContain('vencido');
  });

  it('convierte la compra a unidades mínimas y guarda proveedor, comprobante y costo', async () => {
    const url = `/api/inventory/products/${productId}/purchases`;
    const a = await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({
        presentationId: caja,
        quantity: 1,
        lotNumber: 'L-A',
        expiresAt: addDays(today, 20),
        costPerPresentation: 90,
        supplier: 'Droguería Lima',
        documentNumber: 'F001-123',
      })
      .expect(201);
    await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({
        presentationId: blister,
        quantity: 2,
        lotNumber: 'L-B',
        expiresAt: addDays(today, 200),
      })
      .expect(201);
    const lotA = a.body.batches.find(
      (b: { lotNumber: string }) => b.lotNumber === 'L-A',
    );
    expect(lotA).toMatchObject({
      quantity: 100,
      unitCost: 0.9,
      supplier: 'Droguería Lima',
      documentNumber: 'F001-123',
    });
    expect(lotA.expiry).toEqual({ days: 20, level: 'RED' });
    batch.A = lotA.id;
    // Un lote vencido que quedó en la clínica (se crea directo: la API no deja ingresar vencidos)
    const vet = await prisma.user.findFirstOrThrow({
      where: { clinicId, role: 'VET' },
    });
    batch.C = (
      await prisma.productBatch.create({
        data: {
          clinicId,
          productId,
          lotNumber: 'L-C',
          expiresAt: new Date(`${addDays(today, -5)}T00:00:00Z`),
          quantity: 10,
          initialQuantity: 10,
          createdById: vet.id,
        },
      })
    ).id;
    await prisma.product.update({
      where: { id: productId },
      data: { totalStock: { increment: 10 } },
    });
    const detail = await http()
      .get(`/api/inventory/products/${productId}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    batch.B = detail.body.batches.find(
      (b: { lotNumber: string }) => b.lotNumber === 'L-B',
    ).id;
    expect(detail.body.totalStock).toBe(130);
    // El vencido aparece primero, en el semáforo
    expect(detail.body.batches[0]).toMatchObject({
      lotNumber: 'L-C',
      expiry: { level: 'EXPIRED' },
    });
  });

  it('FEFO: descuenta primero del lote que vence antes, cruza al siguiente y salta el vencido', async () => {
    await outflow(cookies.vet, {
      type: 'TREATMENT',
      quantity: 105,
      reason: 'Uso en consultorio',
    }).expect(201);
    expect(await batchQty(batch.A)).toBe(0);
    expect(await batchQty(batch.B)).toBe(15);
    expect(await batchQty(batch.C)).toBe(10);
    expect(await total()).toBe(25);
    const kardex = await http()
      .get(`/api/inventory/products/${productId}/movements`)
      .set('Cookie', cookies.reception)
      .expect(200);
    const [last, prev] = kardex.body.items;
    expect(prev).toMatchObject({
      type: 'TREATMENT',
      quantity: -100,
      balanceAfter: 30,
      batch: { lotNumber: 'L-A' },
    });
    expect(last).toMatchObject({
      type: 'TREATMENT',
      quantity: -5,
      balanceAfter: 25,
      batch: { lotNumber: 'L-B' },
    });
  });

  it('sin stock suficiente responde 409 y no descuenta nada; el lote vencido no se usa', async () => {
    const res = await outflow(cookies.vet, {
      type: 'TREATMENT',
      quantity: 2,
      presentationId: blister,
      reason: 'Uso',
    }).expect(409);
    expect(res.body.message).toContain('hay 15');
    await outflow(cookies.vet, {
      type: 'TREATMENT',
      quantity: 1,
      batchId: batch.C,
      reason: 'Uso',
    }).expect(409);
    expect(await batchQty(batch.B)).toBe(15);
    expect(await total()).toBe(25);
  });

  it('la merma sí puede sacar el lote vencido', async () => {
    await outflow(cookies.vet, {
      type: 'WASTE',
      quantity: 10,
      batchId: batch.C,
      reason: 'Vencido',
    }).expect(201);
    expect(await batchQty(batch.C)).toBe(0);
    expect(await total()).toBe(15);
  });

  it('dos descuentos simultáneos del último stock: solo uno pasa', async () => {
    const [a, b] = await Promise.all([
      outflow(cookies.vet, {
        type: 'TREATMENT',
        quantity: 15,
        reason: 'Caja 1',
      }),
      outflow(cookies.vet, {
        type: 'TREATMENT',
        quantity: 15,
        reason: 'Caja 2',
      }),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    expect(await batchQty(batch.B)).toBe(0);
    expect(await total()).toBe(0);
  });

  it('el ajuste por conteo físico es solo del administrador', async () => {
    const body = {
      reason: 'Conteo mensual',
      items: [{ batchId: batch.B, counted: 3 }],
    };
    const url = `/api/inventory/products/${productId}/counts`;
    await http().post(url).set('Cookie', cookies.vet).send(body).expect(403);
    const res = await http()
      .post(url)
      .set('Cookie', cookies.admin)
      .send(body)
      .expect(201);
    expect(res.body.totalStock).toBe(3);
    const audit = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'stock.count_adjust' },
    });
    expect(audit).not.toBeNull();
  });

  it('alertas: stock bajo y lotes por vencer', async () => {
    const res = await http()
      .get('/api/inventory/alerts')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(res.body.lowStock).toBe(1);
    expect(res.body.low[0]).toMatchObject({
      name: 'Meloxicam 1 mg',
      totalStock: 3,
      minStock: 20,
    });
    const list = await http()
      .get('/api/inventory/products?filter=low')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(list.body.items.map((p: { id: number }) => p.id)).toEqual([
      productId,
    ]);
  });

  it('controlados: exigen paciente, receta y un veterinario colegiado; quedan en el libro', async () => {
    const created = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send({
        name: 'Ketamina 50 mg/ml',
        category: 'MEDICINE',
        baseUnit: 'ML',
        controlled: true,
        presentations: [{ name: 'Frasco x 10 ml', factor: 10 }],
      })
      .expect(201);
    const id = created.body.id;
    await http()
      .post(`/api/inventory/products/${id}/purchases`)
      .set('Cookie', cookies.vet)
      .send({
        presentationId: created.body.presentations[0].id,
        quantity: 1,
        lotNumber: 'K-1',
        expiresAt: addDays(today, 300),
      })
      .expect(201);
    const url = `/api/inventory/products/${id}/outflows`;
    await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({ type: 'TREATMENT', quantity: 0.5, reason: 'Sedación' })
      .expect(400);
    // El administrador sin colegiatura no puede registrar la aplicación
    await http()
      .post(url)
      .set('Cookie', cookies.admin)
      .send({
        type: 'TREATMENT',
        quantity: 0.5,
        reason: 'Sedación',
        petId,
        prescriptionRef: 'R-001',
      })
      .expect(403);
    await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({
        type: 'TREATMENT',
        quantity: 0.5,
        reason: 'Sedación para curación',
        petId,
        prescriptionRef: 'R-001',
      })
      .expect(201);

    await http()
      .get('/api/inventory/controlled')
      .set('Cookie', cookies.reception)
      .expect(403);
    const book = await http()
      .get(`/api/inventory/controlled?from=${today}&to=${today}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    const use = book.body.find((m: { type: string }) => m.type === 'TREATMENT');
    expect(use).toMatchObject({
      quantity: -0.5,
      prescriptionRef: 'R-001',
      batch: { lotNumber: 'K-1' },
      pet: { name: 'Toby', client: { name: 'Rosa Quispe' } },
      vet: { licenseNumber: 'CMVP-1234' },
    });
  });

  it('catálogo de servicios con insumos: solo el administrador fija precios', async () => {
    const body = {
      name: 'Vacunación séxtuple',
      category: 'VACCINATION',
      price: 60,
      supplies: [{ productId, quantity: 1 }],
    };
    await http()
      .post('/api/care-services')
      .set('Cookie', cookies.vet)
      .send(body)
      .expect(403);
    const res = await http()
      .post('/api/care-services')
      .set('Cookie', cookies.admin)
      .send(body)
      .expect(201);
    expect(res.body.supplies[0]).toMatchObject({
      name: 'Meloxicam 1 mg',
      quantity: 1,
      baseUnit: 'TABLET',
    });
    await http()
      .post('/api/care-services')
      .set('Cookie', cookies.admin)
      .send(body)
      .expect(409);
    const price = await http()
      .patch(`/api/care-services/${res.body.id}`)
      .set('Cookie', cookies.admin)
      .send({ price: 65 })
      .expect(200);
    expect(price.body.price).toBe(65);
    const audit = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'service.price_change' },
    });
    expect(audit?.data).toMatchObject({ before: 60, after: 65 });
    const detail = await http()
      .get(`/api/inventory/products/${productId}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(detail.body.usedIn[0]).toMatchObject({
      name: 'Vacunación séxtuple',
      quantity: 1,
    });
  });

  it('el dashboard cuenta las alertas de inventario', async () => {
    const res = await http()
      .get('/api/dashboard')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(res.body.inventory).toEqual({ expiring: 0, lowStock: 1 });
  });
});
