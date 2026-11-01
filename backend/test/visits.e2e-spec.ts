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

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'GROOMER';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Atenciones, cargos y cuenta del cliente (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());

  const ids = {
    client: 0,
    pet: 0,
    queue: 0,
    visit: 0,
    vaccine: 0,
    ketamine: 0,
    shampoo: 0,
    pipette: 0,
    pipettePres: 0,
    sVaccination: 0,
    sCastration: 0,
    sBath: 0,
    lotEarly: 0,
    lotLate: 0,
  };

  async function login(
    clinicId: number,
    role: Role,
    key: string,
    licenseNumber?: string,
  ) {
    const email = `${key}-visits-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
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
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  async function product(body: Record<string, unknown>) {
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.admin)
      .send(body)
      .expect(201);
    return res.body as { id: number; presentations: { id: number }[] };
  }

  async function purchase(
    productId: number,
    presentationId: number,
    quantity: number,
    lotNumber: string,
    days: number,
  ) {
    const res = await http()
      .post(`/api/inventory/products/${productId}/purchases`)
      .set('Cookie', cookies.admin)
      .send({
        presentationId,
        quantity,
        lotNumber,
        expiresAt: addDays(today, days),
      })
      .expect(201);
    return (res.body.batches as { id: number; lotNumber: string }[]).find(
      (b) => b.lotNumber === lotNumber,
    )!.id;
  }

  async function service(body: Record<string, unknown>) {
    const res = await http()
      .post('/api/care-services')
      .set('Cookie', cookies.admin)
      .send(body)
      .expect(201);
    return res.body.id as number;
  }

  const batchQty = async (id: number) =>
    Number(
      (await prisma.productBatch.findUniqueOrThrow({ where: { id } })).quantity,
    );
  const charge = (cookie: string, body: Record<string, unknown>) =>
    http().post('/api/charges').set('Cookie', cookie).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e atenciones', 'Otra clínica atenciones'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet', 'CMVP-777');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'GROOMER', 'groomer');
    await login(other, 'ADMIN', 'other');

    const client = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        name: 'Rosa Quispe',
        phone: '987654321',
        consent: true,
        pet: { name: 'Toby', species: 'DOG', weightKg: 10 },
      })
      .expect(201);
    ids.client = client.body.id;
    ids.pet = client.body.pets[0].id;

    const vaccine = await product({
      name: 'Vacuna séxtuple',
      category: 'VACCINE',
      baseUnit: 'UNIT',
      presentations: [{ name: 'Dosis', factor: 1, price: 40 }],
    });
    ids.vaccine = vaccine.id;
    ids.lotEarly = await purchase(
      vaccine.id,
      vaccine.presentations[0].id,
      1,
      'V-EARLY',
      20,
    );
    ids.lotLate = await purchase(
      vaccine.id,
      vaccine.presentations[0].id,
      5,
      'V-LATE',
      200,
    );

    const ketamine = await product({
      name: 'Ketamina 50 mg/ml',
      category: 'MEDICINE',
      baseUnit: 'ML',
      controlled: true,
      presentations: [{ name: 'Frasco x 10 ml', factor: 10, price: 90 }],
    });
    ids.ketamine = ketamine.id;
    await purchase(ketamine.id, ketamine.presentations[0].id, 1, 'K-1', 300);

    ids.shampoo = (
      await product({
        name: 'Champú clorhexidina',
        category: 'HYGIENE',
        baseUnit: 'ML',
        presentations: [{ name: 'Frasco x 500 ml', factor: 500, price: 55 }],
      })
    ).id;

    const pipette = await product({
      name: 'Pipeta antipulgas',
      category: 'ANTIPARASITIC',
      baseUnit: 'UNIT',
      presentations: [{ name: 'Pipeta', factor: 1, price: 45 }],
    });
    ids.pipette = pipette.id;
    ids.pipettePres = pipette.presentations[0].id;
    await purchase(pipette.id, ids.pipettePres, 1, 'P-1', 300);

    ids.sVaccination = await service({
      name: 'Vacunación séxtuple',
      category: 'VACCINATION',
      price: 60,
      supplies: [{ productId: ids.vaccine, quantity: 1 }],
    });
    ids.sCastration = await service({
      name: 'Castración',
      category: 'SURGERY',
      price: 180,
      supplies: [{ productId: ids.ketamine, quantity: 2 }],
    });
    ids.sBath = await service({
      name: 'Baño medicado',
      category: 'GROOMING',
      price: 45,
      supplies: [{ productId: ids.shampoo, quantity: 30 }],
    });
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.stockShortage.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.visitAddendum.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
      await prisma.queueEntry.deleteMany({ where });
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

  it('"Atender" desde la cola abre la atención y la pasa a "En atención"', async () => {
    ids.queue = (
      await http()
        .post('/api/queue')
        .set('Cookie', cookies.reception)
        .send({ petId: ids.pet, reason: 'Vacuna anual' })
        .expect(201)
    ).body.id;

    await http()
      .post('/api/visits')
      .set('Cookie', cookies.groomer)
      .send({ petId: ids.pet, queueEntryId: ids.queue })
      .expect(403);
    const res = await http()
      .post('/api/visits')
      .set('Cookie', cookies.vet)
      .send({ petId: ids.pet, queueEntryId: ids.queue })
      .expect(201);
    ids.visit = res.body.id;
    expect(res.body).toMatchObject({
      status: 'OPEN',
      reason: 'Vacuna anual',
      pet: { name: 'Toby', number: 1 },
      client: { name: 'Rosa Quispe' },
      charges: [],
      total: 0,
    });

    const queue = await http()
      .get('/api/queue')
      .set('Cookie', cookies.reception)
      .expect(200);
    const entry = queue.body.items.find(
      (i: { id: number }) => i.id === ids.queue,
    );
    expect(entry).toMatchObject({
      status: 'IN_PROGRESS',
      visit: { id: ids.visit, status: 'OPEN' },
    });
  });

  it('no abre dos atenciones a la vez ni deja mover la cola por fuera de la atención', async () => {
    const twice = await http()
      .post('/api/visits')
      .set('Cookie', cookies.reception)
      .send({ petId: ids.pet })
      .expect(409);
    expect(twice.body.details).toEqual({ visitId: ids.visit });
    await http()
      .patch(`/api/queue/${ids.queue}`)
      .set('Cookie', cookies.reception)
      .send({ status: 'DONE' })
      .expect(409);
  });

  it('un servicio descuenta sus insumos por FEFO y congela precio e IGV', async () => {
    const res = await charge(cookies.reception, {
      visitId: ids.visit,
      items: [{ careServiceId: ids.sVaccination, quantity: 1 }],
    }).expect(201);
    expect(res.body.shortages).toEqual([]);
    expect(res.body.charges[0]).toMatchObject({
      kind: 'SERVICE',
      description: 'Vacunación séxtuple',
      unitPrice: 60,
      total: 60,
      taxableAmount: 50.85,
      igvAmount: 9.15,
      status: 'PENDING',
      pet: { id: ids.pet, name: 'Toby' },
    });
    // Sale del lote que vence antes
    expect(await batchQty(ids.lotEarly)).toBe(0);
    expect(await batchQty(ids.lotLate)).toBe(5);

    // Cambiar el catálogo no cambia lo ya cargado
    await http()
      .patch(`/api/care-services/${ids.sVaccination}`)
      .set('Cookie', cookies.admin)
      .send({ price: 70 })
      .expect(200);
    const account = await http()
      .get(`/api/clients/${ids.client}/account`)
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(account.body.pending.map((c: { total: number }) => c.total)).toEqual(
      [60],
    );
    expect(account.body.pendingTotal).toBe(60);
  });

  it('un servicio con un insumo sin stock se cobra igual y deja la alerta al administrador', async () => {
    const res = await charge(cookies.reception, {
      visitId: ids.visit,
      items: [{ careServiceId: ids.sBath, quantity: 1 }],
    }).expect(201);
    expect(res.body.charges[0].total).toBe(45);
    expect(res.body.shortages).toEqual([
      { product: 'Champú clorhexidina', baseUnit: 'ML', quantity: 30 },
    ]);

    await http()
      .get('/api/inventory/shortages')
      .set('Cookie', cookies.reception)
      .expect(403);
    const list = await http()
      .get('/api/inventory/shortages')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      product: { name: 'Champú clorhexidina' },
      quantity: 30,
      charge: { description: 'Baño medicado', pet: { name: 'Toby' } },
    });
    // La campana avisa al veterinario, no a recepción
    const kinds = async (role: string) =>
      (
        await http()
          .get('/api/dashboard/alerts')
          .set('Cookie', cookies[role])
          .expect(200)
      ).body.map(
        (a: { kind: string; count: number }) => `${a.kind}:${a.count}`,
      );
    expect(await kinds('vet')).toContain('shortage:1');
    expect(await kinds('reception')).not.toContainEqual(
      expect.stringMatching(/^shortage/),
    );
    await http()
      .post(`/api/inventory/shortages/${list.body[0].id}/resolve`)
      .set('Cookie', cookies.vet)
      .send({ resolution: 'Se registró la compra' })
      .expect(403);
    await http()
      .post(`/api/inventory/shortages/${list.body[0].id}/resolve`)
      .set('Cookie', cookies.admin)
      .send({ resolution: 'Se registró la compra del frasco' })
      .expect(201);
    const open = await http()
      .get('/api/inventory/shortages')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(open.body).toEqual([]);
    expect(await kinds('admin')).not.toContainEqual(
      expect.stringMatching(/^shortage/),
    );
  });

  it('venta directa sin stock: 409 y no queda nada de la operación, ni las otras líneas', async () => {
    const before = await http()
      .get(`/api/clients/${ids.client}/account`)
      .set('Cookie', cookies.reception)
      .expect(200);
    const res = await charge(cookies.reception, {
      visitId: ids.visit,
      items: [
        { careServiceId: ids.sVaccination, quantity: 1 },
        {
          productId: ids.pipette,
          presentationId: ids.pipettePres,
          quantity: 2,
        },
      ],
    }).expect(409);
    expect(res.body.message).toContain('Pipeta antipulgas');
    const after = await http()
      .get(`/api/clients/${ids.client}/account`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(after.body.pending).toHaveLength(before.body.pending.length);
    expect(await batchQty(ids.lotLate)).toBe(5);
  });

  it('controlados: exige receta y veterinario con colegiatura, y quedan en el libro', async () => {
    const castration = { careServiceId: ids.sCastration, quantity: 1 };
    const noRecipe = await charge(cookies.vet, {
      visitId: ids.visit,
      items: [castration],
    }).expect(400);
    expect(noRecipe.body.message).toContain('N.º de receta');
    await charge(cookies.reception, {
      visitId: ids.visit,
      items: [{ ...castration, prescriptionRef: 'R-001' }],
    }).expect(403);
    await charge(cookies.vet, {
      visitId: ids.visit,
      items: [{ ...castration, prescriptionRef: 'R-001' }],
    }).expect(201);

    const book = await http()
      .get('/api/inventory/controlled')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(JSON.stringify(book.body)).toContain('R-001');
  });

  it('descuentos: con motivo, y por encima del tope solo el administrador', async () => {
    const pipette = (discount: number, reason?: string) => ({
      clientId: ids.client,
      items: [
        {
          productId: ids.pipette,
          presentationId: ids.pipettePres,
          quantity: 1,
          discount,
          discountReason: reason,
        },
      ],
    });
    await charge(cookies.reception, pipette(4.5)).expect(400);
    await charge(cookies.reception, pipette(9, 'Cliente frecuente')).expect(
      403,
    );
    const res = await charge(
      cookies.admin,
      pipette(9, 'Cliente frecuente'),
    ).expect(201);
    expect(res.body.charges[0]).toMatchObject({
      visitId: null,
      total: 36,
      discount: 9,
      taxableAmount: 30.51,
      igvAmount: 5.49,
    });
    const audit = await prisma.auditLog.findFirst({
      where: {
        clinicId: clinicIds[0],
        action: 'charge.create',
        entityId: String(res.body.charges[0].id),
      },
    });
    expect(audit?.data).toMatchObject({
      discounts: [{ discount: 9, reason: 'Cliente frecuente' }],
    });
  });

  it('quitar un cargo: quien lo registró mientras está abierta; el stock vuelve a su lote', async () => {
    const account = await http()
      .get(`/api/clients/${ids.client}/account`)
      .set('Cookie', cookies.reception)
      .expect(200);
    const vaccination = account.body.pending.find(
      (c: { description: string }) => c.description === 'Vacunación séxtuple',
    );
    const castration = account.body.pending.find(
      (c: { description: string }) => c.description === 'Castración',
    );
    // La castración la registró el veterinario
    await http()
      .post(`/api/charges/${castration.id}/void`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Error' })
      .expect(403);

    const res = await http()
      .post(`/api/charges/${vaccination.id}/void`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Se registró dos veces' })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'VOID',
      voidReason: 'Se registró dos veces',
    });
    expect(await batchQty(ids.lotEarly)).toBe(1);
    const returned = await prisma.stockMovement.findFirst({
      where: { refType: 'charge', refId: vaccination.id, type: 'RETURN' },
    });
    expect(returned?.batchId).toBe(ids.lotEarly);
    await http()
      .post(`/api/charges/${vaccination.id}/void`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Otra vez' })
      .expect(409);
  });

  it('el peso actualiza la ficha; cerrada, la atención solo admite adendas', async () => {
    await http()
      .patch(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .send({
        weightKg: 12.4,
        temperatureC: 38.6,
        notes: 'Sano. Vacuna aplicada.',
      })
      .expect(200);
    const pet = await prisma.pet.findUniqueOrThrow({ where: { id: ids.pet } });
    expect(Number(pet.weightKg)).toBe(12.4);

    const closed = await http()
      .post(`/api/visits/${ids.visit}/close`)
      .set('Cookie', cookies.vet)
      .expect(201);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      closedBy: { fullName: 'VET vet' },
    });
    const queue = await http()
      .get('/api/queue')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(
      queue.body.items.find((i: { id: number }) => i.id === ids.queue).status,
    ).toBe('DONE');

    await http()
      .patch(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .send({ notes: 'Cambio' })
      .expect(409);
    await charge(cookies.vet, {
      visitId: ids.visit,
      items: [{ careServiceId: ids.sVaccination, quantity: 1 }],
    }).expect(409);
    const addendum = await http()
      .post(`/api/visits/${ids.visit}/addenda`)
      .set('Cookie', cookies.vet)
      .send({ text: 'La temperatura correcta era 38.9' })
      .expect(201);
    expect(addendum.body.notes).toBe('Sano. Vacuna aplicada.');
    expect(addendum.body.addenda[0]).toMatchObject({
      text: 'La temperatura correcta era 38.9',
      author: { fullName: 'VET vet' },
    });

    // Cerrada: el veterinario ya no puede quitar su cargo; el administrador sí
    const account = await http()
      .get(`/api/clients/${ids.client}/account`)
      .set('Cookie', cookies.reception)
      .expect(200);
    const castration = account.body.pending.find(
      (c: { description: string }) => c.description === 'Castración',
    );
    await http()
      .post(`/api/charges/${castration.id}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'No se hizo' })
      .expect(403);
    await http()
      .post(`/api/charges/${castration.id}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Se reprogramó la cirugía' })
      .expect(201);
  });

  it('cancelar exige quitar antes los cargos y devuelve la mascota a la espera', async () => {
    const queue = (
      await http()
        .post('/api/queue')
        .set('Cookie', cookies.reception)
        .send({ petId: ids.pet })
        .expect(201)
    ).body.id;
    const visit = (
      await http()
        .post('/api/visits')
        .set('Cookie', cookies.reception)
        .send({ petId: ids.pet, queueEntryId: queue })
        .expect(201)
    ).body.id;
    const added = await charge(cookies.reception, {
      visitId: visit,
      items: [{ careServiceId: ids.sVaccination, quantity: 1 }],
    }).expect(201);
    expect(added.body.charges[0].unitPrice).toBe(70);
    await http()
      .post(`/api/visits/${visit}/cancel`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Se abrió por error' })
      .expect(409);
    await http()
      .post(`/api/charges/${added.body.charges[0].id}/void`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Atención abierta por error' })
      .expect(201);
    const cancelled = await http()
      .post(`/api/visits/${visit}/cancel`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Se abrió por error' })
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    const list = await http()
      .get('/api/queue')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(
      list.body.items.find((i: { id: number }) => i.id === queue),
    ).toMatchObject({
      status: 'WAITING',
      attendedBy: null,
      visit: null,
    });
  });

  it('historial de atenciones de la mascota con su total', async () => {
    const res = await http()
      .get(`/api/visits?petId=${ids.pet}`)
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(res.body.items.map((v: { status: string }) => v.status)).toEqual([
      'CANCELLED',
      'CLOSED',
    ]);
    // Quedó el baño (45); la vacuna y la castración se quitaron
    expect(res.body.items[1].total).toBe(45);
  });

  it('dos clics simultáneos en "Atender" abren una sola atención', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        http()
          .post('/api/visits')
          .set('Cookie', cookies.reception)
          .send({ petId: ids.pet }),
      ),
    );
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const opened = results.find((r) => r.status === 201)!.body.id;
    await http()
      .post(`/api/visits/${opened}/cancel`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Prueba de doble clic' })
      .expect(201);
  });

  it('otra clínica no ve ni toca atenciones, cargos ni cuentas ajenas', async () => {
    const other = cookies.other;
    await http()
      .get(`/api/visits/${ids.visit}`)
      .set('Cookie', other)
      .expect(404);
    await http()
      .get(`/api/clients/${ids.client}/account`)
      .set('Cookie', other)
      .expect(404);
    await http()
      .post('/api/visits')
      .set('Cookie', other)
      .send({ petId: ids.pet })
      .expect(404);
    await charge(other, {
      visitId: ids.visit,
      items: [{ careServiceId: ids.sVaccination, quantity: 1 }],
    }).expect(404);
    await charge(other, {
      clientId: ids.client,
      items: [{ careServiceId: ids.sVaccination, quantity: 1 }],
    }).expect(404);
    const pending = await prisma.charge.findFirstOrThrow({
      where: { clientId: ids.client, status: 'PENDING' },
    });
    await http()
      .post(`/api/charges/${pending.id}/void`)
      .set('Cookie', other)
      .send({ reason: 'Intento' })
      .expect(404);
    const list = await http()
      .get('/api/visits')
      .set('Cookie', other)
      .expect(200);
    expect(list.body.total).toBe(0);
  });
});
