import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Historia clínica: solo veterinario, recepción y administrador (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  let petId: number;
  let consultation: number;
  let grooming: number;
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());

  async function login(role: 'VET' | 'CASHIER' | 'GROOMER' | 'RECEPTION') {
    const email = `${role.toLowerCase()}-hc-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} HC`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[role] = String(res.headers['set-cookie']).split(';')[0];
    return user.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    clinicId = (await prisma.clinic.create({ data: { name: 'Clínica HC' } }))
      .id;
    const vetId = await login('VET');
    await login('CASHIER');
    await login('GROOMER');
    await login('RECEPTION');
    const client = await prisma.client.create({
      data: {
        clinicId,
        number: 1,
        name: 'Luis Rojas',
        phone: '987000222',
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: 'luis rojas',
        pets: {
          create: {
            clinicId,
            number: 1,
            name: 'Bruno',
            nameSearch: 'bruno',
            species: 'DOG',
          },
        },
      },
      include: { pets: true },
    });
    petId = client.pets[0].id;
    const base = { clinicId, petId, clientId: client.id, attendedById: vetId };
    consultation = (
      await prisma.visit.create({ data: { ...base, diagnosis: 'Otitis' } })
    ).id;
    grooming = (
      await prisma.visit.create({ data: { ...base, type: 'GROOMING' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (role: string, url: string) =>
    http().get(url).set('Cookie', cookies[role]);

  it('caja no abre atenciones ni su historial; cobra desde la cuenta del cliente', async () => {
    await get('CASHIER', `/api/visits/${consultation}`).expect(403);
    await get('CASHIER', `/api/visits?petId=${petId}`).expect(403);
    await get('CASHIER', `/api/pets/${petId}/consents`).expect(403);
    await get('CASHIER', `/api/pets/${petId}/attachments`).expect(403);
  });

  it('el groomer solo ve las atenciones de grooming', async () => {
    await get('GROOMER', `/api/visits/${grooming}`).expect(200);
    await get('GROOMER', `/api/visits/${consultation}`).expect(404);
    const list = await get('GROOMER', `/api/visits?petId=${petId}`).expect(200);
    expect(list.body.items.map((v: { id: number }) => v.id)).toEqual([
      grooming,
    ]);
  });

  it('veterinario y recepción ven la historia completa', async () => {
    for (const role of ['VET', 'RECEPTION']) {
      const visit = await get(role, `/api/visits/${consultation}`).expect(200);
      expect(visit.body.diagnosis).toBe('Otitis');
      const list = await get(role, `/api/visits?petId=${petId}`).expect(200);
      expect(list.body.total).toBe(2);
    }
  });
});
