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

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Presupuestos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());
  const ids = {
    pet: 0,
    pet2: 0,
    surgery: 0,
    exam: 0,
    ketamine: 0,
    meloxicam: 0,
    meloxicamBox: 0,
    estimate: 0,
    visit: 0,
  };

  async function login(
    clinicId: number,
    role: Role,
    key: string,
    licenseNumber: string | null = null,
  ) {
    const email = `${key}-est-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        licenseNumber,
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
    const created = res.body as { id: number; presentations: { id: number }[] };
    await http()
      .post(`/api/inventory/products/${created.id}/purchases`)
      .set('Cookie', cookies.admin)
      .send({
        presentationId: created.presentations[0].id,
        quantity: 5,
        lotNumber: `L-${created.id}`,
        expiresAt: addDays(today, 200),
      })
      .expect(201);
    return created;
  }

  const estimate = (cookie: string, body: Record<string, unknown>) =>
    http().post('/api/estimates').set('Cookie', cookie).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of [
      'Clínica e2e presupuestos',
      'Otra clínica presupuestos',
    ])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin', 'CMVP-1');
    await login(mine, 'VET', 'vet', 'CMVP-2');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'CASHIER', 'cashier');
    await login(other, 'ADMIN', 'other');

    for (const [name, key] of [
      ['Toby', 'pet'],
      ['Luna', 'pet2'],
    ] as const) {
      const res = await http()
        .post('/api/clients')
        .set('Cookie', cookies.reception)
        .send({
          name: `Dueño de ${name}`,
          phone: '987654321',
          consent: true,
          pet: { name, species: 'DOG' },
        })
        .expect(201);
      ids[key] = res.body.pets[0].id;
    }

    const ketamine = await product({
      name: 'Ketamina 50 mg/ml',
      category: 'MEDICINE',
      baseUnit: 'ML',
      controlled: true,
      presentations: [{ name: 'Frasco x 10 ml', factor: 10, price: 90 }],
    });
    ids.ketamine = ketamine.id;
    const meloxicam = await product({
      name: 'Meloxicam 1 mg',
      category: 'MEDICINE',
      baseUnit: 'UNIT',
      presentations: [{ name: 'Caja x 10', factor: 10, price: 20 }],
    });
    ids.meloxicam = meloxicam.id;
    ids.meloxicamBox = meloxicam.presentations[0].id;
    ids.surgery = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({
          name: 'Castración canina',
          category: 'SURGERY',
          price: 400,
          supplies: [{ productId: ids.ketamine, quantity: 2 }],
        })
        .expect(201)
    ).body.id;
    ids.exam = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({ name: 'Hemograma', category: 'LAB', price: 60 })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.estimateItem.deleteMany({ where: { estimate: where } });
      await prisma.estimate.deleteMany({ where });
      await prisma.stockShortage.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
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

  it('emite el presupuesto con precios del catálogo y respeta el tope de descuento', async () => {
    await estimate(cookies.cashier, {
      petId: ids.pet,
      title: 'Castración',
      validDays: 15,
      items: [{ careServiceId: ids.exam, quantity: 1 }],
    }).expect(403);
    // Recepción no puede dar más del 10 %
    await estimate(cookies.reception, {
      petId: ids.pet,
      title: 'Castración',
      validDays: 15,
      items: [{ careServiceId: ids.surgery, quantity: 1, discount: 100 }],
    }).expect(403);

    const res = await estimate(cookies.vet, {
      petId: ids.pet,
      title: 'Castración y prequirúrgico',
      validDays: 15,
      notes: 'Ayuno de 12 horas',
      items: [
        { careServiceId: ids.surgery, quantity: 1, discount: 40 },
        { careServiceId: ids.exam, quantity: 1 },
        {
          productId: ids.meloxicam,
          presentationId: ids.meloxicamBox,
          quantity: 1,
        },
      ],
    }).expect(201);
    ids.estimate = res.body.id;
    expect(res.body).toMatchObject({
      code: 'PR-00001',
      status: 'PENDING',
      total: 440,
      validUntil: addDays(today, 15),
      pet: { name: 'Toby' },
      clinic: { name: 'Clínica e2e presupuestos' },
    });
    expect(res.body.taxable + res.body.igv).toBeCloseTo(440, 2);
    expect(
      res.body.items.map((i: { controlled: boolean }) => i.controlled),
    ).toEqual([true, false, false]);
  });

  it('no se carga sin aceptar; aceptado, se carga con el precio presupuestado', async () => {
    ids.visit = (
      await http()
        .post('/api/visits')
        .set('Cookie', cookies.vet)
        .send({ petId: ids.pet })
        .expect(201)
    ).body.id;
    await http()
      .post(`/api/estimates/${ids.estimate}/convert`)
      .set('Cookie', cookies.vet)
      .send({ visitId: ids.visit })
      .expect(409);

    const accepted = await http()
      .post(`/api/estimates/${ids.estimate}/accept`)
      .set('Cookie', cookies.reception)
      .send({ note: 'Aceptó por WhatsApp' })
      .expect(201);
    expect(accepted.body).toMatchObject({
      status: 'ACCEPTED',
      decisionNote: 'Aceptó por WhatsApp',
    });

    // Sube el precio del hemograma: el presupuesto se respeta
    await http()
      .patch(`/api/care-services/${ids.exam}`)
      .set('Cookie', cookies.admin)
      .send({ price: 75 })
      .expect(200);
    // Y se desactiva: el catálogo avisa que está presupuestado, y lo cotizado se cobra igual
    const catalog = await http()
      .get('/api/care-services')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(
      catalog.body.find((c: { id: number }) => c.id === ids.exam),
    ).toMatchObject({ pendingEstimates: 1 });
    await http()
      .patch(`/api/care-services/${ids.exam}`)
      .set('Cookie', cookies.admin)
      .send({ active: false })
      .expect(200);

    // Atención de otra mascota: no
    const other = (
      await http()
        .post('/api/visits')
        .set('Cookie', cookies.vet)
        .send({ petId: ids.pet2 })
        .expect(201)
    ).body.id;
    await http()
      .post(`/api/estimates/${ids.estimate}/convert`)
      .set('Cookie', cookies.vet)
      .send({ visitId: other })
      .expect(400);
    // La castración lleva ketamina: pide receta
    const noRx = await http()
      .post(`/api/estimates/${ids.estimate}/convert`)
      .set('Cookie', cookies.vet)
      .send({ visitId: ids.visit })
      .expect(400);
    expect(noRx.body.message).toContain('receta');

    const res = await http()
      .post(`/api/estimates/${ids.estimate}/convert`)
      .set('Cookie', cookies.vet)
      .send({ visitId: ids.visit, prescriptionRef: 'RX-00009' })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'CONVERTED', visitId: ids.visit });

    const visit = await http()
      .get(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(visit.body.total).toBe(440);
    const exam = visit.body.charges.find(
      (c: { description: string }) => c.description === 'Hemograma',
    );
    expect(exam).toMatchObject({
      unitPrice: 75,
      discount: 15,
      discountReason: 'Presupuesto PR-00001',
      total: 60,
    });
    // Desactivado, ya no entra en cobros nuevos
    const gone = await http()
      .post('/api/charges')
      .set('Cookie', cookies.vet)
      .send({
        visitId: ids.visit,
        items: [{ careServiceId: ids.exam, quantity: 1 }],
      })
      .expect(404);
    expect(gone.body.message).toContain('inactivo');
    await http()
      .patch(`/api/care-services/${ids.exam}`)
      .set('Cookie', cookies.admin)
      .send({ active: true })
      .expect(200);

    await http()
      .post(`/api/estimates/${ids.estimate}/convert`)
      .set('Cookie', cookies.vet)
      .send({ visitId: ids.visit, prescriptionRef: 'RX-00009' })
      .expect(409);
  });

  it('vencido no se acepta; rechazado queda cerrado; otra clínica no lo ve', async () => {
    const res = await estimate(cookies.reception, {
      petId: ids.pet2,
      title: 'Limpieza dental',
      validDays: 7,
      items: [{ careServiceId: ids.exam, quantity: 1 }],
    }).expect(201);
    expect(res.body.code).toBe('PR-00002');
    await prisma.estimate.update({
      where: { id: res.body.id },
      data: { validUntil: new Date(`${addDays(today, -1)}T00:00:00Z`) },
    });
    const list = await http()
      .get('/api/estimates?status=OPEN')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(
      list.body.find((e: { id: number }) => e.id === res.body.id).status,
    ).toBe('EXPIRED');
    await http()
      .post(`/api/estimates/${res.body.id}/accept`)
      .set('Cookie', cookies.reception)
      .send({})
      .expect(409);
    await http()
      .post(`/api/estimates/${res.body.id}/reject`)
      .set('Cookie', cookies.reception)
      .send({ note: 'Lo hará más adelante' })
      .expect(201);
    await http()
      .get(`/api/estimates/${res.body.id}`)
      .set('Cookie', cookies.other)
      .expect(404);
    const mine = await http()
      .get(`/api/estimates?petId=${ids.pet}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(mine.body).toHaveLength(1);
  });
  it('resumen: por responder, cargados del mes y tasa de aceptación, solo de la clínica', async () => {
    await estimate(cookies.reception, {
      petId: ids.pet2,
      title: 'Control dental',
      validDays: 7,
      items: [{ careServiceId: ids.exam, quantity: 1 }],
    }).expect(201);
    const soon = await estimate(cookies.reception, {
      petId: ids.pet2,
      title: 'Profilaxis',
      validDays: 7,
      items: [{ careServiceId: ids.exam, quantity: 2 }],
    }).expect(201);
    await prisma.estimate.update({
      where: { id: soon.body.id },
      data: { validUntil: new Date(`${addDays(today, 2)}T00:00:00Z`) },
    });
    const res = await http()
      .get('/api/estimates/summary')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(res.body).toMatchObject({
      pending: { count: 2 },
      expiringSoon: 1,
      accepted: { count: 0, amount: 0 },
      convertedMonth: { count: 1 },
      acceptance: { won: 1, decided: 2, rate: 50 },
    });
    expect(res.body.pending.amount).toBe(225);
    const other = await http()
      .get('/api/estimates/summary')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(other.body).toMatchObject({
      pending: { count: 0, amount: 0 },
      convertedMonth: { count: 0 },
      acceptance: { decided: 0, rate: null },
    });
  });
});
