import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { clinicDay, toDbDate } from '../src/common/time/clinic-day.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Lista de atenciones: filtros, por cobrar, olvidadas y contexto (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  let vetId: number;
  let otherVetId: number;
  const ids = { firulais: 0, michi: 0, old: 0, today: 0, groom: 0, hosp: 0 };
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const http = () => request(app.getHttpServer());
  const get = (role: string, url: string) =>
    http().get(url).set('Cookie', cookies[role]);
  type Row = { id: number; pending?: number };
  const idsOf = (body: { items: Row[] }) =>
    body.items.map((v) => v.id).sort((a, b) => a - b);

  async function login(role: 'VET' | 'CASHIER' | 'GROOMER', key: string) {
    const email = `${key}-vl-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: `${key} VL`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
    return user.id;
  }

  async function client(number: number, name: string, pet: string) {
    const c = await prisma.client.create({
      data: {
        clinicId,
        number,
        name,
        phone: `98700${number}111`,
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: name.toLowerCase(),
        pets: {
          create: {
            clinicId,
            number,
            name: pet,
            nameSearch: pet.toLowerCase(),
            species: 'DOG',
          },
        },
      },
      include: { pets: true },
    });
    return { clientId: c.id, petId: c.pets[0].id };
  }

  async function charge(
    visitId: number,
    owner: { clientId: number; petId: number },
    total: number,
    paid: number,
    status: 'PENDING' | 'PAID' | 'VOID',
  ) {
    await prisma.charge.create({
      data: {
        clinicId,
        clientId: owner.clientId,
        petId: owner.petId,
        visitId,
        kind: 'SERVICE',
        description: 'Consulta',
        quantity: 1,
        unitPrice: total,
        igvAffectation: 'TAXED',
        igvRate: 0.18,
        sunatUnit: 'ZZ',
        taxableAmount: total / 1.18,
        igvAmount: total - total / 1.18,
        total,
        paidAmount: paid,
        status,
        createdById: vetId,
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    clinicId = (await prisma.clinic.create({ data: { name: 'Clínica VL' } }))
      .id;
    vetId = await login('VET', 'vet');
    otherVetId = await login('VET', 'vet2');
    await login('CASHIER', 'cashier');
    await login('GROOMER', 'groomer');

    const ana = await client(1, 'Ana Quispe', 'Firulais');
    const beto = await client(2, 'Beto Ramos', 'Michi');
    ids.firulais = ana.petId;
    ids.michi = beto.petId;
    const base = (o: { clientId: number; petId: number }) => ({
      clinicId,
      ...o,
      attendedById: vetId,
    });

    // Firulais: una atención de hace 3 días (cerrada, con peso) y la de hoy
    const closed = await prisma.visit.create({
      data: {
        ...base(ana),
        status: 'CLOSED',
        openedAt: daysAgo(10),
        closedAt: daysAgo(10),
        weightKg: 12.5,
        diagnosis: 'Otitis externa',
      },
    });
    ids.old = (
      await prisma.visit.create({
        data: { ...base(ana), openedAt: daysAgo(3), reason: 'Vómitos' },
      })
    ).id;
    ids.today = (
      await prisma.visit.create({
        data: { ...base(ana), attendedById: otherVetId },
      })
    ).id;
    ids.groom = (
      await prisma.visit.create({
        data: { ...base(beto), type: 'GROOMING', openedAt: daysAgo(2) },
      })
    ).id;
    ids.hosp = (
      await prisma.visit.create({
        data: { ...base(beto), type: 'HOSPITALIZATION', openedAt: daysAgo(4) },
      })
    ).id;

    // Hoy: 100 cobrados en parte (40) + uno pagado + uno anulado → falta 60
    await charge(ids.today, ana, 100, 40, 'PENDING');
    await charge(ids.today, ana, 50, 50, 'PAID');
    await charge(ids.today, ana, 999, 0, 'VOID');
    await charge(closed.id, ana, 80, 80, 'PAID');

    // Vacuna vencida (la última dosis) y otra al día
    const vaccine = (name: string, applied: number, due: number) =>
      prisma.immunization.create({
        data: {
          clinicId,
          petId: ana.petId,
          kind: 'VACCINE',
          name,
          appliedAt: toDbDate(today),
          nextDueAt: new Date(toDbDate(today).getTime() + due * 86_400_000),
          appliedById: vetId,
          createdAt: daysAgo(applied),
        },
      });
    await vaccine('Antirrábica', 400, -30);
    await vaccine('Séxtuple', 30, 330);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Consultas incluye internamientos; Grooming va aparte', async () => {
    const consult = await get('vet', '/api/visits?type=CONSULTATION').expect(
      200,
    );
    expect(idsOf(consult.body)).not.toContain(ids.groom);
    expect(idsOf(consult.body)).toContain(ids.hosp);
    const groom = await get('vet', '/api/visits?type=GROOMING').expect(200);
    expect(idsOf(groom.body)).toEqual([ids.groom]);
  });

  it('el groomer sigue viendo solo grooming aunque pida consultas', async () => {
    const res = await get('groomer', '/api/visits?type=CONSULTATION').expect(
      200,
    );
    expect(idsOf(res.body)).toEqual([ids.groom]);
    await get('groomer', `/api/visits/${ids.today}/context`).expect(404);
    await get('cashier', `/api/visits/${ids.today}/context`).expect(403);
  });

  it('busca por mascota o por dueño, sin tildes ni mayúsculas', async () => {
    const pet = await get('vet', '/api/visits?q=FIRU').expect(200);
    expect(pet.body.total).toBe(3);
    const owner = await get('vet', '/api/visits?q=ramos').expect(200);
    expect(idsOf(owner.body)).toEqual(
      [ids.groom, ids.hosp].sort((a, b) => a - b),
    );
  });

  it('filtra por veterinario y por día', async () => {
    const vet = await get('vet', `/api/visits?vetId=${otherVetId}`).expect(200);
    expect(idsOf(vet.body)).toEqual([ids.today]);
    const day = await get('vet', `/api/visits?day=${today}`).expect(200);
    expect(idsOf(day.body)).toEqual([ids.today]);
    await get('vet', '/api/visits?day=2026-13-45').expect(400);
    await get('vet', '/api/visits?day=ayer').expect(400);
  });

  it('cada atención trae lo que falta cobrar (sin anulados)', async () => {
    const res = await get('vet', `/api/visits?day=${today}`).expect(200);
    expect(res.body.items[0].total).toBe(150);
    expect(res.body.items[0].pending).toBe(60);
  });

  it('cuenta las abiertas de días anteriores, sin contar internados', async () => {
    const all = await get('vet', '/api/visits').expect(200);
    expect(all.body.stale).toBe(2); // la de hace 3 días + el grooming
    const consult = await get('vet', '/api/visits?type=CONSULTATION').expect(
      200,
    );
    expect(consult.body.stale).toBe(1);
    expect(consult.body.staleByType).toEqual({ CONSULTATION: 1, GROOMING: 1 });
    // La pestaña "Abiertas" cuenta todas las abiertas de su tipo, aunque haya un filtro puesto
    const openAll = await get(
      'vet',
      '/api/visits?type=CONSULTATION&status=OPEN',
    ).expect(200);
    const filtered = await get(
      'vet',
      '/api/visits?type=CONSULTATION&q=zzzz',
    ).expect(200);
    expect(consult.body.open).toBe(openAll.body.total);
    expect(filtered.body.open).toBe(openAll.body.total);
    const only = await get('vet', '/api/visits?stale=true').expect(200);
    expect(idsOf(only.body)).toEqual(
      [ids.old, ids.groom].sort((a, b) => a - b),
    );
  });

  it('Inicio avisa aparte las consultas olvidadas y el grooming sin entregar', async () => {
    type Alert = { kind: string; count: number; link: string };
    const vet = (await get('vet', '/api/dashboard/alerts').expect(200))
      .body as Alert[];
    expect(vet.find((a) => a.kind === 'staleVisits')).toMatchObject({
      count: 1,
      link: '/atenciones',
    });
    expect(vet.some((a) => a.kind === 'staleGrooming')).toBe(false);
    const groomer = (await get('groomer', '/api/dashboard/alerts').expect(200))
      .body as Alert[];
    expect(groomer.find((a) => a.kind === 'staleGrooming')).toMatchObject({
      count: 1,
      link: '/grooming',
    });
    expect(groomer.some((a) => a.kind === 'staleVisits')).toBe(false);
    const cashier = (await get('cashier', '/api/dashboard/alerts').expect(200))
      .body as Alert[];
    expect(cashier.some((a) => a.kind.startsWith('stale'))).toBe(false);
  });

  it('el contexto trae la última consulta (no el baño), el peso anterior y las vacunas vencidas', async () => {
    // Un baño de ayer no tapa la última consulta para el veterinario
    const bath = await prisma.visit.create({
      data: {
        clinicId,
        petId: (
          await prisma.visit.findUniqueOrThrow({ where: { id: ids.old } })
        ).petId,
        clientId: (
          await prisma.visit.findUniqueOrThrow({ where: { id: ids.old } })
        ).clientId,
        attendedById: vetId,
        type: 'GROOMING',
        status: 'CLOSED',
        openedAt: new Date(Date.now() - 86_400_000),
      },
    });
    const res = await get('vet', `/api/visits/${ids.today}/context`).expect(
      200,
    );
    await prisma.visit.delete({ where: { id: bath.id } });
    expect(res.body.previous).toMatchObject({
      id: ids.old,
      reason: 'Vómitos',
    });
    expect(res.body.previousWeight.kg).toBe(12.5);
    expect(res.body.overdue).toEqual([
      expect.objectContaining({ name: 'Antirrábica', kind: 'VACCINE' }),
    ]);
  });

  it('sugiere los diagnósticos más usados, sin repetir por mayúsculas', async () => {
    const base = {
      clinicId,
      petId: ids.michi,
      clientId: (
        await prisma.pet.findUniqueOrThrow({ where: { id: ids.michi } })
      ).clientId,
      attendedById: vetId,
      status: 'CLOSED' as const,
    };
    await prisma.visit.createMany({
      data: [
        { ...base, diagnosis: 'Gastroenteritis' },
        { ...base, diagnosis: 'gastroenteritis ' },
        { ...base, diagnosis: 'Gastroenteritis' },
        { ...base, diagnosis: 'Anulada', status: 'CANCELLED' },
      ],
    });
    const res = await get('vet', '/api/visits/diagnoses').expect(200);
    expect(res.body[0]).toBe('Gastroenteritis');
    expect(res.body).toContain('Otitis externa');
    expect(res.body).not.toContain('gastroenteritis');
    expect(res.body).not.toContain('Anulada');
    await get('cashier', '/api/visits/diagnoses').expect(403);
    await get('groomer', '/api/visits/diagnoses').expect(403);
  });

  it('la historia completa trae las consultas y la curva de peso', async () => {
    const res = await get(
      'vet',
      `/api/visits/pet/${ids.firulais}/history`,
    ).expect(200);
    expect(res.body.pet.name).toBe('Firulais');
    expect(res.body.client.name).toBe('Ana Quispe');
    expect(res.body.clinic.name).toBe('Clínica VL');
    expect(res.body.visits.map((v: { id: number }) => v.id)).toEqual([
      ids.today,
      ids.old,
      expect.any(Number),
    ]);
    expect(res.body.visits[2].diagnosis).toBe('Otitis externa');
    expect(res.body.weights).toEqual([{ at: expect.any(String), kg: 12.5 }]);
    await get('cashier', `/api/visits/pet/${ids.firulais}/history`).expect(403);
    await get('groomer', `/api/visits/pet/${ids.firulais}/history`).expect(403);
    await get('vet', '/api/visits/pet/999999/history').expect(404);
    const weights = await get(
      'groomer',
      `/api/visits/pet/${ids.firulais}/weights`,
    ).expect(200);
    expect(weights.body.map((w: { kg: number }) => w.kg)).toEqual([12.5]);
    await get('cashier', `/api/visits/pet/${ids.firulais}/weights`).expect(403);
  });
});
