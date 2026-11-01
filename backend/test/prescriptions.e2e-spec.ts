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

type Role = 'ADMIN' | 'VET' | 'RECEPTION';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Recetas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());
  const ids = {
    pet: 0,
    visit: 0,
    meloxicam: 0,
    meloxicamBox: 0,
    ketamine: 0,
    ketamineVial: 0,
    rx: 0,
  };

  async function login(
    clinicId: number,
    role: Role,
    key: string,
    licenseNumber: string | null = null,
  ) {
    const email = `${key}-rx-${stamp}@uywa.pe`;
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
        quantity: 3,
        lotNumber: `L-${created.id}`,
        expiresAt: addDays(today, 200),
      })
      .expect(201);
    return created;
  }

  const prescribe = (cookie: string, body: Record<string, unknown>) =>
    http()
      .post(`/api/visits/${ids.visit}/prescriptions`)
      .set('Cookie', cookie)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e recetas', 'Otra clínica recetas'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet', 'CMVP-4321');
    await login(mine, 'VET', 'novet');
    await login(mine, 'RECEPTION', 'reception');
    await login(other, 'ADMIN', 'other', 'CMVP-1');

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
    ids.pet = client.body.pets[0].id;
    ids.visit = (
      await http()
        .post('/api/visits')
        .set('Cookie', cookies.vet)
        .send({ petId: ids.pet })
        .expect(201)
    ).body.id;

    const meloxicam = await product({
      name: 'Meloxicam 1 mg',
      category: 'MEDICINE',
      baseUnit: 'UNIT',
      presentations: [{ name: 'Caja x 10 tabletas', factor: 10, price: 20 }],
    });
    ids.meloxicam = meloxicam.id;
    ids.meloxicamBox = meloxicam.presentations[0].id;
    const ketamine = await product({
      name: 'Ketamina 50 mg/ml',
      category: 'MEDICINE',
      baseUnit: 'ML',
      controlled: true,
      presentations: [{ name: 'Frasco x 10 ml', factor: 10, price: 90 }],
    });
    ids.ketamine = ketamine.id;
    ids.ketamineVial = ketamine.presentations[0].id;
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.prescriptionItem.deleteMany({
        where: { prescription: where },
      });
      await prisma.prescription.deleteMany({ where });
      await prisma.stockShortage.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
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

  const item = {
    drug: 'Meloxicam 1 mg',
    dose: '1 tableta',
    route: 'Oral',
    frequency: 'Cada 24 horas',
    duration: '5 días',
  };

  it('solo un veterinario con colegiatura emite recetas', async () => {
    await prescribe(cookies.reception, { items: [item] }).expect(403);
    const res = await prescribe(cookies.novet, { items: [item] }).expect(403);
    expect(res.body.message).toContain('colegiatura');
    await prescribe(cookies.vet, { items: [] }).expect(400);
    await prescribe(cookies.vet, {
      items: [{ ...item, frequency: '' }],
    }).expect(400);
    // Para entregar en la clínica tiene que salir del inventario
    await prescribe(cookies.vet, {
      items: [{ ...item, dispenseQuantity: 1 }],
    }).expect(400);
  });

  it('emite la receta numerada y carga lo que se entrega, con el controlado como receta retenida', async () => {
    const res = await prescribe(cookies.vet, {
      notes: 'Dieta blanda y control en 1 semana',
      items: [
        {
          ...item,
          productId: ids.meloxicam,
          presentationId: ids.meloxicamBox,
          dispenseQuantity: 1,
        },
        {
          drug: 'Ketamina 50 mg/ml',
          productId: ids.ketamine,
          presentationId: ids.ketamineVial,
          dose: '0.5 ml',
          route: 'Intramuscular',
          frequency: 'Dosis única',
          duration: '1 día',
          dispenseQuantity: 1,
        },
        {
          drug: 'Omeprazol 20 mg',
          dose: '1/2 cápsula',
          frequency: 'Cada 24 horas en ayunas',
          duration: '7 días',
          instructions: 'Comprar en farmacia',
        },
      ],
    }).expect(201);
    ids.rx = res.body.id;
    expect(res.body).toMatchObject({
      code: 'RX-00001',
      vet: { licenseNumber: 'CMVP-4321' },
      pet: { name: 'Toby' },
      client: { name: 'Rosa Quispe' },
      clinic: { name: 'Clínica e2e recetas' },
    });
    expect(
      res.body.items.map((i: { controlled: boolean }) => i.controlled),
    ).toEqual([false, true, false]);
    expect(res.body.items[0]).toMatchObject({
      dispensedQuantity: 1,
      presentation: 'Caja x 10 tabletas',
      charge: { status: 'PENDING' },
    });
    expect(res.body.items[2].charge).toBeNull();

    const visit = await http()
      .get(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(visit.body.prescriptions).toHaveLength(1);
    expect(visit.body.charges).toHaveLength(2);
    expect(
      visit.body.charges.map(
        (c: { prescriptionRef: string }) => c.prescriptionRef,
      ),
    ).toEqual(['RX-00001', 'RX-00001']);
    expect(visit.body.total).toBe(110);
  });

  it('si no hay stock suficiente no queda ni la receta ni los cargos', async () => {
    const before = await prisma.prescription.count({
      where: { clinicId: clinicIds[0] },
    });
    await prescribe(cookies.vet, {
      items: [
        {
          ...item,
          productId: ids.meloxicam,
          presentationId: 999999,
          dispenseQuantity: 1,
        },
      ],
    }).expect(400);
    expect(
      await prisma.prescription.count({ where: { clinicId: clinicIds[0] } }),
    ).toBe(before);
    // Productos de otra clínica no se pueden recetar desde aquí
    await http()
      .post(`/api/visits/${ids.visit}/prescriptions`)
      .set('Cookie', cookies.other)
      .send({ items: [item] })
      .expect(404);
  });

  it('se ve e imprime desde cualquier rol de la clínica, no desde otra', async () => {
    const res = await http()
      .get(`/api/prescriptions/${ids.rx}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(res.body.notes).toBe('Dieta blanda y control en 1 semana');
    await http()
      .get(`/api/prescriptions/${ids.rx}`)
      .set('Cookie', cookies.other)
      .expect(404);
  });

  it('para anular hay que quitar antes lo entregado', async () => {
    await http()
      .post(`/api/prescriptions/${ids.rx}/void`)
      .set('Cookie', cookies.novet)
      .send({ reason: 'No es mía' })
      .expect(403);
    const blocked = await http()
      .post(`/api/prescriptions/${ids.rx}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'Dosis equivocada' })
      .expect(409);
    expect(blocked.body.message).toContain('Primero quita');

    const visit = await http()
      .get(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    for (const charge of visit.body.charges)
      await http()
        .post(`/api/charges/${charge.id}/void`)
        .set('Cookie', cookies.vet)
        .send({ reason: 'Receta con dosis equivocada' })
        .expect(201);

    const res = await http()
      .post(`/api/prescriptions/${ids.rx}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'Dosis equivocada' })
      .expect(201);
    expect(res.body.voidReason).toBe('Dosis equivocada');
    await http()
      .post(`/api/prescriptions/${ids.rx}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Otra vez' })
      .expect(409);
  });

  it('cerrada la atención ya no se emiten recetas', async () => {
    await http()
      .post(`/api/visits/${ids.visit}/close`)
      .set('Cookie', cookies.vet)
      .expect(201);
    await prescribe(cookies.vet, { items: [item] }).expect(409);
  });
});
