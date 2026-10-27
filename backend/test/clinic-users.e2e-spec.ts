import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Clínica y usuarios (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  let adminCookie: string;
  const stamp = Date.now();
  const adminEmail = `admin-${stamp}@uywa.pe`;

  const http = () => request(app.getHttpServer());
  const login = async (email: string, password: string) => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return {
      cookie: String(res.headers['set-cookie']).split(';')[0],
      user: res.body.user,
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    clinicId = (
      await prisma.clinic.create({ data: { name: 'Clínica e2e paso 3' } })
    ).id;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: 'Admin E2E',
        email: adminEmail,
        role: 'ADMIN',
        passwordHash: await bcrypt.hash('Admin12345', 4),
      },
    });
    adminCookie = (await login(adminEmail, 'Admin12345')).cookie;
  });

  afterAll(async () => {
    if (prisma && clinicId) {
      await prisma.auditLog.deleteMany({ where: { clinicId } });
      await prisma.user.deleteMany({ where: { clinicId } });
      await prisma.clinic.delete({ where: { id: clinicId } });
    }
    await app?.close();
  });

  it('rechaza un RUC con dígito verificador incorrecto', async () => {
    const res = await http()
      .patch('/api/clinic')
      .set('Cookie', adminCookie)
      .send({ name: 'Vet', ruc: '20131312956' })
      .expect(400);
    expect(res.body.errors).toContain(
      'El RUC no es válido: revisa los 11 dígitos',
    );
  });

  it('guarda los datos de la clínica y marca el perfil como completo', async () => {
    const res = await http()
      .patch('/api/clinic')
      .set('Cookie', adminCookie)
      .send({
        name: 'Veterinaria San Martín',
        ruc: '20131312955',
        address: 'Av. Lima 123',
        phone: '987 654 321',
        email: '',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Veterinaria San Martín',
      ruc: '20131312955',
      email: null,
    });

    const setup = await http()
      .get('/api/clinic/setup')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(setup.body).toEqual({ profileComplete: true, teamMembers: 0 });
  });

  it('sube el logo, lo sirve como imagen y rechaza archivos que no son imágenes', async () => {
    const upload = await http()
      .put('/api/clinic/logo')
      .set('Cookie', adminCookie)
      .attach('logo', PNG_1X1, {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect(upload.body.logoUrl).toMatch(/^\/api\/clinic\/logo\?v=\d+$/);

    const image = await http()
      .get('/api/clinic/logo')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(image.headers['content-type']).toBe('image/png');

    await http()
      .put('/api/clinic/logo')
      .set('Cookie', adminCookie)
      .attach('logo', Buffer.from('<script>alert(1)</script>'), {
        filename: 'falso.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('crea un usuario con clave temporal que obliga a cambiarla antes de usar el sistema', async () => {
    const created = await http()
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({
        fullName: 'Rosa Recepción',
        email: `rosa-${stamp}@uywa.pe`,
        role: 'RECEPTION',
      })
      .expect(201);
    expect(created.body.user).toMatchObject({
      role: 'RECEPTION',
      mustChangePassword: true,
    });
    const temporary = created.body.temporaryPassword as string;

    const rosa = await login(`rosa-${stamp}@uywa.pe`, temporary);
    expect(rosa.user.mustChangePassword).toBe(true);

    const blocked = await http()
      .get('/api/clinic/setup')
      .set('Cookie', rosa.cookie)
      .expect(403);
    expect(blocked.body.message).toBe(
      'Cambia tu contraseña temporal para continuar',
    );

    await http()
      .patch('/api/auth/password')
      .set('Cookie', rosa.cookie)
      .send({ currentPassword: temporary, newPassword: 'Recepcion2026' })
      .expect(200);

    await http()
      .get('/api/clinic/setup')
      .set('Cookie', rosa.cookie)
      .expect(200);
    const forbidden = await http()
      .get('/api/users')
      .set('Cookie', rosa.cookie)
      .expect(403);
    expect(forbidden.body.message).toBe(
      'Tu rol no tiene permiso para esta acción',
    );
  });

  it('rechaza un correo repetido y exige la colegiatura a los veterinarios', async () => {
    const duplicate = await http()
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({
        fullName: 'Otra Rosa',
        email: `ROSA-${stamp}@uywa.pe`,
        role: 'CASHIER',
      })
      .expect(409);
    expect(duplicate.body.message).toBe('Ya existe un usuario con ese correo');

    await http()
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({
        fullName: 'Dr. Sin Colegiatura',
        email: `vet-${stamp}@uywa.pe`,
        role: 'VET',
      })
      .expect(400);
  });

  it('protege al único administrador y registra todo en la bitácora', async () => {
    const team = await http()
      .get('/api/users')
      .set('Cookie', adminCookie)
      .expect(200);
    const me = (team.body as { id: number; email: string }[]).find(
      (u) => u.email === adminEmail,
    )!;
    await http()
      .patch(`/api/users/${me.id}`)
      .set('Cookie', adminCookie)
      .send({ active: false })
      .expect(400);
    await http()
      .patch(`/api/users/${me.id}`)
      .set('Cookie', adminCookie)
      .send({ role: 'CASHIER' })
      .expect(409);

    const actions = (
      await prisma.auditLog.findMany({
        where: { clinicId },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'clinic.update',
        'clinic.logo_update',
        'user.create',
        'auth.password_change',
      ]),
    );
  });
});
