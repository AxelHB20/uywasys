import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Historias clínicas: lista de pacientes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  let vetId: number;
  const stamp = Date.now();
  const cookies: Record<string, string> = {};
  const pets: Record<string, number> = {};
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const get = (role: string, url: string) =>
    request(app.getHttpServer()).get(url).set('Cookie', cookies[role]);
  const names = (body: { items: { name: string }[] }) =>
    body.items.map((p) => p.name);

  async function login(role: 'VET' | 'RECEPTION' | 'CASHIER' | 'GROOMER') {
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
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[role] = String(res.headers['set-cookie']).split(';')[0];
    return user.id;
  }

  async function owner(
    number: number,
    name: string,
    doc: string,
    phone: string,
  ) {
    return prisma.client.create({
      data: {
        clinicId,
        number,
        name,
        phone,
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: `${name.toLowerCase()} ${doc} ${phone}`,
      },
    });
  }

  async function pet(
    key: string,
    clientId: number,
    number: number,
    species: 'DOG' | 'CAT' | 'RABBIT',
    extra: object = {},
  ) {
    pets[key] = (
      await prisma.pet.create({
        data: {
          clinicId,
          clientId,
          number,
          name: key,
          nameSearch: key.toLowerCase(),
          species,
          ...extra,
        },
      })
    ).id;
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
    vetId = await login('VET');
    await login('RECEPTION');
    await login('CASHIER');
    await login('GROOMER');

    const ana = await owner(1, 'Ana Quispe', '45678912', '987111222');
    const beto = await owner(2, 'Beto Ramos', '40000001', '956333444');
    await pet('Firulais', ana.id, 26, 'DOG', {
      allergies: 'Penicilina',
      aggressive: true,
    });
    await pet('Michi', ana.id, 41, 'CAT');
    await pet('Copito', beto.id, 52, 'RABBIT');
    await pet('Rocky', beto.id, 12, 'DOG', {
      deceasedAt: new Date('2026-09-01'),
    });
    await pet('Baja', beto.id, 7, 'DOG', { active: false });
    await pet('Nuevo', beto.id, 60, 'DOG');

    const visit = (petId: number, clientId: number, data: object) =>
      prisma.visit.create({
        data: { clinicId, petId, clientId, attendedById: vetId, ...data },
      });
    // Firulais: atendido hace 2 días (cerrada) y ahora internado
    await visit(pets.Firulais, ana.id, {
      status: 'CLOSED',
      openedAt: daysAgo(2),
      diagnosis: 'Esguince',
    });
    await visit(pets.Firulais, ana.id, {
      type: 'HOSPITALIZATION',
      openedAt: daysAgo(1),
      diagnosis: 'Gastroenteritis',
    });
    // Michi: atendido hace 10 días; una anulada y un grooming más nuevos no cuentan
    await visit(pets.Michi, ana.id, {
      status: 'CLOSED',
      openedAt: daysAgo(10),
      diagnosis: 'Otitis externa',
    });
    await visit(pets.Michi, ana.id, {
      status: 'CANCELLED',
      openedAt: daysAgo(1),
    });
    await visit(pets.Michi, ana.id, {
      type: 'GROOMING',
      status: 'CLOSED',
      openedAt: daysAgo(1),
    });
    // Copito: vacuna con el refuerzo vencido
    await prisma.immunization.create({
      data: {
        clinicId,
        petId: pets.Copito,
        kind: 'VACCINE',
        name: 'Mixomatosis',
        appliedAt: daysAgo(400),
        nextDueAt: daysAgo(30),
        appliedById: vetId,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('solo veterinario, recepción y administrador ven las historias', async () => {
    await get('VET', '/api/pets').expect(200);
    await get('RECEPTION', '/api/pets').expect(200);
    await get('CASHIER', '/api/pets').expect(403);
    await get('GROOMER', '/api/pets').expect(403);
  });

  it('por defecto: activos, primero los atendidos hace menos', async () => {
    const res = await get('VET', '/api/pets').expect(200);
    expect(names(res.body)).toEqual(['Firulais', 'Michi', 'Nuevo', 'Copito']);
    expect(res.body.counts).toEqual({ ACTIVE: 4, INACTIVE: 2 });
    const firulais = res.body.items[0];
    expect(firulais).toMatchObject({
      number: 26,
      allergies: 'Penicilina',
      aggressive: true,
      client: { name: 'Ana Quispe' },
      openVisit: { type: 'HOSPITALIZATION' },
      lastVisit: { diagnosis: 'Gastroenteritis', type: 'HOSPITALIZATION' },
    });
    // La anulada y el grooming no son "última atención"
    expect(res.body.items[1].lastVisit.diagnosis).toBe('Otitis externa');
    expect(res.body.items[1].openVisit).toBeNull();
    expect(res.body.items[2].lastVisit).toBeNull();
    expect(res.body.items[3].overdue).toBe(1);
  });

  it('busca por mascota, dueño, DNI, celular o número de historia', async () => {
    const q = async (term: string) =>
      names(
        (
          await get('VET', `/api/pets?q=${encodeURIComponent(term)}`).expect(
            200,
          )
        ).body,
      );
    expect(await q('firu')).toEqual(['Firulais']);
    expect(await q('QUISPE')).toEqual(['Firulais', 'Michi']);
    expect(await q('45678912')).toEqual(['Firulais', 'Michi']);
    expect(await q('956333')).toEqual(['Nuevo', 'Copito']);
    expect(await q('HC-00041')).toEqual(['Michi']);
    expect(await q('hc41')).toEqual(['Michi']);
    expect(await q('52')).toEqual(['Copito']);
    expect(await q('100%')).toEqual([]);
  });

  it('filtra por estado y especie, y ordena por nombre o número', async () => {
    const list = async (url: string) =>
      names((await get('VET', url).expect(200)).body);
    // Inactivos: el fallecido y el retirado, cada uno con su motivo
    const inactive = (
      await get('VET', '/api/pets?status=INACTIVE&sort=NAME').expect(200)
    ).body;
    expect(names(inactive)).toEqual(['Baja', 'Rocky']);
    expect(inactive.items[0]).toMatchObject({
      active: false,
      deceasedAt: null,
    });
    expect(inactive.items[1]).toMatchObject({ deceasedAt: '2026-09-01' });
    expect(await list('/api/pets?species=CAT')).toEqual(['Michi']);
    expect(await list('/api/pets?species=OTHER')).toEqual(['Copito']);
    expect(await list('/api/pets?sort=NAME')).toEqual([
      'Copito',
      'Firulais',
      'Michi',
      'Nuevo',
    ]);
    expect(await list('/api/pets?sort=NUMBER')).toEqual([
      'Nuevo',
      'Copito',
      'Michi',
      'Firulais',
    ]);
    await get('VET', '/api/pets?status=DECEASED').expect(400);
  });

  it('no mezcla pacientes de otra clínica', async () => {
    const other = await prisma.clinic.create({ data: { name: 'Otra HC' } });
    const c = await prisma.client.create({
      data: {
        clinicId: other.id,
        number: 1,
        name: 'Ana Quispe',
        phone: '987000000',
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: 'ana quispe',
      },
    });
    await prisma.pet.create({
      data: {
        clinicId: other.id,
        clientId: c.id,
        number: 1,
        name: 'Ajeno',
        nameSearch: 'ajeno',
        species: 'DOG',
      },
    });
    const res = await get('VET', '/api/pets?q=quispe').expect(200);
    expect(names(res.body)).not.toContain('Ajeno');
  });
});
