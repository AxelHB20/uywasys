import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Notificaciones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  const users: Record<string, { id: number; cookie: string }> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());

  async function login(
    role: 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER' | 'GROOMER',
  ) {
    const email = `${role.toLowerCase()}-notif-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} Notif`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    users[role] = {
      id: user.id,
      cookie: String(res.headers['set-cookie']).split(';')[0],
    };
  }

  const feed = async (role: string) =>
    (
      await http()
        .get('/api/notifications')
        .set('Cookie', users[role].cookie)
        .expect(200)
    ).body as {
      events: {
        id: string;
        kind: string;
        urgent: boolean;
        petName: string;
        amount?: number;
      }[];
      alerts: { kind: string }[];
      seenAt: string | null;
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
      await prisma.clinic.create({
        data: { name: 'Clínica e2e notificaciones' },
      })
    ).id;
    for (const r of [
      'ADMIN',
      'VET',
      'RECEPTION',
      'CASHIER',
      'GROOMER',
    ] as const)
      await login(r);
  });

  afterAll(async () => {
    await app.close();
  });

  it('una llegada urgente avisa a los veterinarios, no a quien la registró; cerrar con deuda avisa a caja', async () => {
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
    const pet = client.pets[0];
    // Recepción registra la llegada (vía API, como en la cola)
    await http()
      .post('/api/queue')
      .set('Cookie', users.RECEPTION.cookie)
      .send({ petId: pet.id, reason: 'Vómitos', urgent: true })
      .expect(201);

    const vet = await feed('VET');
    expect(vet.events[0]).toMatchObject({
      kind: 'arrival',
      urgent: true,
      petName: 'Toby',
    });
    expect(vet.alerts.map((a) => a.kind)).toContain('urgent');
    expect(
      (await feed('RECEPTION')).events.find((e) => e.kind === 'arrival'),
    ).toBeUndefined();
    expect((await feed('GROOMER')).events).toEqual([]);

    // El veterinario cierra la atención con un cobro pendiente
    const visit = await prisma.visit.create({
      data: {
        clinicId,
        petId: pet.id,
        clientId: client.id,
        attendedById: users.VET.id,
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: users.VET.id,
      },
    });
    await prisma.charge.create({
      data: {
        clinicId,
        clientId: client.id,
        visitId: visit.id,
        petId: pet.id,
        kind: 'SERVICE',
        description: 'Consulta',
        quantity: 1,
        unitPrice: 60,
        igvAffectation: 'TAXED',
        igvRate: 0.18,
        sunatUnit: 'ZZ',
        taxableAmount: 50.85,
        igvAmount: 9.15,
        total: 60,
        createdById: users.VET.id,
      },
    });
    const cashier = await feed('CASHIER');
    expect(cashier.events[0]).toMatchObject({
      kind: 'readyToCharge',
      petName: 'Toby',
      amount: 60,
    });
    expect(
      (await feed('VET')).events.find((e) => e.kind === 'readyToCharge'),
    ).toBeUndefined();
  });

  it('marcar como leídas guarda la hora en el usuario (vale en cualquier equipo)', async () => {
    expect((await feed('CASHIER')).seenAt).toBeNull();
    const res = await http()
      .post('/api/notifications/seen')
      .set('Cookie', users.CASHIER.cookie)
      .expect(200);
    expect((await feed('CASHIER')).seenAt).toBe(res.body.seenAt);
    await http().get('/api/notifications').expect(401);
  });
});
