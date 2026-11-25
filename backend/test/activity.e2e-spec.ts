import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Actividad (bitácora) (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const clinicIds: number[] = [];
  let adminCookie = '';
  let receptionCookie = '';
  let receptionId = 0;

  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    String(
      (
        await http()
          .post('/api/auth/login')
          .send({ email, password: 'ClaveDePrueba123' })
          .expect(200)
      ).headers['set-cookie'],
    ).split(';')[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash('ClaveDePrueba123', 4);
    for (const name of ['Clínica A', 'Clínica B']) {
      const clinic = await prisma.clinic.create({ data: { name } });
      clinicIds.push(clinic.id);
    }
    const [a, b] = clinicIds;
    const admin = await prisma.user.create({
      data: {
        clinicId: a,
        fullName: 'Dueña',
        email: `act-admin-${stamp}@uywa.pe`,
        passwordHash,
        role: 'ADMIN',
      },
    });
    const reception = await prisma.user.create({
      data: {
        clinicId: a,
        fullName: 'Rosa',
        email: `act-rec-${stamp}@uywa.pe`,
        passwordHash,
        role: 'RECEPTION',
      },
    });
    receptionId = reception.id;
    adminCookie = await login(admin.email);
    receptionCookie = await login(reception.email);

    // Lo que hicieron en la clínica A (fechas en hora de Lima) y algo de la B que no debe verse
    const at = (iso: string) => new Date(iso);
    await prisma.auditLog.createMany({
      data: [
        {
          clinicId: a,
          userId: reception.id,
          action: 'cash.receipt_void',
          entity: 'receipt',
          entityId: '9',
          data: { motivo: 'Cobro duplicado' },
          createdAt: at('2026-10-20T15:00:00-05:00'),
        },
        {
          clinicId: a,
          userId: reception.id,
          action: 'client.create',
          entity: 'client',
          entityId: '3',
          createdAt: at('2026-10-20T23:30:00-05:00'),
        },
        {
          clinicId: a,
          userId: admin.id,
          action: 'product.price_change',
          entity: 'product',
          entityId: '4',
          data: { precio: { antes: '10.00', ahora: '12.00' } },
          createdAt: at('2026-10-21T09:00:00-05:00'),
        },
        {
          clinicId: b,
          action: 'cash.receipt_void',
          entity: 'receipt',
          entityId: '1',
          createdAt: at('2026-10-20T10:00:00-05:00'),
        },
      ],
    });
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      await prisma.auditLog.deleteMany({
        where: { clinicId: { in: clinicIds } },
      });
      await prisma.user.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('solo el administrador ve la bitácora', async () => {
    const res = await http()
      .get('/api/activity')
      .set('Cookie', receptionCookie)
      .expect(403);
    expect(res.body.message).toBe('Tu rol no tiene permiso para esta acción');
  });

  it('muestra lo de su clínica, lo más reciente primero, con autor y lo importante marcado', async () => {
    const res = await http()
      .get('/api/activity?from=2026-10-01&to=2026-10-27')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((i: { action: string }) => i.action)).toEqual([
      'product.price_change',
      'client.create',
      'cash.receipt_void',
    ]);
    expect(res.body.items[2]).toMatchObject({
      important: true,
      user: { id: receptionId, fullName: 'Rosa' },
      data: { motivo: 'Cobro duplicado' },
    });
    expect(res.body.items[1].important).toBe(false);
  });

  it('filtra por área, persona, solo importantes y por día de Lima', async () => {
    const get = async (qs: string) =>
      (
        await http()
          .get(`/api/activity?${qs}`)
          .set('Cookie', adminCookie)
          .expect(200)
      ).body.items.map((i: { action: string }) => i.action);

    expect(await get('area=cash')).toEqual(['cash.receipt_void']);
    expect(await get(`userId=${receptionId}&to=2026-10-27`)).toEqual([
      'client.create',
      'cash.receipt_void',
    ]);
    expect(await get('important=true')).toEqual([
      'product.price_change',
      'cash.receipt_void',
    ]);
    // 23:30 del 20 en Lima ya es 21 en UTC: igual cuenta como 20
    expect(await get('from=2026-10-20&to=2026-10-20')).toEqual([
      'client.create',
      'cash.receipt_void',
    ]);
  });

  it('con más de 10 000 registros no los cuenta todos: dice "más de" y deja filtrar por fecha', async () => {
    const [a] = clinicIds;
    await prisma.auditLog.createMany({
      data: Array.from({ length: 10_001 }, (_, i) => ({
        clinicId: a,
        action: 'client.update',
        entity: 'client',
        entityId: String(i + 1),
        createdAt: new Date('2025-01-15T15:00:00Z'),
      })),
    });
    const all = await http()
      .get('/api/activity')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(all.body).toMatchObject({ total: 10_000, totalCapped: true });
    expect(all.body.items).toHaveLength(50);
    // Con fecha se cuenta exacto
    const day = await http()
      .get('/api/activity?from=2026-10-01&to=2026-10-27')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(day.body).toMatchObject({ total: 3, totalCapped: false });
  });

  it('lo que hace soporte no se muestra; "Para revisar" cuenta por grupo', async () => {
    const [a] = clinicIds;
    const support = await prisma.user.create({
      data: {
        clinicId: a,
        fullName: 'Técnico de Uywa',
        email: `act-sup-${Date.now()}@uywa.pe`,
        passwordHash: 'x',
        role: 'ADMIN',
        isSupport: true,
      },
    });
    const at = (iso: string) => new Date(iso);
    await prisma.auditLog.createMany({
      data: [
        {
          clinicId: a,
          userId: support.id,
          action: 'auth.login',
          entity: 'user',
          entityId: String(support.id),
          createdAt: at('2026-10-28T10:00:00-05:00'),
        },
        {
          clinicId: a,
          userId: support.id,
          action: 'auth.login_failed',
          entity: 'user',
          entityId: String(support.id),
          createdAt: at('2026-10-28T09:58:00-05:00'),
        },
        {
          clinicId: a,
          userId: support.id,
          action: 'billing.token_update',
          entity: 'clinic',
          entityId: String(a),
          data: { proveedor: 'MIFACT' },
          createdAt: at('2026-10-28T10:05:00-05:00'),
        },
        {
          clinicId: a,
          userId: receptionId,
          action: 'lab.cancel',
          entity: 'labOrder',
          entityId: '7',
          createdAt: at('2026-10-28T11:00:00-05:00'),
        },
      ],
    });
    const get = async (qs: string) =>
      (
        await http()
          .get(`/api/activity?from=2026-10-28&to=2026-10-28&${qs}`)
          .set('Cookie', adminCookie)
          .expect(200)
      ).body.items as {
        action: string;
        important: boolean;
        user: { fullName: string; support: boolean } | null;
      }[];

    // Nada de lo que hace soporte se muestra: ni sus ingresos ni sus ajustes
    const all = await get('');
    expect(all.map((i) => i.action)).toEqual(['lab.cancel']);
    expect(all[0].important).toBe(true);
    expect(await get(`userId=${support.id}`)).toEqual([]);
    expect(await get('area=billing')).toEqual([]);
    expect((await get('area=lab')).map((i) => i.action)).toEqual([
      'lab.cancel',
    ]);
    expect((await get('kind=voids')).map((i) => i.action)).toEqual([
      'lab.cancel',
    ]);
    expect(await get('kind=access')).toEqual([]);
    expect((await get('important=true')).map((i) => i.action)).toEqual([
      'lab.cancel',
    ]);
    await http()
      .get('/api/activity?area=support')
      .set('Cookie', adminCookie)
      .expect(400);

    const review = await http()
      .get('/api/activity/review?from=2026-10-28&to=2026-10-28')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(review.body).toEqual({
      from: '2026-10-28',
      to: '2026-10-28',
      total: 1,
      kinds: [{ kind: 'voids', count: 1 }],
    });
    await http()
      .get('/api/activity/review')
      .set('Cookie', receptionCookie)
      .expect(403);
  });
});
