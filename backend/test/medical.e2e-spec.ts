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
describe('Consulta SOAP y carnet de vacunas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());
  const ids = { pet: 0, pet2: 0, visit: 0, vaccine: 0 };

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-medical-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        licenseNumber: role === 'VET' ? 'CMVP-1234' : null,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  const vaccinate = (cookie: string, body: Record<string, unknown>) =>
    http().post('/api/immunizations').set('Cookie', cookie).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e médica', 'Otra clínica médica'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet');
    await login(mine, 'GROOMER', 'groomer');
    await login(mine, 'RECEPTION', 'reception');
    await login(other, 'ADMIN', 'other');

    for (const [name, key] of [
      ['Toby', 'pet'],
      ['Luna', 'pet2'],
    ] as const) {
      const client = await http()
        .post('/api/clients')
        .set('Cookie', cookies.admin)
        .send({
          name: `Dueño de ${name}`,
          phone: '987654321',
          consent: true,
          pet: { name, species: 'DOG', weightKg: 10 },
        })
        .expect(201);
      ids[key] = client.body.pets[0].id;
    }
    ids.visit = (
      await http()
        .post('/api/visits')
        .set('Cookie', cookies.vet)
        .send({ petId: ids.pet, reason: 'Vacuna y control' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.immunization.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('guarda la consulta SOAP y el diagnóstico se ve en el historial', async () => {
    const res = await http()
      .patch(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .send({
        anamnesis: 'Come bien, un vómito ayer',
        weightKg: 10.4,
        temperatureC: 38.6,
        heartRate: 110,
        respiratoryRate: 24,
        capillaryRefillS: 1.5,
        mucosa: 'Rosadas',
        hydration: 'Normal',
        bodyCondition: 5,
        physicalExam: 'Sin hallazgos',
        diagnosis: 'Gastritis leve',
        notes: 'Dieta blanda 3 días',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      anamnesis: 'Come bien, un vómito ayer',
      heartRate: 110,
      capillaryRefillS: 1.5,
      bodyCondition: 5,
      diagnosis: 'Gastritis leve',
      diagnosisDefinitive: false,
    });

    await http()
      .patch(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .send({ bodyCondition: 12, heartRate: 2 })
      .expect(400);

    const list = await http()
      .get(`/api/visits?petId=${ids.pet}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(list.body.items[0].diagnosis).toBe('Gastritis leve');
  });

  it('registra la vacuna en la atención abierta con la fecha de hoy y su refuerzo', async () => {
    await vaccinate(cookies.groomer, {
      petId: ids.pet,
      visitId: ids.visit,
      kind: 'VACCINE',
      name: 'Séxtuple',
    }).expect(403);
    // Recepción no firma una vacuna aplicada aquí (el carnet lleva el CMVP de quien la aplicó)
    await vaccinate(cookies.reception, {
      petId: ids.pet,
      visitId: ids.visit,
      kind: 'VACCINE',
      name: 'Séxtuple',
    }).expect(403);
    await vaccinate(cookies.reception, {
      petId: ids.pet,
      kind: 'VACCINE',
      name: 'Séxtuple',
      appliedAt: addDays(today, -30),
      external: false,
    }).expect(403);
    await vaccinate(cookies.vet, {
      petId: ids.pet2,
      visitId: ids.visit,
      kind: 'VACCINE',
      name: 'Séxtuple',
    }).expect(400);
    await vaccinate(cookies.vet, {
      petId: ids.pet,
      visitId: ids.visit,
      kind: 'VACCINE',
      name: 'Séxtuple',
      nextDueAt: today,
    }).expect(400);

    const res = await vaccinate(cookies.vet, {
      petId: ids.pet,
      visitId: ids.visit,
      kind: 'VACCINE',
      name: 'Séxtuple',
      laboratory: 'Zoetis',
      batchNumber: 'L-2026',
      appliedAt: '2020-01-01',
      nextDueAt: addDays(today, 21),
    }).expect(201);
    ids.vaccine = res.body.id;
    // En una atención la fecha es la de hoy, aunque se envíe otra
    expect(res.body).toMatchObject({
      appliedAt: today,
      nextDueAt: addDays(today, 21),
      external: false,
      appliedBy: { licenseNumber: 'CMVP-1234' },
    });

    const visit = await http()
      .get(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(visit.body.immunizations).toHaveLength(1);
  });

  it('registra antecedentes de otra clínica, sin fechas futuras', async () => {
    await vaccinate(cookies.admin, {
      petId: ids.pet,
      kind: 'VACCINE',
      name: 'Antirrábica',
    }).expect(400);
    await vaccinate(cookies.admin, {
      petId: ids.pet,
      kind: 'VACCINE',
      name: 'Antirrábica',
      appliedAt: addDays(today, 1),
    }).expect(400);
    const res = await vaccinate(cookies.admin, {
      petId: ids.pet,
      kind: 'VACCINE',
      name: 'Antirrábica',
      appliedAt: addDays(today, -400),
      nextDueAt: addDays(today, -35),
      externalClinic: 'Vet San Borja',
    }).expect(201);
    expect(res.body).toMatchObject({
      external: true,
      externalClinic: 'Vet San Borja',
    });
    // Recepción sí registra antecedentes de otra clínica
    await vaccinate(cookies.reception, {
      petId: ids.pet2,
      kind: 'VACCINE',
      name: 'Triple felina',
      appliedAt: addDays(today, -500),
      externalClinic: 'Vet Surco',
    }).expect(201);
    await vaccinate(cookies.admin, {
      petId: ids.pet2,
      kind: 'DEWORMING_INTERNAL',
      name: 'Drontal Plus',
      appliedAt: addDays(today, -80),
      nextDueAt: addDays(today, 10),
    }).expect(201);
  });

  it('lista refuerzos próximos y vencidos; una nueva aplicación reemplaza a la anterior', async () => {
    const upcoming = await http()
      .get('/api/immunizations/due?status=upcoming&days=30')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(upcoming.body.map((d: { name: string }) => d.name).sort()).toEqual([
      'Drontal Plus',
      'Séxtuple',
    ]);
    expect(
      upcoming.body.find((d: { name: string }) => d.name === 'Séxtuple'),
    ).toMatchObject({ daysLeft: 21, pet: { name: 'Toby' } });

    const overdue = await http()
      .get('/api/immunizations/due?status=overdue')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(overdue.body).toHaveLength(1);
    expect(overdue.body[0]).toMatchObject({
      name: 'Antirrábica',
      daysLeft: -35,
    });

    // Se aplica la antirrábica hoy (mismo nombre, otra mayúscula): sale de vencidos
    await vaccinate(cookies.vet, {
      petId: ids.pet,
      visitId: ids.visit,
      kind: 'VACCINE',
      name: 'antirrábica',
      nextDueAt: addDays(today, 365),
    }).expect(201);
    const after = await http()
      .get('/api/immunizations/due?status=overdue')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(after.body).toHaveLength(0);

    // Otra clínica no ve nada
    const other = await http()
      .get('/api/immunizations/due?status=upcoming')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(other.body).toHaveLength(0);
    await http()
      .get(`/api/pets/${ids.pet}/immunizations`)
      .set('Cookie', cookies.other)
      .expect(404);
  });

  it('una aplicación por error se anula con motivo y deja de contar', async () => {
    await http()
      .post(`/api/immunizations/${ids.vaccine}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'x' })
      .expect(400);
    const res = await http()
      .post(`/api/immunizations/${ids.vaccine}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'Se registró en la mascota equivocada' })
      .expect(201);
    expect(res.body.voidReason).toBe('Se registró en la mascota equivocada');
    await http()
      .post(`/api/immunizations/${ids.vaccine}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'Otra vez' })
      .expect(409);

    const upcoming = await http()
      .get('/api/immunizations/due?status=upcoming&days=30')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(upcoming.body.map((d: { name: string }) => d.name)).toEqual([
      'Drontal Plus',
    ]);
    const card = await http()
      .get(`/api/pets/${ids.pet}/immunizations`)
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(card.body).toHaveLength(3);

    const printable = await http()
      .get(`/api/pets/${ids.pet}/immunization-card`)
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(printable.body.clinic.name).toBe('Clínica e2e médica');
    expect(printable.body.pet).toMatchObject({
      name: 'Toby',
      client: { name: 'Dueño de Toby' },
    });
    // Solo las vigentes, de la más antigua a la más reciente
    expect(printable.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Antirrábica',
      'antirrábica',
    ]);
    // Sin citas: la historia no muestra "Próxima cita"; con una, la primera que sigue en pie
    expect(printable.body.nextAppointment).toBeNull();
    const startsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const owner = await prisma.pet.findUniqueOrThrow({
      where: { id: ids.pet },
      select: { clinicId: true, clientId: true },
    });
    const staff = await prisma.user.findFirstOrThrow({
      where: { clinicId: owner.clinicId },
    });
    const appt = await prisma.appointment.create({
      data: {
        clinicId: owner.clinicId,
        petId: ids.pet,
        clientId: owner.clientId,
        createdById: staff.id,
        startsAt: new Date(startsAt),
        durationMin: 30,
        type: 'CONSULTATION',
        reason: 'Control',
      },
    });
    const withNext = await http()
      .get(`/api/pets/${ids.pet}/immunization-card`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(withNext.body.nextAppointment).toMatchObject({
      reason: 'Control',
      startsAt,
    });
    await prisma.appointment.delete({ where: { id: appt.id } });
    await http()
      .get(`/api/pets/${ids.pet}/immunization-card`)
      .set('Cookie', cookies.other)
      .expect(404);
  });

  it('cerrada la atención, ya no se aplica nada en ella', async () => {
    await http()
      .post(`/api/visits/${ids.visit}/close`)
      .set('Cookie', cookies.vet)
      .expect(201);
    await vaccinate(cookies.vet, {
      petId: ids.pet,
      visitId: ids.visit,
      kind: 'VACCINE',
      name: 'Séxtuple',
    }).expect(409);
    await http()
      .patch(`/api/visits/${ids.visit}`)
      .set('Cookie', cookies.vet)
      .send({ diagnosis: 'Otro' })
      .expect(409);
  });
});
