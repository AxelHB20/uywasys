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

/** AAAA-MM-DD + HH:MM en hora de Lima (UTC-5) como ISO */
const lima = (day: string, time: string) =>
  new Date(`${day}T${time}:00-05:00`).toISOString();

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Agenda de citas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const users: Record<string, number> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const tomorrow = addDays(today, 1);
  const http = () => request(app.getHttpServer());
  const ids = { toby: 0, luna: 0, first: 0, now: 0 };

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-agenda-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    users[key] = user.id;
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  const book = (cookie: string, body: Record<string, unknown>) =>
    http().post('/api/appointments').set('Cookie', cookie).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e agenda', 'Otra clínica agenda'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'CASHIER', 'cashier');
    await login(other, 'ADMIN', 'other');

    for (const [name, key] of [
      ['Toby', 'toby'],
      ['Luna', 'luna'],
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
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.appointment.deleteMany({ where });
      await prisma.queueEntry.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('solo veterinarios (y groomers) aparecen para asignar citas', async () => {
    const res = await http()
      .get('/api/appointments/staff')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(res.body.map((s: { id: number }) => s.id)).toEqual([users.vet]);
  });

  it('agenda una cita y evita los cruces', async () => {
    await book(cookies.cashier, {
      petId: ids.toby,
      startsAt: lima(tomorrow, '10:00'),
      durationMin: 30,
    }).expect(403);
    await book(cookies.reception, {
      petId: ids.toby,
      vetId: users.cashier,
      startsAt: lima(tomorrow, '10:00'),
      durationMin: 30,
    }).expect(400);
    await book(cookies.reception, {
      petId: ids.toby,
      startsAt: lima(addDays(today, -1), '10:00'),
      durationMin: 30,
    }).expect(400);

    const res = await book(cookies.reception, {
      petId: ids.toby,
      vetId: users.vet,
      startsAt: lima(tomorrow, '10:00'),
      durationMin: 30,
      reason: 'Refuerzo de séxtuple',
    }).expect(201);
    ids.first = res.body.id;
    expect(res.body).toMatchObject({
      status: 'SCHEDULED',
      pet: { name: 'Toby' },
      vet: { id: users.vet },
    });

    // Mismo veterinario 10:15: avisa el cruce; con sobrecupo, sí
    const clash = await book(cookies.reception, {
      petId: ids.luna,
      vetId: users.vet,
      startsAt: lima(tomorrow, '10:15'),
      durationMin: 30,
    }).expect(409);
    expect(clash.body.message).toContain('ya tiene una cita a las 10:00');
    expect(clash.body.details).toMatchObject({ code: 'OVERLAP' });
    await book(cookies.reception, {
      petId: ids.luna,
      vetId: users.vet,
      startsAt: lima(tomorrow, '10:15'),
      durationMin: 30,
      allowOverlap: true,
    }).expect(201);
    // A las 10:30 ya no se cruza
    await book(cookies.reception, {
      petId: ids.luna,
      vetId: users.vet,
      startsAt: lima(tomorrow, '11:00'),
      durationMin: 15,
    }).expect(201);
    // La misma mascota no puede estar en dos citas a la vez, ni con sobrecupo
    await book(cookies.reception, {
      petId: ids.toby,
      startsAt: lima(tomorrow, '10:20'),
      durationMin: 15,
      allowOverlap: true,
    }).expect(409);
  });

  it('lista el día en hora de la clínica, sin mezclar clínicas', async () => {
    const res = await http()
      .get(`/api/appointments?from=${tomorrow}`)
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].startsAt).toBe(lima(tomorrow, '10:00'));
    const other = await http()
      .get(`/api/appointments?from=${tomorrow}`)
      .set('Cookie', cookies.other)
      .expect(200);
    expect(other.body).toHaveLength(0);
    await http()
      .get(`/api/appointments?from=${tomorrow}&to=${today}`)
      .set('Cookie', cookies.admin)
      .expect(400);
  });

  it('confirma, reprograma (vuelve a por confirmar) y cancela con motivo', async () => {
    const confirmed = await http()
      .post(`/api/appointments/${ids.first}/confirm`)
      .set('Cookie', cookies.reception)
      .expect(201);
    expect(confirmed.body.status).toBe('CONFIRMED');
    const moved = await http()
      .patch(`/api/appointments/${ids.first}`)
      .set('Cookie', cookies.reception)
      .send({ startsAt: lima(tomorrow, '15:00') })
      .expect(200);
    expect(moved.body.status).toBe('SCHEDULED');
    // Llegó: no se puede, la cita es de mañana
    await http()
      .post(`/api/appointments/${ids.first}/arrive`)
      .set('Cookie', cookies.reception)
      .expect(400);
    // No vino: tampoco, aún no es la hora
    await http()
      .post(`/api/appointments/${ids.first}/no-show`)
      .set('Cookie', cookies.reception)
      .expect(400);
    await http()
      .post(`/api/appointments/${ids.first}/cancel`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'El dueño viaja' })
      .expect(201);
    await http()
      .patch(`/api/appointments/${ids.first}`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Otro' })
      .expect(409);
  });

  it('"Llegó" pone al paciente en la cola de hoy', async () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const res = await book(cookies.vet, {
      petId: ids.toby,
      startsAt: soon,
      durationMin: 20,
      reason: 'Control',
    }).expect(201);
    // Si la cita cae en el día de hoy de la clínica (casi siempre), entra a la cola
    if (clinicDay('America/Lima', new Date(soon)) !== today) return;
    const arrived = await http()
      .post(`/api/appointments/${res.body.id}/arrive`)
      .set('Cookie', cookies.reception)
      .expect(201);
    expect(arrived.body.status).toBe('ARRIVED');
    const queue = await http()
      .get('/api/queue')
      .set('Cookie', cookies.reception)
      .expect(200);
    const entry = queue.body.items.find(
      (i: { id: number }) => i.id === arrived.body.queueEntryId,
    );
    expect(entry).toMatchObject({ reason: 'Control', pet: { name: 'Toby' } });
    await http()
      .post(`/api/appointments/${res.body.id}/arrive`)
      .set('Cookie', cookies.reception)
      .expect(409);
  });
});
