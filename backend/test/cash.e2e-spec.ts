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

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER' | 'GROOMER';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Caja: sesiones, cobros, mostrador, egresos y arqueo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());

  const ids = {
    client: 0,
    pipette: 0,
    pipettePres: 0,
    monitor: 0,
    monitorPres: 0,
    sConsult: 0,
    session: 0,
    receipt: 0,
    otherSession: 0,
  };

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-cash-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  async function product(
    name: string,
    price: number,
    stock: number,
  ): Promise<[number, number]> {
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.admin)
      .send({
        name,
        category: 'ACCESSORY',
        baseUnit: 'UNIT',
        presentations: [{ name: 'Unidad', factor: 1, price }],
      })
      .expect(201);
    const presentation = res.body.presentations[0].id as number;
    if (stock)
      await http()
        .post(`/api/inventory/products/${res.body.id}/purchases`)
        .set('Cookie', cookies.admin)
        .send({
          presentationId: presentation,
          quantity: stock,
          expiresAt: addDays(today, 300),
        })
        .expect(201);
    return [res.body.id, presentation];
  }

  const collect = (cookie: string, body: Record<string, unknown>) =>
    http()
      .post('/api/cash/receipts')
      .set('Cookie', cookie)
      .send({ requestKey: randomUUID(), clientId: ids.client, ...body });
  const account = async () =>
    (
      await http()
        .get(`/api/clients/${ids.client}/account`)
        .set('Cookie', cookies.cashier)
        .expect(200)
    ).body as {
      pendingTotal: number;
      pending: {
        id: number;
        description: string;
        paidAmount: number;
        balance: number;
      }[];
    };
  const stock = async (productId: number) =>
    Number(
      (await prisma.product.findUniqueOrThrow({ where: { id: productId } }))
        .totalStock,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e caja', 'Otra clínica caja'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'CASHIER', 'cashier');
    await login(mine, 'GROOMER', 'groomer');
    await login(other, 'ADMIN', 'other');

    ids.client = (
      await http()
        .post('/api/clients')
        .set('Cookie', cookies.reception)
        .send({ name: 'Rosa Quispe', phone: '987654321', consent: true })
        .expect(201)
    ).body.id;
    [ids.pipette, ids.pipettePres] = await product('Pipeta antipulgas', 45, 5);
    [ids.monitor, ids.monitorPres] = await product('Collar GPS', 800, 2);
    ids.sConsult = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({ name: 'Consulta general', category: 'CONSULTATION', price: 50 })
        .expect(201)
    ).body.id;
    const vaccination = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({ name: 'Vacunación', category: 'VACCINATION', price: 60 })
        .expect(201)
    ).body.id;

    // Deuda inicial: consulta 50 + pipeta 45 + vacunación 60 = 155
    await http()
      .post('/api/charges')
      .set('Cookie', cookies.reception)
      .send({
        clientId: ids.client,
        items: [
          { careServiceId: ids.sConsult, quantity: 1 },
          {
            productId: ids.pipette,
            presentationId: ids.pipettePres,
            quantity: 1,
          },
          { careServiceId: vaccination, quantity: 1 },
        ],
      })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.cashMovement.deleteMany({ where });
      await prisma.paymentAllocation.deleteMany({
        where: { receipt: { clinicId: { in: clinicIds } } },
      });
      await prisma.payment.deleteMany({ where });
      await prisma.receipt.deleteMany({ where });
      await prisma.cashSession.deleteMany({ where });
      await prisma.cashRegister.deleteMany({ where });
      await prisma.stockShortage.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.careServiceSupply.deleteMany({
        where: { service: { clinicId: { in: clinicIds } } },
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
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('sin caja abierta no se cobra; el veterinario y el groomer no manejan caja', async () => {
    const res = await collect(cookies.cashier, {
      payments: [{ method: 'CASH', amount: 155 }],
    }).expect(409);
    expect(res.body.message).toContain('La caja está cerrada');
    for (const who of ['vet', 'groomer'])
      await http()
        .post('/api/cash/sessions')
        .set('Cookie', cookies[who])
        .send({ openingAmount: 100 })
        .expect(403);
  });

  it('abre la "Caja principal" con su monto inicial, una sola vez', async () => {
    const res = await http()
      .post('/api/cash/sessions')
      .set('Cookie', cookies.cashier)
      .send({ openingAmount: 100 })
      .expect(201);
    ids.session = res.body.id;
    expect(res.body).toMatchObject({
      status: 'OPEN',
      register: { name: 'Caja principal' },
      openingAmount: 100,
      expectedCash: 100,
    });
    const twice = await http()
      .post('/api/cash/sessions')
      .set('Cookie', cookies.reception)
      .send({ openingAmount: 50 })
      .expect(409);
    expect(twice.body.details).toEqual({ sessionId: ids.session });
  });

  it('valida los medios de pago y el monto', async () => {
    await collect(cookies.cashier, {
      amount: 30,
      payments: [{ method: 'YAPE', amount: 30 }],
    }).expect(400);
    await collect(cookies.cashier, {
      amount: 30,
      payments: [{ method: 'CASH', amount: 20 }],
    }).expect(400);
    await collect(cookies.cashier, {
      amount: 200,
      payments: [{ method: 'CASH', amount: 200 }],
    }).expect(409);
  });

  it('cobro mixto y parcial: vuelto exacto, del cargo más antiguo al más nuevo, y saldo', async () => {
    const res = await collect(cookies.cashier, {
      amount: 80,
      payments: [
        { method: 'CASH', amount: 50, tendered: 100 },
        { method: 'YAPE', amount: 30, operationCode: '0012345' },
      ],
    }).expect(201);
    ids.receipt = res.body.id;
    expect(res.body).toMatchObject({
      code: 'NV-000001',
      legend: 'Nota de venta interna — no es comprobante de pago',
      register: 'Caja principal',
      client: { name: 'Rosa Quispe', walkIn: false },
      totals: { paid: 80, change: 50, balance: 75 },
    });
    expect(
      res.body.lines.map((l: { description: string; paid: number }) => [
        l.description,
        l.paid,
      ]),
    ).toEqual([
      ['Consulta general', 50],
      ['Pipeta antipulgas · Unidad', 30],
    ]);

    const acc = await account();
    expect(acc.pendingTotal).toBe(75);
    expect(
      acc.pending.map((c) => [c.description, c.paidAmount, c.balance]),
    ).toEqual([
      ['Pipeta antipulgas · Unidad', 30, 15],
      ['Vacunación', 0, 60],
    ]);
  });

  it('el mismo cobro enviado dos veces queda una sola vez (también en paralelo)', async () => {
    const requestKey = randomUUID();
    const body = {
      requestKey,
      clientId: ids.client,
      amount: 10,
      payments: [{ method: 'CASH', amount: 10 }],
    };
    const [a, b] = await Promise.all(
      [1, 2].map(() =>
        http()
          .post('/api/cash/receipts')
          .set('Cookie', cookies.cashier)
          .send(body),
      ),
    );
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    const again = await http()
      .post('/api/cash/receipts')
      .set('Cookie', cookies.cashier)
      .send(body)
      .expect(201);
    expect(again.body.id).toBe(a.body.id);
    expect((await account()).pendingTotal).toBe(65);
  });

  it('lista de "por cobrar": clientes con saldo', async () => {
    const res = await http()
      .get('/api/cash/pending')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        client: expect.objectContaining({
          id: ids.client,
          name: 'Rosa Quispe',
        }),
        balance: 65,
        charges: 2,
      }),
    ]);
    await http()
      .get('/api/cash/pending')
      .set('Cookie', cookies.vet)
      .expect(403);
  });

  it('un cargo con pagos no se quita: primero se anula el cobro', async () => {
    const pipette = (await account()).pending[0];
    const res = await http()
      .post(`/api/charges/${pipette.id}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Error' })
      .expect(409);
    expect(res.body.message).toContain('anula el cobro');
  });

  it('venta de mostrador a "Cliente varios": cargos, stock y cobro en una sola operación', async () => {
    const before = await stock(ids.pipette);
    const requestKey = randomUUID();
    const sale = {
      requestKey,
      items: [
        {
          productId: ids.pipette,
          presentationId: ids.pipettePres,
          quantity: 1,
        },
      ],
      payments: [{ method: 'CARD', amount: 45, operationCode: 'VOUCHER-1' }],
    };
    const res = await http()
      .post('/api/cash/counter-sales')
      .set('Cookie', cookies.reception)
      .send(sale)
      .expect(201);
    expect(res.body.receipt).toMatchObject({
      client: { name: 'Cliente varios', walkIn: true, number: 0 },
      totals: { paid: 45, balance: 0 },
    });
    expect(await stock(ids.pipette)).toBe(before - 1);
    // Reintento: mismo cobro, sin descontar otra vez
    const retry = await http()
      .post('/api/cash/counter-sales')
      .set('Cookie', cookies.reception)
      .send(sale)
      .expect(201);
    expect(retry.body.receipt.id).toBe(res.body.receipt.id);
    expect(await stock(ids.pipette)).toBe(before - 1);

    const list = await http()
      .get('/api/clients')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(list.body.items.map((c: { name: string }) => c.name)).not.toContain(
      'Cliente varios',
    );
  });

  it('mostrador: sin deuda para anónimos, identificar desde S/ 700 y nada si falta stock', async () => {
    const receipts = await prisma.receipt.count({
      where: { clinicId: clinicIds[0] },
    });
    const sell = (
      items: Record<string, unknown>[],
      payments: Record<string, unknown>[],
    ) =>
      http()
        .post('/api/cash/counter-sales')
        .set('Cookie', cookies.reception)
        .send({ requestKey: randomUUID(), items, payments });
    const monitor = {
      productId: ids.monitor,
      presentationId: ids.monitorPres,
      quantity: 1,
    };
    const big = await sell([monitor], [{ method: 'CARD', amount: 800 }]).expect(
      400,
    );
    expect(big.body.message).toContain('Desde S/ 700');
    await sell(
      [
        {
          productId: ids.pipette,
          presentationId: ids.pipettePres,
          quantity: 1,
        },
      ],
      [{ method: 'CASH', amount: 20 }],
    ).expect(400);
    await sell(
      [
        {
          productId: ids.pipette,
          presentationId: ids.pipettePres,
          quantity: 99,
        },
      ],
      [{ method: 'CASH', amount: 4455 }],
    ).expect(409);
    expect(
      await prisma.receipt.count({ where: { clinicId: clinicIds[0] } }),
    ).toBe(receipts);
    expect(await stock(ids.monitor)).toBe(2);
  });

  it('egresos de caja chica: registra el personal de caja, anula solo el administrador', async () => {
    await http()
      .post('/api/cash/expenses')
      .set('Cookie', cookies.reception)
      .send({ amount: 15, reason: 'Bidón de agua' })
      .expect(201);
    const wrong = await http()
      .post('/api/cash/expenses')
      .set('Cookie', cookies.reception)
      .send({ amount: 5, reason: 'Registrado por error' })
      .expect(201);
    const id = wrong.body.movements.find(
      (m: { amount: number }) => m.amount === 5,
    ).id;
    await http()
      .post(`/api/cash/expenses/${id}/void`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Error' })
      .expect(403);
    const res = await http()
      .post(`/api/cash/expenses/${id}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Se registró dos veces' })
      .expect(201);
    expect(res.body.expenses).toBe(15);
  });

  it('anular un cobro: solo el administrador; los cargos vuelven a pendientes y sale la devolución', async () => {
    await http()
      .post(`/api/cash/receipts/${ids.receipt}/void`)
      .set('Cookie', cookies.cashier)
      .send({ reason: 'Error' })
      .expect(403);
    const res = await http()
      .post(`/api/cash/receipts/${ids.receipt}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Cobro al cliente equivocado' })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'VOID',
      voidReason: 'Cobro al cliente equivocado',
    });
    expect((await account()).pendingTotal).toBe(145);
    await http()
      .post(`/api/cash/receipts/${ids.receipt}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Otra vez' })
      .expect(409);

    const summary = await http()
      .get(`/api/cash/sessions/${ids.session}`)
      .set('Cookie', cookies.cashier)
      .expect(200);
    const refunds = summary.body.movements.filter(
      (m: { kind: string }) => m.kind === 'REFUND',
    );
    expect(
      refunds.map((m: { method: string; amount: number }) => [
        m.method,
        m.amount,
      ]),
    ).toEqual([
      ['CASH', 50],
      ['YAPE', 30],
    ]);
  });

  it('la campana avisa a la caja si quedó abierta desde otro día', async () => {
    const kinds = async (cookie: string) =>
      (
        await http()
          .get('/api/dashboard/alerts')
          .set('Cookie', cookie)
          .expect(200)
      ).body.map((a: { kind: string }) => a.kind);
    expect(await kinds(cookies.cashier)).not.toContain('staleCash');
    const session = await prisma.cashSession.findUniqueOrThrow({
      where: { id: ids.session },
    });
    await prisma.cashSession.update({
      where: { id: ids.session },
      data: { openedAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    expect(await kinds(cookies.cashier)).toContain('staleCash');
    expect(await kinds(cookies.vet)).not.toContain('staleCash');
    await prisma.cashSession.update({
      where: { id: ids.session },
      data: { openedAt: session.openedAt },
    });
  });

  it('cierre con arqueo: esperado = inicial + efectivo − egresos − devoluciones', async () => {
    const live = await http()
      .get('/api/cash/sessions/current')
      .set('Cookie', cookies.cashier)
      .expect(200);
    // 100 inicial + (50 + 10) en efectivo − 15 de egreso − 50 devueltos
    expect(live.body.expectedCash).toBe(95);
    expect(
      live.body.byMethod
        .filter((m: { collected: number }) => m.collected > 0)
        .map((m: { method: string; collected: number; refunded: number }) => [
          m.method,
          m.collected,
          m.refunded,
        ]),
    ).toEqual([
      ['CASH', 60, 50],
      ['YAPE', 30, 30],
      ['CARD', 45, 0],
    ]);

    const url = `/api/cash/sessions/${ids.session}/close`;
    const noNote = await http()
      .post(url)
      .set('Cookie', cookies.cashier)
      .send({ countedCash: 90 })
      .expect(400);
    expect(noNote.body.message).toContain('diferencia de S/ -5.00');
    const closed = await http()
      .post(url)
      .set('Cookie', cookies.cashier)
      .send({ countedCash: 90, note: 'Faltan 5 soles de vuelto mal dado' })
      .expect(201);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      expectedCash: 95,
      countedCash: 90,
      difference: -5,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { clinicId: clinicIds[0], action: 'cash.close_difference' },
    });
    expect(audit?.data).toMatchObject({
      expected: 95,
      counted: 90,
      difference: -5,
    });

    await http()
      .post(url)
      .set('Cookie', cookies.cashier)
      .send({ countedCash: 90 })
      .expect(409);
    await collect(cookies.cashier, {
      amount: 10,
      payments: [{ method: 'CASH', amount: 10 }],
    }).expect(409);
    await http()
      .post('/api/cash/expenses')
      .set('Cookie', cookies.cashier)
      .send({ amount: 1, reason: 'Después del cierre' })
      .expect(409);
    const current = await http()
      .get('/api/cash/sessions/current')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(current.body).toEqual({});
  });

  it('dashboard y reporte: lo cobrado hoy menos lo devuelto', async () => {
    const dash = await http()
      .get('/api/dashboard')
      .set('Cookie', cookies.groomer)
      .expect(200);
    // 50 + 30 + 10 + 45 cobrados − 80 devueltos; cobros vigentes: el de 10 y el de mostrador
    expect(dash.body.sales).toEqual({ total: 55, receipts: 2 });
    expect(dash.body.clients.active).toBe(1);

    await http()
      .get(`/api/cash/report?from=${today}&to=${today}`)
      .set('Cookie', cookies.cashier)
      .expect(403);
    const report = await http()
      .get(`/api/cash/report?from=${today}&to=${today}`)
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(report.body.net).toBe(55);
    expect(report.body.days).toEqual([
      { day: today, collected: 135, refunded: 80, net: 55 },
    ]);
  });

  it('otra clínica no ve ni toca la caja, los cobros ni los clientes ajenos', async () => {
    const other = cookies.other;
    await http()
      .get(`/api/cash/receipts/${ids.receipt}`)
      .set('Cookie', other)
      .expect(404);
    await http()
      .get(`/api/cash/sessions/${ids.session}`)
      .set('Cookie', other)
      .expect(404);
    ids.otherSession = (
      await http()
        .post('/api/cash/sessions')
        .set('Cookie', other)
        .send({ openingAmount: 0 })
        .expect(201)
    ).body.id;
    await collect(other, {
      payments: [{ method: 'CASH', amount: 145 }],
    }).expect(404);
    await http()
      .post(`/api/cash/receipts/${ids.receipt}/void`)
      .set('Cookie', other)
      .send({ reason: 'Intento' })
      .expect(404);
    const sessions = await http()
      .get('/api/cash/sessions')
      .set('Cookie', other)
      .expect(200);
    expect(sessions.body.items.map((s: { id: number }) => s.id)).toEqual([
      ids.otherSession,
    ]);
  });
});
