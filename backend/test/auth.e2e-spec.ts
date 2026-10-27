import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada (docker compose up -d) y las migraciones aplicadas.
describe('Autenticación (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = `e2e-${Date.now()}@uywa.pe`;
  const password = 'ClaveDePrueba123';
  let clinicId: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    const clinic = await prisma.clinic.create({
      data: { name: 'Clínica e2e' },
    });
    clinicId = clinic.id;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: 'Prueba E2E',
        email,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'RECEPTION',
      },
    });
  });

  afterAll(async () => {
    if (prisma && clinicId) {
      await prisma.auditLog.deleteMany({ where: { clinicId } });
      await prisma.user.deleteMany({ where: { clinicId } });
      await prisma.clinic.delete({ where: { id: clinicId } });
    }
    await app?.close();
  });

  it('rechaza el acceso a la API sin sesión', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
    expect(res.body.message).toBe('Inicia sesión para continuar');
  });

  it('valida los datos del formulario de login', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'no-es-correo' })
      .expect(400);
    expect(res.body.errors).toContain('Ingresa un correo válido');
  });

  it('rechaza una contraseña incorrecta', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'incorrecta' })
      .expect(401);
  });

  it('inicia sesión con una cookie httpOnly y permite consultar /me', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    expect(login.body.user).toMatchObject({
      email,
      role: 'RECEPTION',
      clinic: { name: 'Clínica e2e' },
    });

    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toContain('uywa_session=');
    expect(cookie).toContain('HttpOnly');

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.fullName).toBe('Prueba E2E');
  });

  it('cerrar sesión borra la cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .expect(204);
    expect(String(res.headers['set-cookie'])).toMatch(/uywa_session=;/);
  });

  it('registra los intentos en la bitácora', async () => {
    const actions = await prisma.auditLog.findMany({
      where: { clinicId },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['auth.login', 'auth.login_failed']),
    );
  });
});
