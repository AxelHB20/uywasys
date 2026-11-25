import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { MailService } from '../src/common/mail/mail.service.js';
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
      await prisma.passwordReset.deleteMany({ where: { user: { clinicId } } });
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

  it('cambiar la contraseña cierra las sesiones de otros equipos, pero no la actual', async () => {
    const login = async () =>
      String(
        (
          await request(app.getHttpServer())
            .post('/api/auth/login')
            .send({ email, password })
            .expect(200)
        ).headers['set-cookie'],
      );
    const pcRecepcion = await login();
    const celular = await login();

    const change = await request(app.getHttpServer())
      .patch('/api/auth/password')
      .set('Cookie', pcRecepcion)
      .send({ currentPassword: password, newPassword: 'ClaveNueva456' })
      .expect(200);
    const nueva = String(change.headers['set-cookie']);
    expect(nueva).toContain('uywa_session=');

    const fuera = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', celular)
      .expect(401);
    expect(fuera.body.message).toBe(
      'Tu contraseña cambió. Inicia sesión de nuevo',
    );
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', nueva)
      .expect(200);

    // Se deja la clave como estaba para el resto de pruebas
    await request(app.getHttpServer())
      .patch('/api/auth/password')
      .set('Cookie', nueva)
      .send({ currentPassword: 'ClaveNueva456', newPassword: password })
      .expect(200);
  });

  it('limita los intentos de login por conexión, aunque sean a cuentas distintas', async () => {
    const before = process.env.LOGIN_RATE_LIMIT;
    process.env.LOGIN_RATE_LIMIT = '3';
    try {
      const statuses: number[] = [];
      let blocked: request.Response | undefined;
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: `nadie-${i}@uywa.pe`, password: 'Cualquiera123' });
        statuses.push(res.status);
        if (res.status === 429) blocked = res;
      }
      expect(statuses).toContain(429);
      expect(blocked?.body.message).toBe(
        'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo',
      );
    } finally {
      process.env.LOGIN_RATE_LIMIT = before;
    }
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

  it('"¿Olvidaste tu contraseña?": enlace por correo, de un solo uso, que desbloquea y cierra sesiones', async () => {
    const http = () => request(app.getHttpServer());
    const mail = app.get(MailService);
    const resetEmail = `e2e-reset-${Date.now()}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: 'Rosa Recuperar',
        email: resetEmail,
        passwordHash: await bcrypt.hash('ClaveVieja123', 4),
        role: 'ADMIN',
        mustChangePassword: true,
        lockedUntil: new Date(Date.now() + 10 * 60_000),
      },
    });
    expect((await http().get('/api/auth/options').expect(200)).body).toEqual({
      passwordReset: true,
    });

    // Un correo que no existe responde igual y no envía nada
    const before = mail.outbox.length;
    await http()
      .post('/api/auth/forgot')
      .send({ email: 'nadie@uywa.pe' })
      .expect(200, { ok: true });
    expect(mail.outbox.length).toBe(before);

    await http()
      .post('/api/auth/forgot')
      .send({ email: resetEmail.toUpperCase() })
      .expect(200);
    const sent = mail.outbox.at(-1)!;
    expect(sent.to).toBe(resetEmail);
    expect(sent.subject).toContain('Clínica e2e');
    expect(sent.text).toContain('Hola, Rosa');
    const token = /recuperar\?token=([\w-]+)/.exec(sent.text)![1];
    // En la base no queda el token, solo su hash
    const stored = await prisma.passwordReset.findFirstOrThrow({
      where: { user: { email: resetEmail } },
    });
    expect(stored.tokenHash).not.toContain(token);

    const weak = await http()
      .post('/api/auth/reset')
      .send({ token, password: 'corta' })
      .expect(400);
    expect(weak.body.errors[0]).toContain('al menos 8 caracteres');
    await http()
      .post('/api/auth/reset')
      .send({ token, password: 'ClaveNueva456' })
      .expect(204);
    // El mismo enlace no sirve dos veces
    const again = await http()
      .post('/api/auth/reset')
      .send({ token, password: 'OtraClave789' })
      .expect(400);
    expect(again.body.message).toContain('venció o ya se usó');

    // Desbloqueada, sin clave temporal, con la clave nueva y las sesiones anteriores cerradas
    // (se revisa en la base: el login ya alcanzó su límite por conexión en otra prueba)
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: resetEmail },
    });
    expect(user.lockedUntil).toBeNull();
    expect(user.mustChangePassword).toBe(false);
    expect(user.sessionVersion).toBe(1);
    expect(await bcrypt.compare('ClaveNueva456', user.passwordHash)).toBe(true);
    const audit = await prisma.auditLog.findMany({
      where: { user: { email: resetEmail } },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['auth.reset_requested', 'auth.password_reset']),
    );

    // Un enlace vencido no sirve; como máximo 3 pedidos por hora
    await http()
      .post('/api/auth/forgot')
      .send({ email: resetEmail })
      .expect(200);
    const expired = /recuperar\?token=([\w-]+)/.exec(
      mail.outbox.at(-1)!.text,
    )![1];
    await prisma.passwordReset.updateMany({
      where: { user: { email: resetEmail }, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http()
      .post('/api/auth/reset')
      .send({ token: expired, password: 'ClaveNueva999' })
      .expect(400);
    await http()
      .post('/api/auth/forgot')
      .send({ email: resetEmail })
      .expect(200);
    const count = mail.outbox.length;
    await http()
      .post('/api/auth/forgot')
      .send({ email: resetEmail })
      .expect(200);
    expect(mail.outbox.length).toBe(count);
  });
});
