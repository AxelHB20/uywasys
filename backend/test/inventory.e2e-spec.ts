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

  it('los errores de una presentación dicen cuál es; un controlado siempre pide receta', async () => {
    const bad = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send({
        name: 'Amoxicilina 250 mg',
        category: 'MEDICINE',
        baseUnit: 'TABLET',
        presentations: [{ name: 'Tableta', factor: 1, price: 0.833 }],
      })
      .expect(400);
    expect(bad.body.errors).toEqual([
      'Presentación 1: el precio debe tener hasta 2 decimales',
    ]);
    const controlled = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send({
        name: 'Tramadol 50 mg',
        category: 'MEDICINE',
        baseUnit: 'TABLET',
        controlled: true,
        requiresPrescription: false,
        presentations: [{ name: 'Tableta', factor: 1, price: 1.5 }],
      })
      .expect(201);
    expect(controlled.body.requiresPrescription).toBe(true);
  });

  it('alta con stock inicial en la misma operación; si el stock está mal no se crea nada', async () => {
    const created = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send({
        name: 'Amoxicilina susp. 60 ml',
        category: 'MEDICINE',
        baseUnit: 'BOTTLE',
        presentations: [{ name: 'Frasco 60 ml', factor: 1, price: 38 }],
        initialStock: {
          presentationIndex: 0,
          quantity: 5,
          expiresAt: addDays(today, 300),
          costPerPresentation: 22.5,
        },
      })
      .expect(201);
    expect(created.body.baseUnit).toBe('BOTTLE');
    expect(created.body.totalStock).toBe(5);
    expect(created.body.batches[0].lotNumber).toBeNull();

    const vaccine = {
      name: 'Vacuna sin lote',
      category: 'VACCINE',
      baseUnit: 'UNIT',
      presentations: [{ name: 'Dosis', factor: 1, price: 60 }],
      initialStock: {
        presentationIndex: 0,
        quantity: 10,
        expiresAt: addDays(today, 200),
      },
    };
    const noLot = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send(vaccine)
      .expect(400);
    expect(noLot.body.message).toContain('lote');
    const list = await http()
      .get('/api/inventory/products?q=Vacuna%20sin%20lote')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(list.body.total).toBe(0);
  });

  it('cargar stock: varios productos de una vez; si una fila está mal no entra nada', async () => {
    const make = async (name: string, category: string, controlled = false) =>
      (
        await http()
          .post('/api/inventory/products')
          .set('Cookie', cookies.vet)
          .send({
            name,
            category,
            baseUnit: 'BOX',
            controlled,
            presentations: [{ name: 'Caja', factor: 1, price: 20 }],
          })
          .expect(201)
      ).body as { id: number; presentations: { id: number }[] };
    const a = await make('Carga A', 'MEDICINE', true);
    const b = await make('Carga B', 'ACCESSORY');
    const pending = await http()
      .get('/api/inventory/stock-load')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(pending.body.items.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['Carga A', 'Carga B']),
    );
    // A es controlado sin lote: no se guarda nada (tampoco B)
    const rowA = {
      productId: a.id,
      presentationId: a.presentations[0].id,
      quantity: 3,
      expiresAt: addDays(today, 200),
    };
    const rowB = {
      productId: b.id,
      presentationId: b.presentations[0].id,
      quantity: 7,
    };
    const bad = await http()
      .post('/api/inventory/stock-load')
      .set('Cookie', cookies.vet)
      .send({ items: [rowA, rowB] })
      .expect(400);
    expect(bad.body.details.rows).toEqual([
      {
        productId: a.id,
        message: 'Ingresa el lote: DIGEMID lo pide en los psicotrópicos',
      },
    ]);
    const stockB = async () =>
      (
        await http()
          .get(`/api/inventory/products/${b.id}`)
          .set('Cookie', cookies.vet)
      ).body.totalStock;
    expect(await stockB()).toBe(0);
    // Se corrige "controlado" en la misma pasada: ya no pide lote y entra todo
    const ok = await http()
      .post('/api/inventory/stock-load')
      .set('Cookie', cookies.vet)
      .send({ items: [{ ...rowA, controlled: false }, rowB] })
      .expect(201);
    expect(ok.body.loaded).toBe(2);
    const detailA = (
      await http()
        .get(`/api/inventory/products/${a.id}`)
        .set('Cookie', cookies.vet)
    ).body;
    expect(detailA.totalStock).toBe(3);
    expect(detailA.controlled).toBe(false);
    // Quitar "psicotrópico" también deja de pedir receta (se había marcado por error)
    expect(detailA.requiresPrescription).toBe(false);
    const listed = await http()
      .get('/api/inventory/products?controlled=true&status=all')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(listed.body.items.map((p: { id: number }) => p.id)).not.toContain(
      a.id,
    );
    expect(await stockB()).toBe(7);
    await http()
      .get('/api/inventory/stock-load')
      .set('Cookie', cookies.reception)
      .expect(403);
  });

  it('corregir productos: «Trae» con el stock puesto, Unidad → Frasco e insumo con precio, todo junto', async () => {
    const make = async (name: string, chargeable = true) =>
      (
        await http()
          .post('/api/inventory/products')
          .set('Cookie', cookies.vet)
          .send({
            name,
            category: 'HYGIENE',
            baseUnit: 'UNIT',
            chargeable,
            presentations: [{ name: 'Unidad', factor: 1, price: 35 }],
          })
          .expect(201)
      ).body as { id: number; presentations: { id: number }[] };
    // Como lo dejaron en la clínica: «Trae» = 3 (era el stock)
    const shampoo = await make('Shampoo Fix', false);
    const locion = await make('Locion Fix');
    for (const p of [shampoo, locion])
      await http()
        .patch(`/api/inventory/presentations/${p.presentations[0].id}`)
        .set('Cookie', cookies.vet)
        .send({ factor: 3 })
        .expect(200);
    const pending = (
      await http()
        .get('/api/inventory/product-fixes')
        .set('Cookie', cookies.vet)
        .expect(200)
    ).body.items as {
      id: number;
      canChangeUnit: boolean;
      presentation: { id: number; factor: number } | null;
      supplyWithPrice: boolean;
    }[];
    const row = pending.find((p) => p.id === shampoo.id)!;
    expect(row).toMatchObject({
      canChangeUnit: true,
      presentation: { id: shampoo.presentations[0].id, factor: 3 },
      supplyWithPrice: true,
    });
    // Una fila mala: no se guarda nada
    await http()
      .post('/api/inventory/product-fixes')
      .set('Cookie', cookies.vet)
      .send({
        items: [
          {
            productId: shampoo.id,
            presentationId: shampoo.presentations[0].id,
            baseUnit: 'BOTTLE',
            sellable: true,
          },
          { productId: locion.id, presentationId: 999999 },
        ],
      })
      .expect(400);
    const res = await http()
      .post('/api/inventory/product-fixes')
      .set('Cookie', cookies.vet)
      .send({
        items: [
          {
            productId: shampoo.id,
            presentationId: shampoo.presentations[0].id,
            baseUnit: 'BOTTLE',
            sellable: true,
          },
          { productId: locion.id, presentationId: locion.presentations[0].id },
        ],
      })
      .expect(201);
    expect(res.body.fixed).toBe(2);
    // Lo que habían puesto en «Trae» pasa a "Cargar stock" como sugerencia
    expect(res.body.suggestions).toEqual(
      expect.arrayContaining([
        {
          productId: shampoo.id,
          presentationId: shampoo.presentations[0].id,
          quantity: 3,
        },
      ]),
    );
    const detail = (
      await http()
        .get(`/api/inventory/products/${shampoo.id}`)
        .set('Cookie', cookies.vet)
    ).body;
    expect(detail).toMatchObject({ baseUnit: 'BOTTLE', chargeable: true });
    expect(detail.presentations[0]).toMatchObject({
      name: 'Frasco',
      factor: 1,
    });
    const after = (
      await http()
        .get('/api/inventory/product-fixes')
        .set('Cookie', cookies.vet)
    ).body.items.map((p: { id: number }) => p.id);
    expect(after).not.toContain(shampoo.id);
    expect(after).not.toContain(locion.id);
    // Con movimientos ya no se cambia cómo se cuenta
    await http()
      .post(`/api/inventory/products/${locion.id}/purchases`)
      .set('Cookie', cookies.vet)
      .send({
        presentationId: locion.presentations[0].id,
        quantity: 2,
        expiresAt: addDays(today, 300),
      })
      .expect(201);
    const blocked = await http()
      .patch(`/api/inventory/products/${locion.id}`)
      .set('Cookie', cookies.vet)
      .send({ baseUnit: 'BOTTLE' })
      .expect(400);
    expect(blocked.body.message).toContain('Ya tiene movimientos');
    await http()
      .get('/api/inventory/product-fixes')
      .set('Cookie', cookies.reception)
      .expect(403);
  });

  it('la compra exige vencimiento (el lote solo en vacunas y controlados) y no acepta lotes vencidos', async () => {
    const url = `/api/inventory/products/${productId}/purchases`;
    const noExpiry = await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({ presentationId: caja, quantity: 1, lotNumber: 'L-1' })
      .expect(400);
    expect(noExpiry.body.message).toBe('Ingresa la fecha de vencimiento');
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

  it('los accesorios no vencen: la compra no pide lote ni guarda fecha, y no salen en alertas', async () => {
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send({
        name: `Cama ortopédica M ${stamp}`,
        category: 'ACCESSORY',
        baseUnit: 'UNIT',
        presentations: [{ name: 'Unidad', factor: 1, price: 120 }],
      })
      .expect(201);
    expect(res.body.tracksExpiry).toBe(false);
    const id = res.body.id;
    const url = `/api/inventory/products/${id}/purchases`;
    // Aunque llegue una fecha (vieja pantalla, import), no se guarda: la cama no caduca
    await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({
        presentationId: res.body.presentations[0].id,
        quantity: 2,
        expiresAt: addDays(today, 5),
      })
      .expect(201);
    const detail = await http()
      .get(`/api/inventory/products/${id}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(detail.body.tracksExpiry).toBe(false);
    expect(detail.body.batches[0].expiresAt).toBeNull();
    expect(detail.body.batches[0].expiry).toBeNull();
    const list = await http()
      .get('/api/inventory/products')
      .query({ q: `Cama ortopédica M ${stamp}` })
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(list.body.items[0].tracksExpiry).toBe(false);
    expect(list.body.items[0].nextExpiry).toBeNull();
  });

  it('un producto marcado como "no vence" deja de tener fecha en sus lotes; uno que sí vence la pide', async () => {
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.vet)
      .send({
        name: `Shampoo avena ${stamp}`,
        category: 'ACCESSORY',
        baseUnit: 'UNIT',
        tracksExpiry: true,
        presentations: [{ name: 'Frasco', factor: 1, price: 35 }],
      })
      .expect(201);
    expect(res.body.tracksExpiry).toBe(true);
    const id = res.body.id;
    const presentationId = res.body.presentations[0].id;
    const url = `/api/inventory/products/${id}/purchases`;
    await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({ presentationId, quantity: 1 })
      .expect(400);
    await http()
      .post(url)
      .set('Cookie', cookies.vet)
      .send({
        presentationId,
        quantity: 1,
        lotNumber: 'SH-1',
        expiresAt: addDays(today, 10),
      })
      .expect(201);
    await http()
      .patch(`/api/inventory/products/${id}`)
      .set('Cookie', cookies.vet)
      .send({ tracksExpiry: false })
      .expect(200);
    const batches = await prisma.productBatch.findMany({
      where: { productId: id },
    });
    expect(batches.every((b) => b.expiresAt === null)).toBe(true);
  });

  it('el IGV del producto solo lo cambia el administrador', async () => {
    const url = `/api/inventory/products/${productId}`;
    const denied = await http()
      .patch(url)
      .set('Cookie', cookies.vet)
      .send({ igv: 'EXEMPT' })
      .expect(403);
    expect(denied.body.message).toContain('administrador');
    // Mandar el mismo valor no es un cambio
    await http()
      .patch(url)
      .set('Cookie', cookies.vet)
      .send({ igv: 'TAXED' })
      .expect(200);
    await http()
      .patch(url)
      .set('Cookie', cookies.admin)
      .send({ igv: 'EXEMPT' })
      .expect(200);
    await http()
      .patch(url)
      .set('Cookie', cookies.admin)
      .send({ igv: 'TAXED' })
      .expect(200);
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

  it('cada tarjeta de vencimiento filtra su rango y ordena por el que vence antes', async () => {
    const make = async (name: string, days: number) => {
      const p = await http()
        .post('/api/inventory/products')
        .set('Cookie', cookies.vet)
        .send({
          name,
          category: 'MEDICINE',
          baseUnit: 'UNIT',
          presentations: [{ name: 'Unidad', factor: 1, price: 5 }],
        })
        .expect(201);
      await http()
        .post(`/api/inventory/products/${p.body.id}/purchases`)
        .set('Cookie', cookies.vet)
        .send({
          presentationId: p.body.presentations[0].id,
          quantity: 2,
          lotNumber: `V-${days}`,
          expiresAt: addDays(today, Math.max(days, 0)),
        })
        .expect(201);
      // Uno "ya vencido": la compra no acepta fechas pasadas, se ajusta el lote
      if (days < 0)
        await prisma.productBatch.updateMany({
          where: { productId: p.body.id },
          data: { expiresAt: new Date(`${addDays(today, days)}T00:00:00Z`) },
        });
      return p.body.id as number;
    };
    const in20 = await make('Filtro 20 días', 20);
    const in8 = await make('Filtro 8 días', 8);
    const in45 = await make('Filtro 45 días', 45);
    const late = await make('Filtro vencido', -3);
    const ids = async (filter: string) =>
      (
        await http()
          .get(`/api/inventory/products?filter=${filter}&q=filtro`)
          .set('Cookie', cookies.reception)
          .expect(200)
      ).body.items.map((p: { id: number }) => p.id);
    expect(await ids('exp30')).toEqual([in8, in20]);
    expect(await ids('exp60')).toEqual([in45]);
    expect(await ids('expired')).toEqual([late]);
    expect(await ids('expiring')).toEqual([late, in8, in20, in45]);
    await http()
      .get('/api/inventory/products?filter=pronto')
      .set('Cookie', cookies.reception)
      .expect(400);
    // Inactivos: solo con status=inactive
    await prisma.product.update({
      where: { id: in45 },
      data: { active: false },
    });
    expect(await ids('exp60')).toEqual([]);
    const inactive = await http()
      .get('/api/inventory/products?status=inactive&q=filtro')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(inactive.body.items.map((p: { id: number }) => p.id)).toEqual([
      in45,
    ]); // Que no cuenten en las alertas de las pruebas siguientes
    await prisma.product.updateMany({
      where: { id: { in: [in20, in8, late] } },
      data: { active: false },
    });
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
      // Último costo con valor (el lote L-B entró sin costo y no cuenta)
      unitCost: 0.9,
    });
    // Un insumo en uso no se desactiva: el servicio seguiría descontando de un producto oculto
    const blocked = await http()
      .patch(`/api/inventory/products/${productId}`)
      .set('Cookie', cookies.admin)
      .send({ active: false })
      .expect(400);
    expect(blocked.body.message).toContain('Vacunación séxtuple');
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
