import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Clientes, mascotas y cola (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const stamp = Date.now();
  const cookies: Record<string, string> = {};

  const http = () => request(app.getHttpServer());

  async function staff(
    clinicId: number,
    role: 'RECEPTION' | 'GROOMER' | 'VET',
  ) {
    const email = `${role.toLowerCase()}-${clinicId}-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} E2E`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    return String(res.headers['set-cookie']).split(';')[0];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e fase 1', 'Otra clínica e2e']) {
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    }
    cookies.reception = await staff(clinicIds[0], 'RECEPTION');
    cookies.groomer = await staff(clinicIds[0], 'GROOMER');
    cookies.vet = await staff(clinicIds[0], 'VET');
    cookies.other = await staff(clinicIds[1], 'RECEPTION');
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.queueEntry.deleteMany({ where });
      await prisma.authorizedPerson.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  let clientId: number;
  let petId: number;
  const dni = String(stamp).slice(-8);

  it('entrega el texto de consentimiento vigente', async () => {
    const res = await http()
      .get('/api/clients/consent')
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(res.body.version).toBeTruthy();
    expect(res.body.text).toContain('29733');
  });

  it('no registra sin consentimiento y valida DNI y celular', async () => {
    const res = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        docType: 'DNI',
        docNumber: '123',
        name: 'Rosa',
        phone: '812345678',
      })
      .expect(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        'Marca el consentimiento del cliente para tratar sus datos',
        'El DNI debe tener 8 dígitos',
        'El celular debe tener 9 dígitos y empezar con 9',
      ]),
    );
  });

  it('registro rápido: cliente y mascota en una sola llamada', async () => {
    const res = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        docType: 'DNI',
        docNumber: dni,
        name: 'Rosa Peña Quispe',
        phone: '987 654 321',
        consent: true,
        pet: {
          name: 'Tobías',
          species: 'DOG',
          sex: 'MALE',
          birthDate: '2022-05-01',
          birthDateEstimated: true,
          weightKg: 12.5,
          allergies: 'Penicilina',
          aggressive: true,
          aggressiveNote: 'Muerde al cortar uñas',
        },
      })
      .expect(201);
    clientId = res.body.id;
    petId = res.body.pets[0].id;
    expect(res.body.phone).toBe('987654321');
    expect(res.body.consentChannel).toBe('FORM');
    expect(res.body.pets[0]).toMatchObject({
      name: 'Tobías',
      birthDate: '2022-05-01',
      weightKg: 12.5,
      aggressive: true,
    });
  });

  it('avisa si el DNI ya existe (lookup y 409)', async () => {
    const lookup = await http()
      .get(`/api/clients/lookup?docType=DNI&docNumber=${dni}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(lookup.body.client.id).toBe(clientId);

    await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        docType: 'DNI',
        docNumber: dni,
        name: 'Otra Persona',
        phone: '911111111',
        consent: true,
      })
      .expect(409);
  });

  it('permite clientes sin documento', async () => {
    const res = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({ name: 'Juan Sin Documento', phone: '922222222', consent: true })
      .expect(201);
    expect(res.body.docType).toBeNull();
  });

  it('busca sin importar tildes: por apellido, DNI, celular o mascota', async () => {
    for (const q of ['pena', dni, '987654', 'TOBIAS']) {
      const res = await http()
        .get('/api/clients')
        .query({ q })
        .set('Cookie', cookies.groomer)
        .expect(200);
      expect(res.body.items.map((c: { id: number }) => c.id)).toContain(
        clientId,
      );
    }
    const res = await http()
      .get('/api/clients?q=tobias')
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(res.body.items[0].pets[0]).toMatchObject({
      aggressive: true,
      hasAllergies: true,
    });
  });

  it('el groomer consulta pero no registra; otra clínica no ve nada', async () => {
    await http()
      .post('/api/clients')
      .set('Cookie', cookies.groomer)
      .send({ name: 'X', phone: '933333333', consent: true })
      .expect(403);
    await http()
      .get(`/api/clients/${clientId}`)
      .set('Cookie', cookies.other)
      .expect(404);
    await http()
      .get(`/api/pets/${petId}`)
      .set('Cookie', cookies.other)
      .expect(404);
    const list = await http()
      .get('/api/clients')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(list.body.total).toBe(0);
  });

  it('agrega y quita personas autorizadas', async () => {
    const add = await http()
      .post(`/api/clients/${clientId}/authorized`)
      .set('Cookie', cookies.reception)
      .send({ name: 'Carlos Peña', dni: '12345678', relation: 'Hijo' })
      .expect(201);
    const detail = await http()
      .get(`/api/clients/${clientId}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(detail.body.authorized).toHaveLength(1);
    await http()
      .delete(`/api/clients/${clientId}/authorized/${add.body.id}`)
      .set('Cookie', cookies.reception)
      .expect(204);
  });

  it('cola: urgencias primero, sin duplicados, y flujo hasta atendido', async () => {
    const second = await http()
      .post(`/api/clients/${clientId}/pets`)
      .set('Cookie', cookies.reception)
      .send({ name: 'Mishi', species: 'CAT' })
      .expect(201);

    const first = await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({ petId, reason: 'Vacuna' })
      .expect(201);
    await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({ petId })
      .expect(409);
    await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({ petId: second.body.id, urgent: true, reason: 'Vómitos' })
      .expect(201);

    const today = await http()
      .get('/api/queue')
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(
      today.body.items.map((i: { pet: { name: string } }) => i.pet.name),
    ).toEqual(['Mishi', 'Tobías']);
    expect(today.body.items[1].client.name).toBe('Rosa Peña Quispe');

    await http()
      .patch(`/api/queue/${first.body.id}`)
      .set('Cookie', cookies.reception)
      .send({ status: 'DONE' })
      .expect(400);
    const started = await http()
      .patch(`/api/queue/${first.body.id}`)
      .set('Cookie', cookies.vet)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    expect(started.body.attendedBy.fullName).toBe('VET E2E');
    await http()
      .patch(`/api/queue/${first.body.id}`)
      .set('Cookie', cookies.vet)
      .send({ status: 'DONE' })
      .expect(200);

    // Atendido: puede volver a entrar a la cola el mismo día
    await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({ petId })
      .expect(201);
  });

  it('dashboard y última visita reflejan la cola del día', async () => {
    const dash = await http()
      .get('/api/dashboard')
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(dash.body.queue).toMatchObject({ done: 1, urgent: 1, arrived: 2 });
    expect(dash.body.queue.items[0].pet.name).toBe('Mishi');
    expect(dash.body.clients).toMatchObject({ active: 2, newThisMonth: 2 });
    expect(dash.body.recentClients).toHaveLength(2);

    const list = await http()
      .get('/api/clients?q=tobias')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(list.body.items[0].lastVisit).toBe(dash.body.day);
    const detail = await http()
      .get(`/api/clients/${clientId}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    const toby = detail.body.pets.find((p: { id: number }) => p.id === petId);
    expect(toby.lastVisit).toBe(dash.body.day);
  });

  it('una mascota fallecida queda inactiva y no entra a la cola', async () => {
    const pet = await http()
      .post(`/api/clients/${clientId}/pets`)
      .set('Cookie', cookies.reception)
      .send({ name: 'Rocky', species: 'DOG' })
      .expect(201);
    const updated = await http()
      .patch(`/api/pets/${pet.body.id}`)
      .set('Cookie', cookies.reception)
      .send({ deceasedAt: '2026-01-10' })
      .expect(200);
    expect(updated.body.active).toBe(false);
    await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({ petId: pet.body.id })
      .expect(400);
  });
});
