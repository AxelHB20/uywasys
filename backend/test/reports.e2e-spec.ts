import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { clinicDay } from '../src/common/time/clinic-day.js';
import { addDays } from '../src/inventory/expiry.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER';

/**
 * Reportes: cada número tiene que coincidir con su módulo de origen. Lo cobrado es lo que
 * suma la caja; lo vendido, los cargos no anulados; un cobro anulado o un cargo quitado
 * salen de todos los lados a la vez.
 */
describe('Reportes de ventas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());
  const ids = {
    client: 0,
    pet: 0,
    visit: 0,
    pipette: 0,
    pipettePres: 0,
    consult: 0,
    receipt: 0,
  };

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-reports-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    userIds[key] = user.id;
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  const report = async (from = today, to = today, who = 'admin') =>
    (
      await http()
        .get(`/api/reports/sales?from=${from}&to=${to}`)
        .set('Cookie', cookies[who])
        .expect(200)
    ).body;
  /** Producto con una compra; costPerPresentation null = sin costo registrado */
  async function product(
    data: {
      name: string;
      category: string;
      baseUnit?: string;
      factor?: number;
    },
    purchase: {
      quantity: number;
      cost: number | null;
      expiresIn?: number | null;
    },
  ): Promise<number> {
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.admin)
      .send({
        name: data.name,
        category: data.category,
        baseUnit: data.baseUnit ?? 'UNIT',
        presentations: [
          { name: 'Presentación', factor: data.factor ?? 1, price: 30 },
        ],
      })
      .expect(201);
    const accessory = data.category === 'ACCESSORY';
    await http()
      .post(`/api/inventory/products/${res.body.id}/purchases`)
      .set('Cookie', cookies.admin)
      .send({
        presentationId: res.body.presentations[0].id,
        quantity: purchase.quantity,
        lotNumber: accessory ? null : `L-${data.name.slice(0, 4)}`,
        expiresAt: accessory ? null : addDays(today, purchase.expiresIn ?? 300),
        costPerPresentation: purchase.cost,
      })
      .expect(201);
    return res.body.id as number;
  }

  const sum = (rows: Record<string, number>[], k: string) =>
    Math.round(rows.reduce((t, r) => t + r[k], 0) * 100) / 100;

  const collectedToday = async () =>
    (
      await http()
        .get('/api/dashboard')
        .set('Cookie', cookies.admin)
        .expect(200)
    ).body.sales;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e reportes', 'Otra clínica reportes'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'CASHIER', 'cashier');
    await login(other, 'ADMIN', 'other');

    const client = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        name: 'Rosa Quispe',
        phone: '987654321',
        consent: true,
        pet: { name: 'Toby', species: 'DOG' },
      })
      .expect(201);
    ids.client = client.body.id;
    ids.pet = client.body.pets[0].id;

    const product = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.admin)
      .send({
        name: 'Pipeta antipulgas',
        category: 'ANTIPARASITIC',
        baseUnit: 'UNIT',
        presentations: [{ name: 'Unidad', factor: 1, price: 45 }],
      })
      .expect(201);
    ids.pipette = product.body.id;
    ids.pipettePres = product.body.presentations[0].id;
    await http()
      .post(`/api/inventory/products/${ids.pipette}/purchases`)
      .set('Cookie', cookies.admin)
      .send({
        presentationId: ids.pipettePres,
        quantity: 10,
        expiresAt: addDays(today, 300),
        lotNumber: 'L-001',
        costPerPresentation: 20,
      })
      .expect(201);
    ids.consult = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({ name: 'Consulta general', category: 'CONSULTATION', price: 50 })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.cashMovement.deleteMany({ where });
      await prisma.paymentAllocation.deleteMany({
        where: { receipt: { clinicId: { in: clinicIds } } },
      });
      await prisma.payment.deleteMany({ where });
      await prisma.electronicDocument.deleteMany({ where });
      await prisma.receipt.deleteMany({ where });
      await prisma.cashSession.deleteMany({ where });
      await prisma.cashRegister.deleteMany({ where });
      await prisma.stockShortage.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.appointment.deleteMany({ where });
      await prisma.immunization.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
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
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('solo el administrador ve los reportes, y el período se valida', async () => {
    for (const who of ['vet', 'reception', 'cashier'])
      await http()
        .get(`/api/reports/sales?from=${today}&to=${today}`)
        .set('Cookie', cookies[who])
        .expect(403);
    const reversed = await http()
      .get(`/api/reports/sales?from=${today}&to=${addDays(today, -1)}`)
      .set('Cookie', cookies.admin)
      .expect(400);
    expect(reversed.body.message).toContain('posterior');
    const tooLong = await http()
      .get(`/api/reports/sales?from=${addDays(today, -731)}&to=${today}`)
      .set('Cookie', cookies.admin)
      .expect(400);
    expect(tooLong.body.message).toContain('2 años');
    // 2 años sí: el gráfico va por mes
    const twoYears = await report(addDays(today, -730), today);
    expect(twoYears.grain).toBe('month');
    expect(twoYears.series.length).toBeLessThanOrEqual(25);
    // El Excel de reportes ya no existe (todo se ve en pantalla)
    for (const url of ['sales/excel', 'margin/excel', 'inventory/excel'])
      await http()
        .get(`/api/reports/${url}?from=${today}&to=${today}`)
        .set('Cookie', cookies.admin)
        .expect(404);
    await http()
      .get('/api/reports/sales?from=hoy&to=mañana')
      .set('Cookie', cookies.admin)
      .expect(400);
  });

  it('sin ventas: todos los días del período en cero y la comparación con el anterior', async () => {
    const r = await report(addDays(today, -6), today);
    expect(r.grain).toBe('day');
    expect(r.series).toHaveLength(7);
    expect(r.series[6]).toMatchObject({ key: today, from: today, to: today });
    expect(r.series.every((d: { services: number }) => d.services === 0)).toBe(
      true,
    );
    expect(r.previousSeries).toHaveLength(7);
    expect(r.previous).toEqual({
      from: addDays(today, -13),
      to: addDays(today, -7),
    });
    expect(r.kpis).toMatchObject({
      sold: 0,
      collected: 0,
      newClients: 1,
      firstTime: 0,
    });
  });

  it('una consulta con producto, una venta de mostrador y un cargo quitado', async () => {
    // Atención de la veterinaria: consulta 50 + pipeta 45
    ids.visit = (
      await http()
        .post('/api/visits')
        .set('Cookie', cookies.vet)
        .send({ petId: ids.pet })
        .expect(201)
    ).body.id;
    await http()
      .post('/api/charges')
      .set('Cookie', cookies.vet)
      .send({
        visitId: ids.visit,
        items: [
          { careServiceId: ids.consult, quantity: 1 },
          {
            productId: ids.pipette,
            presentationId: ids.pipettePres,
            quantity: 1,
          },
        ],
      })
      .expect(201);
    // Un cargo registrado por error y quitado: no cuenta en ningún lado
    const wrong = await http()
      .post('/api/charges')
      .set('Cookie', cookies.reception)
      .send({
        clientId: ids.client,
        items: [{ careServiceId: ids.consult, quantity: 2 }],
      })
      .expect(201);
    await http()
      .post(`/api/charges/${wrong.body.charges[0].id}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Registrado por error' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    // Caja: cobra la cuenta (efectivo + tarjeta) y una pipeta en mostrador con Yape
    await http()
      .post('/api/cash/sessions')
      .set('Cookie', cookies.cashier)
      .send({ openingAmount: 100 })
      .expect(201);
    const receipt = await http()
      .post('/api/cash/receipts')
      .set('Cookie', cookies.cashier)
      .send({
        requestKey: randomUUID(),
        clientId: ids.client,
        payments: [
          { method: 'CASH', amount: 60 },
          { method: 'CARD', amount: 35, operationCode: 'V-1' },
        ],
      })
      .expect(201);
    ids.receipt = receipt.body.id;
    await http()
      .post('/api/cash/counter-sales')
      .set('Cookie', cookies.cashier)
      .send({
        requestKey: randomUUID(),
        items: [
          {
            productId: ids.pipette,
            presentationId: ids.pipettePres,
            quantity: 1,
          },
        ],
        payments: [{ method: 'YAPE', amount: 45, operationCode: '123456' }],
      })
      .expect(201);
    // Un egreso de caja chica no es una venta
    await http()
      .post('/api/cash/expenses')
      .set('Cookie', cookies.cashier)
      .send({ amount: 10, reason: 'Movilidad' })
      .expect(201);

    const r = await report();
    expect(r.kpis).toEqual({
      sold: 140,
      pending: 0,
      collected: 140,
      receipts: 2,
      averageTicket: 70,
      visits: 1,
      newClients: 1,
      firstTime: 1,
    });
    // Para las líneas chicas de cada indicador: atenciones y cobros por grupo
    expect(sum(r.series, 'visits')).toBe(1);
    expect(sum(r.series, 'receipts')).toBe(2);
    // Lo cobrado es exactamente lo que suma la caja del día
    expect((await collectedToday()).total).toBe(r.kpis.collected);
    // Un día: por hora (24 grupos) y los totales cuadran
    expect(r.grain).toBe('hour');
    expect(r.series).toHaveLength(24);
    expect(sum(r.series, 'services')).toBe(50);
    expect(sum(r.series, 'products')).toBe(90);
    expect(sum(r.series, 'collected')).toBe(140);
    expect(r.methods).toEqual([
      { method: 'CASH', amount: 60, payments: 1 },
      { method: 'YAPE', amount: 45, payments: 1 },
      { method: 'CARD', amount: 35, payments: 1 },
    ]);
    expect(r.items).toEqual([
      {
        kind: 'PRODUCT',
        id: ids.pipette,
        name: 'Pipeta antipulgas',
        category: 'ANTIPARASITIC',
        quantity: 2,
        unit: 'UNIT',
        amount: 90,
      },
      {
        kind: 'SERVICE',
        id: ids.consult,
        name: 'Consulta general',
        category: 'CONSULTATION',
        quantity: 1,
        unit: null,
        amount: 50,
      },
    ]);
    expect(r.categories).toEqual([
      { kind: 'PRODUCT', category: 'ANTIPARASITIC', amount: 90, lines: 2 },
      { kind: 'SERVICE', category: 'CONSULTATION', amount: 50, lines: 1 },
    ]);
    // La veterinaria vendió lo de su atención; la pipeta del mostrador va aparte
    expect(r.professionals).toEqual([
      {
        user: { id: userIds.vet, fullName: 'VET vet', role: 'VET' },
        visits: 1,
        services: 50,
        products: 45,
        amount: 95,
      },
      { user: null, visits: 0, services: 0, products: 45, amount: 45 },
    ]);
  });

  it('anular un cobro: sale de lo cobrado (caja y reporte igual) y lo vendido queda por cobrar', async () => {
    await http()
      .post(`/api/cash/receipts/${ids.receipt}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Cobro duplicado' })
      .expect((res) => expect([200, 201]).toContain(res.status));
    const r = await report();
    expect(r.kpis).toMatchObject({
      sold: 140,
      pending: 95,
      collected: 45,
      receipts: 1,
      averageTicket: 45,
    });
    expect((await collectedToday()).total).toBe(45);
    expect(sum(r.series, 'collected')).toBe(45);
    const byMethod = Object.fromEntries(
      r.methods.map((m: { method: string; amount: number }) => [
        m.method,
        m.amount,
      ]),
    );
    expect(byMethod).toEqual({ YAPE: 45, CASH: 0, CARD: 0 });
  });

  it('el período anterior compara contra lo de antes; otra clínica no ve nada', async () => {
    const r = await report(addDays(today, 1), addDays(today, 1));
    expect(r.previous).toEqual({ from: today, to: today });
    expect(r.previousKpis).toMatchObject({ sold: 140, collected: 45 });
    expect(r.kpis.sold).toBe(0);

    const other = await report(today, today, 'other');
    expect(other.kpis).toMatchObject({ sold: 0, collected: 0, visits: 0 });
    expect(other.items).toEqual([]);
    expect(other.professionals).toEqual([]);
  });

  it('ventas: mapa de calor, especie, clientes, por cobrar, movilidad y 12 meses', async () => {
    const r = await report();
    // Mapa de calor: suma lo vendido del día
    expect(sum(r.heatmap, 'amount')).toBe(140);
    expect(r.heatmap[0].dow).toBeGreaterThanOrEqual(1);
    // Por especie: la consulta y su pipeta son de Toby (perro); la pipeta de mostrador no tiene mascota
    expect(r.species).toEqual(
      expect.arrayContaining([
        { species: 'DOG', amount: 95, pets: 1 },
        { species: null, amount: 45, pets: 0 },
      ]),
    );
    expect(r.documents.map((d: { type: string }) => d.type)).toEqual([
      'BOLETA',
      'FACTURA',
      'CREDIT_NOTE',
    ]);
    expect(r.topClients[0]).toMatchObject({
      client: { id: ids.client, name: 'Rosa Quispe' },
      amount: 95,
      visits: 1,
      pets: 1,
    });
    expect(r.clients).toMatchObject({ total: 1, newOnes: 1, repeat: 0 });
    // El cobro anulado dejó 95 por cobrar de hoy
    expect(r.receivables).toMatchObject({
      total: 95,
      clients: 1,
      aging: { upTo7: 95, upTo30: 0, older: 0 },
    });
    expect(r.receivables.top[0]).toMatchObject({ amount: 95, charges: 2 });
    expect(r.transport).toEqual({
      amount: 0,
      count: 0,
      byType: [],
      pendingHome: 0,
    });
    expect(r.months).toHaveLength(12);
    expect(r.months[11]).toMatchObject({ month: today.slice(0, 7), sold: 140 });
    expect(r.overdueBoosters).toBe(0);
    // Hoy se compara con ayer hasta la misma hora
    expect(r.previous).toEqual({
      from: addDays(today, -1),
      to: addDays(today, -1),
    });
  });

  it('un insumo no se cobra aparte: no sale al buscar para cobrar y el servidor lo rechaza', async () => {
    const gloves = await product(
      { name: 'Guantes de examen', category: 'SUPPLY', factor: 100 },
      { quantity: 2, cost: 30 },
    );
    const detail = (
      await http()
        .get(`/api/inventory/products/${gloves}`)
        .set('Cookie', cookies.admin)
        .expect(200)
    ).body;
    expect(detail.chargeable).toBe(false);
    const pres = detail.presentations[0].id;
    const res = await http()
      .post('/api/charges')
      .set('Cookie', cookies.reception)
      .send({
        clientId: ids.client,
        items: [{ productId: gloves, presentationId: pres, quantity: 1 }],
      })
      .expect(400);
    expect(res.body.message).toContain('insumo de uso interno');
    const search = (q: string) =>
      http()
        .get(`/api/inventory/products?q=${q}&chargeable=true`)
        .set('Cookie', cookies.admin)
        .expect(200);
    expect((await search('guantes')).body.items).toEqual([]);

    // Si la clínica sí lo vende, lo enciende y ya sale al cobrar
    await http()
      .patch(`/api/inventory/products/${gloves}`)
      .set('Cookie', cookies.admin)
      .send({ chargeable: true })
      .expect(200);
    expect(
      (await search('guantes')).body.items.map((p: { id: number }) => p.id),
    ).toEqual([gloves]);
    await http()
      .patch(`/api/inventory/products/${gloves}`)
      .set('Cookie', cookies.admin)
      .send({ chargeable: false, active: false })
      .expect(200);
  });

  it('margen: venta sin IGV menos el costo del lote; lo que no tiene costo va aparte', async () => {
    // Un baño que gasta 100 ml de champú (frasco de 500 ml a S/ 25 = S/ 0.05 el ml)
    const shampoo = await product(
      {
        name: 'Champú medicado',
        category: 'SUPPLY',
        baseUnit: 'ML',
        factor: 500,
      },
      { quantity: 1, cost: 25 },
    );
    const bath = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({
          name: 'Baño medicado',
          category: 'OTHER',
          price: 59,
          supplies: [{ productId: shampoo, quantity: 100 }],
        })
        .expect(201)
    ).body.id;
    // Un collar comprado sin registrar el costo
    const collar = await product(
      { name: 'Collar de cuero', category: 'ACCESSORY' },
      { quantity: 5, cost: null },
    );
    const collarPres = (
      await prisma.productPresentation.findFirstOrThrow({
        where: { productId: collar },
      })
    ).id;
    await http()
      .post('/api/charges')
      .set('Cookie', cookies.reception)
      .send({
        clientId: ids.client,
        items: [
          { careServiceId: bath, quantity: 1 },
          { productId: collar, presentationId: collarPres, quantity: 1 },
        ],
      })
      .expect(201);

    for (const who of ['vet', 'cashier'])
      await http()
        .get(`/api/reports/margin?from=${today}&to=${today}`)
        .set('Cookie', cookies[who])
        .expect(403);
    const r = (
      await http()
        .get(`/api/reports/margin?from=${today}&to=${today}`)
        .set('Cookie', cookies.admin)
        .expect(200)
    ).body;
    // Pipeta: 2 × S/ 45 con IGV = 2 × 38.14 sin IGV; costo 2 × S/ 20
    expect(r.products).toEqual([
      {
        kind: 'PRODUCT',
        id: ids.pipette,
        name: 'Pipeta antipulgas',
        category: 'ANTIPARASITIC',
        quantity: 2,
        unit: 'UNIT',
        revenue: 76.28,
        cost: 40,
        margin: 36.28,
        marginPercent: 47.6,
      },
      {
        kind: 'PRODUCT',
        id: collar,
        name: 'Collar de cuero',
        category: 'ACCESSORY',
        quantity: 1,
        unit: 'UNIT',
        revenue: 25.42,
        cost: null,
        margin: null,
        marginPercent: null,
      },
    ]);
    // Servicios: el costo son sus insumos (la consulta no tiene)
    expect(r.services).toEqual([
      expect.objectContaining({
        name: 'Baño medicado',
        revenue: 50,
        cost: 5,
        margin: 45,
        marginPercent: 90,
      }),
      expect.objectContaining({
        name: 'Consulta general',
        quantity: 1,
        revenue: 42.37,
        cost: 0,
        marginPercent: 100,
      }),
    ]);
    expect(r.totals.products).toEqual({
      revenue: 101.7,
      revenueWithCost: 76.28,
      cost: 40,
      margin: 36.28,
      marginPercent: 47.6,
      revenueWithoutCost: 25.42,
      rowsWithoutCost: 1,
    });
    expect(r.totals.all).toMatchObject({
      revenue: 194.07,
      cost: 45,
      margin: 123.65,
    });

    // Margen en el tiempo y contra el período anterior
    expect(r.grain).toBe('hour');
    expect(sum(r.series, 'revenue')).toBe(r.totals.all.revenue);
    expect(r.previous).toEqual({
      from: addDays(today, -1),
      to: addDays(today, -1),
    });
    expect(r.previousTotals).toEqual({
      revenue: 0,
      margin: 0,
      marginPercent: null,
    });
  });

  it('inventario valorizado: a costo, en riesgo de vencer y sin movimiento', async () => {
    // Vacuna: un lote vence en 10 días y otro ya venció
    const vaccine = await product(
      { name: 'Vacuna antirrábica', category: 'VACCINE' },
      { quantity: 3, cost: 15, expiresIn: 10 },
    );
    const vaccinePres = (
      await prisma.productPresentation.findFirstOrThrow({
        where: { productId: vaccine },
      })
    ).id;
    await http()
      .post(`/api/inventory/products/${vaccine}/purchases`)
      .set('Cookie', cookies.admin)
      .send({
        presentationId: vaccinePres,
        quantity: 1,
        lotNumber: 'L-VIEJO',
        expiresAt: addDays(today, 40),
        costPerPresentation: 15,
      })
      .expect(201);
    await prisma.productBatch.updateMany({
      where: { productId: vaccine, lotNumber: 'L-VIEJO' },
      data: { expiresAt: new Date(`${addDays(today, -3)}T00:00:00Z`) },
    });
    // Un juguete comprado hace 3 meses que nunca se vendió
    const toy = await product(
      { name: 'Juguete mordedor', category: 'ACCESSORY' },
      { quantity: 2, cost: 10 },
    );
    await prisma.productBatch.updateMany({
      where: { productId: toy },
      data: { receivedAt: new Date(Date.now() - 90 * 86_400_000) },
    });

    await http()
      .get('/api/reports/inventory')
      .set('Cookie', cookies.vet)
      .expect(403);
    const r = (
      await http()
        .get('/api/reports/inventory')
        .set('Cookie', cookies.admin)
        .expect(200)
    ).body;
    // Pipeta 8 × 20 + champú 400 ml × 0.05 + vacuna 4 × 15 + juguete 2 × 10 + guantes 60 (desactivados
    // pero con stock: la plata sigue en el almacén); el collar no tiene costo
    expect(r.totals).toEqual({
      value: 320,
      products: 6,
      batchesWithoutCost: 1,
      lowStock: 0,
      expired: 15,
      expiring30: 45,
      expiring60: 0,
      idle: 20,
    });
    expect(r.products[0]).toMatchObject({
      name: 'Pipeta antipulgas',
      stock: 8,
      value: 160,
    });
    expect(
      r.products.find((p: { name: string }) => p.name === 'Collar de cuero'),
    ).toMatchObject({
      stock: 4,
      value: 0,
      stockWithoutCost: 4,
    });
    expect(r.categories[0]).toEqual({
      category: 'ANTIPARASITIC',
      value: 160,
      products: 1,
    });
    expect(r.categories).toContainEqual({
      category: 'ACCESSORY',
      value: 20,
      products: 2,
    });
    expect(
      r.risk.map(
        (b: {
          lotNumber: string;
          level: string;
          days: number;
          value: number;
        }) => [b.lotNumber, b.level, b.days, b.value],
      ),
    ).toEqual([
      ['L-VIEJO', 'EXPIRED', -3, 15],
      ['L-Vacu', 'RED', 10, 45],
    ]);
    expect(r.idle).toEqual([
      expect.objectContaining({
        id: toy,
        stock: 2,
        value: 20,
        lastOutAt: null,
      }),
    ]);

    const other = (
      await http()
        .get('/api/reports/inventory')
        .set('Cookie', cookies.other)
        .expect(200)
    ).body;
    expect(other.totals.value).toBe(0);
    expect(other.risk).toEqual([]);

    // Entradas y salidas de 6 meses; el último mes cierra con el valor de hoy
    expect(r.flows).toHaveLength(6);
    expect(r.flows[5].value).toBe(r.totals.value);
    expect(r.coverage.length).toBeGreaterThan(0);
    expect(r.inactiveWithStock).toBe(1);
    expect(
      r.products.find((x: { name: string }) => x.name === 'Guantes de examen'),
    ).toMatchObject({ active: false, value: 60 });
  });

  it('inicio del administrador: el mes en curso cuadra con el reporte y se compara con el mes anterior', async () => {
    await http()
      .get('/api/reports/month')
      .set('Cookie', cookies.vet)
      .expect(403);
    const month = (
      await http()
        .get('/api/reports/month')
        .set('Cookie', cookies.admin)
        .expect(200)
    ).body;
    const from = `${today.slice(0, 7)}-01`;
    expect(month).toMatchObject({ from, to: today });
    expect(month.previous.from < from).toBe(true);
    const sales = await report(from, today);
    expect(month.kpis).toEqual(sales.kpis);
    // Las últimas 3 semanas por día, terminando hoy (barras del inicio)
    expect(month.recent).toHaveLength(21);
    expect(month.recent.at(-1).day).toBe(today);
    expect(month.recent.at(-1).collected).toBe(month.days.at(-1).collected);
    expect(month.days.at(-1)).toEqual({ day: today, collected: 45 });
    expect(
      month.days.reduce(
        (s: number, d: { collected: number }) => s + d.collected,
        0,
      ),
    ).toBe(month.kpis.collected);
    expect(month.previousDays[0].day).toBe(month.previous.from);
  });

  it('inicio: citas de hoy y refuerzos que tocan, iguales a la agenda y a Vacunas', async () => {
    const pet = await prisma.pet.findUniqueOrThrow({ where: { id: ids.pet } });
    const base = {
      clinicId: clinicIds[0],
      petId: ids.pet,
      clientId: pet.clientId,
    };
    await prisma.appointment.createMany({
      data: [
        { ...base, startsAt: new Date(), createdById: userIds.reception },
        {
          ...base,
          startsAt: new Date(),
          status: 'CANCELLED',
          cancelReason: 'Reprogramó',
          createdById: userIds.reception,
        },
      ],
    });
    const day = (n: number) => new Date(`${addDays(today, n)}T00:00:00Z`);
    await prisma.immunization.createMany({
      data: [
        {
          clinicId: clinicIds[0],
          petId: ids.pet,
          kind: 'VACCINE',
          name: 'Séxtuple',
          appliedAt: day(-362),
          nextDueAt: day(3),
          appliedById: userIds.vet,
        },
        {
          clinicId: clinicIds[0],
          petId: ids.pet,
          kind: 'VACCINE',
          name: 'Antirrábica',
          appliedAt: day(-375),
          nextDueAt: day(-10),
          appliedById: userIds.vet,
        },
      ],
    });

    const dash = (
      await http()
        .get('/api/dashboard')
        .set('Cookie', cookies.reception)
        .expect(200)
    ).body;
    const agenda = (
      await http()
        .get(`/api/appointments?from=${today}`)
        .set('Cookie', cookies.reception)
        .expect(200)
    ).body;
    expect(dash.appointments).toMatchObject({
      total: 1,
      pending: 1,
      arrived: 0,
      noShow: 0,
    });
    expect(dash.appointments.items).toEqual(
      agenda.filter((a: { status: string }) => a.status !== 'CANCELLED'),
    );
    expect(dash.reminders).toMatchObject({ upcoming: 1, overdue: 1 });
    expect(
      dash.reminders.items.map((r: { name: string; daysLeft: number }) => [
        r.name,
        r.daysLeft,
      ]),
    ).toEqual([
      ['Séxtuple', 3],
      ['Antirrábica', -10],
    ]);
    expect(dash.reminders.items[0].client.phone).toBe('987654321');
    // Avisos de la campana según el rol: la caja no ve el inventario
    expect(Array.isArray(dash.alerts)).toBe(true);

    const cashier = (
      await http()
        .get('/api/dashboard')
        .set('Cookie', cookies.cashier)
        .expect(200)
    ).body;
    expect(cashier.reminders).toBeNull();
    expect(cashier.appointments.total).toBe(1);
  });
  it('control: descuentos, anulaciones, cierre con diferencia, mermas y cambios de precio', async () => {
    await http()
      .get(`/api/reports/control?from=${today}&to=${today}`)
      .set('Cookie', cookies.vet)
      .expect(403);
    // Un descuento con motivo (10 de 50)
    await http()
      .post('/api/charges')
      .set('Cookie', cookies.reception)
      .send({
        clientId: ids.client,
        items: [
          {
            careServiceId: ids.consult,
            quantity: 1,
            discount: 5,
            discountReason: 'Cliente frecuente',
          },
        ],
      })
      .expect(201);
    // Merma de una pipeta (costo 20)
    await http()
      .post(`/api/inventory/products/${ids.pipette}/outflows`)
      .set('Cookie', cookies.admin)
      .send({
        type: 'WASTE',
        quantity: 1,
        presentationId: ids.pipettePres,
        reason: 'Se rompió',
      })
      .expect(201);
    // Cambio de precio de la consulta
    await http()
      .patch(`/api/care-services/${ids.consult}`)
      .set('Cookie', cookies.admin)
      .send({ price: 60 })
      .expect(200);
    // Cierre de caja con 5 de menos
    const session = (
      await http()
        .get('/api/cash/sessions/current')
        .set('Cookie', cookies.cashier)
        .expect(200)
    ).body;
    const expected = Number(
      session.expectedCash ?? session.totals?.expectedCash,
    );
    await http()
      .post(`/api/cash/sessions/${session.id}/close`)
      .set('Cookie', cookies.cashier)
      .send({ countedCash: expected - 5, note: 'Vuelto mal dado' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    const r = (
      await http()
        .get(`/api/reports/control?from=${today}&to=${today}`)
        .set('Cookie', cookies.admin)
        .expect(200)
    ).body;
    expect(r.kpis).toMatchObject({
      discounts: 5,
      discountCount: 1,
      voided: 195,
      voidCount: 2,
      cashNet: -5,
      cashSessions: 1,
      cashWithDifference: 1,
      waste: 20,
    });
    expect(r.discountsByUser[0]).toMatchObject({
      amount: 5,
      count: 1,
      user: { role: 'RECEPTION' },
    });
    expect(r.discountsByReason).toEqual([
      { reason: 'cliente frecuente', amount: 5, count: 1 },
    ]);
    expect(r.maxApplied).toBe(10);
    expect(
      r.voids.items.map(
        (v: { kind: string; amount: number; reason: string }) => [
          v.kind,
          v.amount,
          v.reason,
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        ['charge', 100, 'Registrado por error'],
        ['receipt', 95, 'Cobro duplicado'],
      ]),
    );
    expect(r.closings.points).toHaveLength(1);
    expect(r.closings.items[0]).toMatchObject({
      difference: -5,
      note: 'Vuelto mal dado',
    });
    expect(r.waste.byType).toEqual([
      { type: 'WASTE', amount: 20, count: 1 },
      { type: 'COUNT_ADJUST', amount: 0, count: 0 },
    ]);
    expect(r.waste.items[0]).toMatchObject({
      product: 'Pipeta antipulgas',
      quantity: 1,
      value: 20,
      reason: 'Se rompió',
    });
    expect(r.priceChanges.items[0]).toMatchObject({
      name: 'Consulta general',
      before: 50,
      after: 60,
    });
    const cashier = r.people.find(
      (x: { user: { role: string } }) => x.user.role === 'CASHIER',
    );
    expect(cashier).toMatchObject({ cashDifference: -5 });
    expect(r.series).toHaveLength(24);
    expect(sum(r.series, 'voided')).toBe(195);

    // Otra clínica no ve nada
    const other = (
      await http()
        .get(`/api/reports/control?from=${today}&to=${today}`)
        .set('Cookie', cookies.other)
        .expect(200)
    ).body;
    expect(other.kpis).toMatchObject({
      discounts: 0,
      voided: 0,
      waste: 0,
      cashSessions: 0,
    });
    expect(other.people).toEqual([]);
  });
});
