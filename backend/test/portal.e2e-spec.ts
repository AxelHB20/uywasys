import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Portal del dueño (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  let otherClinicId: number;
  let clientId: number;
  let vetId: number;
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());

  async function login(
    clinic: number,
    role: 'ADMIN' | 'RECEPTION' | 'CASHIER',
  ) {
    const email = `${role.toLowerCase()}-portal-${clinic}-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId: clinic,
        fullName: `${role} Portal`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    return {
      cookie: String(res.headers['set-cookie']).split(';')[0],
      id: user.id,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    clinicId = (
      await prisma.clinic.create({
        data: {
          name: 'Clínica e2e portal',
          phone: '014445566',
          portalShowRecords: true,
        },
      })
    ).id;
    otherClinicId = (
      await prisma.clinic.create({ data: { name: 'Otra clínica portal' } })
    ).id;
    const reception = await login(clinicId, 'RECEPTION');
    cookies.reception = reception.cookie;
    cookies.cashier = (await login(clinicId, 'CASHIER')).cookie;
    cookies.other = (await login(otherClinicId, 'ADMIN')).cookie;
    vetId = (
      await prisma.user.create({
        data: {
          clinicId,
          fullName: 'Dra. Portal',
          email: `vet-portal-${stamp}@uywa.pe`,
          role: 'VET',
          licenseNumber: '09876',
          passwordHash: 'x',
        },
      })
    ).id;
    const client = await prisma.client.create({
      data: {
        clinicId,
        number: 1,
        name: 'Rosa Quispe Mamani',
        phone: '987654321',
        docType: 'DNI',
        docNumber: '44556677',
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: 'rosa quispe',
        pets: {
          create: [
            {
              clinicId,
              number: 1,
              name: 'Toby',
              nameSearch: 'toby',
              species: 'DOG',
            },
            {
              clinicId,
              number: 2,
              name: 'Michi',
              nameSearch: 'michi',
              species: 'CAT',
              deceasedAt: new Date('2026-01-10'),
            },
          ],
        },
      },
      include: { pets: true },
    });
    clientId = client.id;
    const toby = client.pets.find((p) => p.name === 'Toby')!;
    await prisma.immunization.create({
      data: {
        clinicId,
        petId: toby.id,
        kind: 'VACCINE',
        name: 'Séxtuple',
        appliedAt: new Date('2026-06-01'),
        nextDueAt: new Date('2027-06-01'),
        appliedById: vetId,
      },
    });
    await prisma.appointment.create({
      data: {
        clinicId,
        petId: toby.id,
        clientId,
        vetId,
        startsAt: new Date(Date.now() + 3 * 86_400_000),
        reason: 'Control anual',
        createdById: reception.id,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (cookie: string, id = clientId) =>
    http().post(`/api/clients/${id}/portal`).set('Cookie', cookie);

  it('caja no genera enlaces; recepción sí y el dueño ve lo mínimo de sus mascotas', async () => {
    await create(cookies.cashier).expect(403);
    const res = await create(cookies.reception).expect(201);
    const { token } = res.body as { token: string };
    expect(token.length).toBeGreaterThanOrEqual(30);

    const view = await http().get(`/api/portal/${token}`).expect(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.body.clinic.name).toBe('Clínica e2e portal');
    expect(view.body.ownerFirstName).toBe('Rosa');
    // La mascota fallecida no aparece
    expect(view.body.pets.map((p: { name: string }) => p.name)).toEqual([
      'Toby',
    ]);
    const [toby] = view.body.pets;
    expect(toby.immunizations[0]).toMatchObject({
      name: 'Séxtuple',
      appliedAt: '2026-06-01',
      nextDueAt: '2027-06-01',
      appliedBy: 'Dra. Portal',
      licenseNumber: '09876',
    });
    expect(toby.appointments[0]).toMatchObject({
      reason: 'Control anual',
      vet: 'Dra. Portal',
    });
    // Ni celular ni documento: el enlace se puede reenviar
    const raw = JSON.stringify(view.body);
    expect(raw).not.toContain('987654321');
    expect(raw).not.toContain('44556677');
    expect(raw).not.toContain('Quispe');

    const status = await http()
      .get(`/api/clients/${clientId}/portal`)
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(status.body).toMatchObject({ active: true, viewCount: 1 });
    expect(status.body.token).toBeUndefined();
  });

  it('sin carnet en el portal: solo nombre y próxima dosis, sin lote, firma ni recetas', async () => {
    await prisma.clinic.update({
      where: { id: clinicId },
      data: { portalShowRecords: false },
    });
    const token = (await create(cookies.reception).expect(201)).body.token;
    const view = await http().get(`/api/portal/${token}`).expect(200);
    expect(view.body.showRecords).toBe(false);
    const [toby] = view.body.pets;
    expect(toby.immunizations[0]).toMatchObject({
      name: 'Séxtuple',
      nextDueAt: '2027-06-01',
      appliedBy: null,
      licenseNumber: null,
      batchNumber: null,
    });
    expect(toby.prescriptions).toEqual([]);
    expect(JSON.stringify(view.body)).not.toContain('09876');

    // Calendario para el celular: refuerzo de día completo y la cita con su hora
    const ics = await http()
      .get(`/api/portal/${token}/calendario.ics`)
      .expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('SUMMARY:Toby: le toca Séxtuple');
    expect(ics.text).toContain('DTSTART;VALUE=DATE:20270601');
    expect(ics.text).toContain('SUMMARY:Cita de Toby · Clínica e2e portal');
    expect(ics.text).not.toContain('987654321');

    const manifest = await http()
      .get(`/api/portal/${token}/manifest.webmanifest`)
      .expect(200);
    expect(manifest.body).toMatchObject({
      start_url: `/p/${token}`,
      scope: '/p/',
    });
    await prisma.clinic.update({
      where: { id: clinicId },
      data: { portalShowRecords: true },
    });
  });

  it('generar uno nuevo invalida el anterior; desactivar corta el acceso', async () => {
    const first = (await create(cookies.reception).expect(201)).body.token;
    const second = (await create(cookies.reception).expect(201)).body.token;
    await http().get(`/api/portal/${first}`).expect(404);
    await http().get(`/api/portal/${second}`).expect(200);
    await http()
      .delete(`/api/clients/${clientId}/portal`)
      .set('Cookie', cookies.reception)
      .expect(204);
    const gone = await http().get(`/api/portal/${second}`).expect(404);
    expect(gone.body.message).toContain('Pide uno nuevo');
    const status = await http()
      .get(`/api/clients/${clientId}/portal`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(status.body.active).toBe(false);
  });

  it('un enlace vencido o inventado no muestra nada; otra clínica no genera enlaces de este cliente', async () => {
    const token = (await create(cookies.reception).expect(201)).body.token;
    await prisma.portalLink.updateMany({
      where: { clientId, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http().get(`/api/portal/${token}`).expect(404);
    await http()
      .get('/api/portal/abcdefghijklmnopqrstuvwxyz012345')
      .expect(404);
    await http().get('/api/portal/x').expect(404);
    await create(cookies.other).expect(404);
  });
});
