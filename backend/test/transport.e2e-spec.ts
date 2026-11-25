import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'GROOMER' | 'CASHIER';

// Movilidad (recojo y entrega) con precio libre en consulta y grooming.
describe('Movilidad (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId = 0;
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const ids = { bath: 0, pet: 0, client: 0, pet2: 0, client2: 0 };

  async function login(role: Role, key: string) {
    const email = `${key}-mov-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        licenseNumber: role === 'VET' ? '12345' : null,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  async function newPet(name: string) {
    const res = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        name: `Dueño de ${name}`,
        phone: '987654321',
        address: 'Av. Lima 123',
        consent: true,
        pet: { name, species: 'DOG' },
      })
      .expect(201);
    return {
      petId: res.body.pets[0].id as number,
      clientId: res.body.id as number,
    };
  }

  const account = async (clientId: number) =>
    (
      await http()
        .get(`/api/clients/${clientId}/account`)
        .set('Cookie', cookies.cashier)
        .expect(200)
    ).body as {
      pending: {
        id: number;
        description: string;
        total: number;
        visitId: number | null;
        transport: boolean;
      }[];
    };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    clinicId = (
      await prisma.clinic.create({ data: { name: 'Clínica e2e movilidad' } })
    ).id;
    await login('ADMIN', 'admin');
    await login('VET', 'vet');
    await login('RECEPTION', 'reception');
    await login('CASHIER', 'cashier');
    ids.bath = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({ name: 'Baño', category: 'GROOMING', price: 40 })
        .expect(201)
    ).body.id;
    const a = await newPet('Rayo');
    ids.pet = a.petId;
    ids.client = a.clientId;
    const b = await newPet('Nube');
    ids.pet2 = b.petId;
    ids.client2 = b.clientId;
  });

  afterAll(async () => {
    if (prisma && clinicId) {
      const where = { clinicId };
      await prisma.appointment.deleteMany({ where });
      await prisma.groomingSession.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
      await prisma.queueEntry.deleteMany({ where });
      await prisma.careService.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.delete({ where: { id: clinicId } });
    }
    await app?.close();
  });

  it('grooming: la movilidad entra a la cuenta del ingreso con el precio de recepción', async () => {
    const tooMuch = await http()
      .post('/api/grooming')
      .set('Cookie', cookies.reception)
      .send({
        petId: ids.pet,
        size: 'SMALL',
        services: [{ careServiceId: ids.bath }],
        transport: 'ROUND_TRIP',
        transportAddress: 'Av. Lima 123',
        transportPrice: 1200,
      })
      .expect(400);
    expect(JSON.stringify(tooMuch.body)).toContain('S/ 500');

    const res = await http()
      .post('/api/grooming')
      .set('Cookie', cookies.reception)
      .send({
        petId: ids.pet,
        size: 'SMALL',
        services: [{ careServiceId: ids.bath }],
        transport: 'ROUND_TRIP',
        transportAddress: 'Av. Lima 123',
        transportPrice: 15,
      })
      .expect(201);
    expect(res.body.transportPrice).toBe(15);
    expect(res.body.total).toBe(55);
    expect(
      res.body.services.map((s: { description: string }) => s.description),
    ).toContain('Movilidad · Recojo y entrega');
    const acc = await account(ids.client);
    const line = acc.pending.find((c) => c.transport)!;
    expect(line).toMatchObject({ total: 15, visitId: res.body.visitId });

    // Último precio para proponerlo la próxima vez
    const last = await http()
      .get(`/api/clients/${ids.client}/transport-price`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(last.body.price).toBe(15);

    // El servicio interno no aparece en el catálogo ni se agrega a mano
    const list = await http()
      .get('/api/care-services')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(list.body.map((s: { name: string }) => s.name)).not.toContain(
      'Movilidad',
    );
    const system = await prisma.careService.findFirstOrThrow({
      where: { clinicId, systemKey: 'TRANSPORT' },
    });
    await http()
      .post('/api/charges')
      .set('Cookie', cookies.reception)
      .send({
        clientId: ids.client,
        items: [{ careServiceId: system.id, quantity: 1 }],
      })
      .expect(404);

    // Caja cambia el precio mientras no se cobra
    await http()
      .patch(`/api/charges/${line.id}/transport-price`)
      .set('Cookie', cookies.cashier)
      .send({ price: 900 })
      .expect(400);
    const changed = await http()
      .patch(`/api/charges/${line.id}/transport-price`)
      .set('Cookie', cookies.cashier)
      .send({ price: 18 })
      .expect(200);
    expect(changed.body).toMatchObject({ total: 18, transport: true });
    const other = (await account(ids.client)).pending.find(
      (c) => !c.transport,
    )!;
    await http()
      .patch(`/api/charges/${other.id}/transport-price`)
      .set('Cookie', cookies.cashier)
      .send({ price: 18 })
      .expect(400);

    // Cancelado después de ir a recogerlo: la movilidad se cobra igual, fuera del grooming
    await http()
      .post(`/api/grooming/${res.body.id}/cancel`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'El dueño desistió', chargeTransport: true })
      .expect(201);
    const after = await account(ids.client);
    expect(after.pending).toHaveLength(1);
    expect(after.pending[0]).toMatchObject({
      transport: true,
      total: 18,
      visitId: null,
    });
  });

  it('consulta: la movilidad de la cola entra a la cuenta y se quita si se cancela', async () => {
    const entry = await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({
        petId: ids.pet2,
        transport: 'PICKUP',
        transportAddress: 'Jr. Las Flores 456',
        transportPrice: 10,
      })
      .expect(201);
    expect(entry.body).toMatchObject({
      transport: 'PICKUP',
      transportPrice: 10,
    });
    let acc = await account(ids.client2);
    expect(acc.pending).toHaveLength(1);
    expect(acc.pending[0]).toMatchObject({
      description: 'Movilidad · Recojo',
      total: 10,
      transport: true,
    });

    // Cambia a recojo y entrega con otro precio: la misma línea
    await http()
      .patch(`/api/queue/${entry.body.id}`)
      .set('Cookie', cookies.reception)
      .send({ transport: 'ROUND_TRIP', transportPrice: 20 })
      .expect(200);
    acc = await account(ids.client2);
    expect(acc.pending).toHaveLength(1);
    expect(acc.pending[0]).toMatchObject({
      description: 'Movilidad · Recojo y entrega',
      total: 20,
    });

    // Cancelada sin marcar "cobrar igual": se quita
    await http()
      .patch(`/api/queue/${entry.body.id}`)
      .set('Cookie', cookies.reception)
      .send({ status: 'CANCELLED' })
      .expect(200);
    expect((await account(ids.client2)).pending).toHaveLength(0);
  });

  it('consulta con entrega: al terminar falta llevarlo a casa hasta marcarlo', async () => {
    const entry = await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({
        petId: ids.pet2,
        transport: 'DROPOFF',
        transportAddress: 'Jr. Las Flores 456',
        transportPrice: 8,
      })
      .expect(201);
    await http()
      .post(`/api/queue/${entry.body.id}/delivered-home`)
      .set('Cookie', cookies.reception)
      .expect(409);

    const visit = await http()
      .post('/api/visits')
      .set('Cookie', cookies.vet)
      .send({ petId: ids.pet2, queueEntryId: entry.body.id })
      .expect(201);
    // La movilidad sigue en la cuenta del cliente (no bloquea cancelar ni cerrar la atención)
    expect((await account(ids.client2)).pending.some((c) => c.transport)).toBe(
      true,
    );
    await http()
      .post(`/api/visits/${visit.body.id}/close`)
      .set('Cookie', cookies.vet)
      .expect(201);

    const queue = await http()
      .get('/api/queue')
      .set('Cookie', cookies.reception)
      .expect(200);
    const item = queue.body.items.find(
      (i: { id: number }) => i.id === entry.body.id,
    );
    expect(item).toMatchObject({ status: 'DONE', homePending: true });

    const done = await http()
      .post(`/api/queue/${entry.body.id}/delivered-home`)
      .set('Cookie', cookies.reception)
      .expect(201);
    expect(done.body.homePending).toBe(false);
    expect(done.body.deliveredHomeBy.fullName).toBe('RECEPTION reception');
  });

  it('lo trajo el dueño y ya no puede volver: se agrega la entrega después', async () => {
    // Grooming sin movilidad
    const g = await http()
      .post('/api/grooming')
      .set('Cookie', cookies.reception)
      .send({
        petId: ids.pet,
        size: 'SMALL',
        services: [{ careServiceId: ids.bath }],
      })
      .expect(201);
    expect(g.body.transportPrice).toBeNull();
    const added = await http()
      .patch(`/api/grooming/${g.body.id}/transport`)
      .set('Cookie', cookies.reception)
      .send({
        transport: 'DROPOFF',
        transportAddress: 'Av. Lima 123',
        transportPrice: 12,
      })
      .expect(200);
    expect(added.body).toMatchObject({
      transport: 'DROPOFF',
      transportPrice: 12,
      total: 52,
    });
    // Otro precio: la misma línea
    const changed = await http()
      .patch(`/api/grooming/${g.body.id}/transport`)
      .set('Cookie', cookies.reception)
      .send({
        transport: 'DROPOFF',
        transportAddress: 'Av. Lima 123',
        transportPrice: 14,
      })
      .expect(200);
    expect(changed.body.services).toHaveLength(2);
    expect(changed.body.total).toBe(54);
    // Sin dirección no
    await http()
      .patch(`/api/grooming/${g.body.id}/transport`)
      .set('Cookie', cookies.reception)
      .send({ transport: 'DROPOFF', transportPrice: 14 })
      .expect(400);
    // Ya no la quiere: se quita
    const removed = await http()
      .patch(`/api/grooming/${g.body.id}/transport`)
      .set('Cookie', cookies.reception)
      .send({ transport: 'NONE' })
      .expect(200);
    expect(removed.body).toMatchObject({
      transport: 'NONE',
      transportPrice: null,
      total: 40,
    });
    await http()
      .post(`/api/grooming/${g.body.id}/cancel`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Fin de la prueba' })
      .expect(201);

    // Consulta ya atendida, esperando al dueño
    const entry = await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({ petId: ids.pet2 })
      .expect(201);
    const visit = await http()
      .post('/api/visits')
      .set('Cookie', cookies.vet)
      .send({ petId: ids.pet2, queueEntryId: entry.body.id })
      .expect(201);
    await http()
      .post(`/api/visits/${visit.body.id}/close`)
      .set('Cookie', cookies.vet)
      .expect(201);
    const before = (await account(ids.client2)).pending.length;
    // Lo demás de una atención cerrada no cambia; la movilidad sí
    await http()
      .patch(`/api/queue/${entry.body.id}`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Otra cosa' })
      .expect(409);
    const moved = await http()
      .patch(`/api/queue/${entry.body.id}`)
      .set('Cookie', cookies.reception)
      .send({
        transport: 'DROPOFF',
        transportAddress: 'Jr. Las Flores 456',
        transportPrice: 9,
      })
      .expect(200);
    expect(moved.body).toMatchObject({ homePending: true, transportPrice: 9 });
    expect((await account(ids.client2)).pending).toHaveLength(before + 1);
  });

  it('cita con movilidad: al llegar pasa a la cola con su cobro', async () => {
    const startsAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const appt = await http()
      .post('/api/appointments')
      .set('Cookie', cookies.reception)
      .send({
        petId: ids.pet,
        startsAt,
        durationMin: 30,
        transport: 'PICKUP',
        transportAddress: 'Av. Lima 123',
        transportPrice: 12,
      })
      .expect(201);
    expect(appt.body.transport).toBe('PICKUP');
    expect(Number(appt.body.transportPrice)).toBe(12);
    const before = (await account(ids.client)).pending.length;
    const arrived = await http()
      .post(`/api/appointments/${appt.body.id}/arrive`)
      .set('Cookie', cookies.reception);
    // Cerca de medianoche la cita puede caer al día siguiente: no es lo que se prueba aquí
    if (arrived.status !== 201) return;
    const entry = await prisma.queueEntry.findUniqueOrThrow({
      where: { id: arrived.body.queueEntryId },
    });
    expect(entry.transport).toBe('PICKUP');
    expect(entry.transportChargeId).not.toBeNull();
    expect((await account(ids.client)).pending).toHaveLength(before + 1);
  });
});
