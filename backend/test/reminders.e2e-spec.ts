import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import webpush from 'web-push';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  clinicDay,
  startOfDayIn,
  toDbDate,
} from '../src/common/time/clinic-day.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RemindersService } from '../src/reminders/reminders.service.js';

const DAY = 86_400_000;
const TZ = 'America/Lima';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Recordatorios: WhatsApp marcado y avisos al celular (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let reminders: RemindersService;
  let clinicId: number;
  let clientId: number;
  let immunizationId: number;
  let appointmentId: number;
  let cookie: string;
  let token: string;
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const today = clinicDay(TZ);
  /** Hoy a las 15:00 de Lima: dentro del horario de avisos */
  const afternoon = new Date(
    startOfDayIn(TZ, today).getTime() + 15 * 3_600_000,
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    reminders = app.get(RemindersService);
    clinicId = (
      await prisma.clinic.create({ data: { name: 'Clínica avisos' } })
    ).id;
    const email = `recep-avisos-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: 'Carmen Recepción',
        email,
        role: 'RECEPTION',
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookie = String(res.headers['set-cookie']).split(';')[0];
    const client = await prisma.client.create({
      data: {
        clinicId,
        number: 1,
        name: 'Ana Ruiz',
        phone: '987111222',
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: 'ana ruiz',
        pets: {
          create: {
            clinicId,
            number: 1,
            name: 'Lola',
            nameSearch: 'lola',
            species: 'DOG',
          },
        },
      },
      include: { pets: true },
    });
    clientId = client.id;
    const petId = client.pets[0].id;
    immunizationId = (
      await prisma.immunization.create({
        data: {
          clinicId,
          petId,
          kind: 'VACCINE',
          name: 'Antirrábica',
          appliedAt: toDbDate('2025-12-01'),
          nextDueAt: new Date(toDbDate(today).getTime() + 2 * DAY),
          appliedById: user.id,
        },
      })
    ).id;
    appointmentId = (
      await prisma.appointment.create({
        data: {
          clinicId,
          petId,
          clientId,
          startsAt: new Date(afternoon.getTime() + DAY - 4 * 3_600_000),
          reason: 'Control',
          createdById: user.id,
        },
      })
    ).id;
    token = (
      await http()
        .post(`/api/clients/${clientId}/portal`)
        .set('Cookie', cookie)
        .expect(201)
    ).body.token;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('recepción ve las citas de mañana y marca a quién ya avisó por WhatsApp', async () => {
    const list = await http()
      .get('/api/reminders/appointments')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: appointmentId,
      pet: { name: 'Lola' },
      client: { phone: '987111222' },
      reminded: [],
      autoNotice: false,
    });
    const marked = await http()
      .post('/api/reminders/sent')
      .set('Cookie', cookie)
      .send({ kind: 'APPOINTMENT', targetId: appointmentId })
      .expect(200);
    expect(marked.body[0]).toMatchObject({
      channel: 'WHATSAPP',
      by: 'Carmen Recepción',
    });
    // La agenda muestra la cita ya avisada
    const tomorrowDay = clinicDay(TZ, new Date(afternoon.getTime() + DAY));
    const agenda = await http()
      .get(`/api/appointments?from=${tomorrowDay}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(agenda.body[0].reminded[0]).toMatchObject({ channel: 'WHATSAPP' });
    // Una vacuna de otra clínica no se puede marcar
    await http()
      .post('/api/reminders/sent')
      .set('Cookie', cookie)
      .send({ kind: 'VACCINE', targetId: 999_999 })
      .expect(404);
  });

  it('el dueño activa los avisos y le llegan una sola vez, solo en horario', async () => {
    const key = await http().get('/api/portal/avisos/clave').expect(200);
    expect(key.body.publicKey.length).toBeGreaterThan(40);
    await http()
      .post(`/api/portal/${token}/avisos`)
      .send({
        endpoint: `https://push.example.com/send/${stamp}`,
        keys: { p256dh: 'BPk-clave-publica', auth: 'auth-secreto' },
      })
      .expect(204);
    await http()
      .post('/api/portal/token-inventado-1234567890/avisos')
      .send({
        endpoint: 'https://push.example.com/x',
        keys: { p256dh: 'a', auth: 'b' },
      })
      .expect(404);

    const due = await http()
      .get('/api/immunizations/due?status=upcoming&days=7')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      due.body.find((d: { id: number }) => d.id === immunizationId),
    ).toMatchObject({ autoNotice: true, reminded: [] });

    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    // De madrugada no sale nada
    const night = new Date(afternoon.getTime() - 12 * 3_600_000);
    expect(await reminders.sendDue(night)).toBe(0);
    expect(send).not.toHaveBeenCalled();

    expect(await reminders.sendDue(afternoon)).toBe(2);
    const payloads = send.mock.calls.map((c) => JSON.parse(String(c[1])));
    expect(payloads.map((p) => p.title)).toEqual([
      'Lola: le toca Antirrábica',
      'Mañana: cita de Lola',
    ]);
    // No se repite
    expect(await reminders.sendDue(afternoon)).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);

    // Si el navegador ya no la acepta (desinstaló), se borra la suscripción
    await prisma.reminderLog.deleteMany({
      where: { clinicId, channel: 'PUSH' },
    });
    send.mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    );
    expect(await reminders.sendDue(afternoon)).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { clientId } })).toBe(
      0,
    );
  });
});
