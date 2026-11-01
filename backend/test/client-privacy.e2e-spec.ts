import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Derechos ARCO (Ley 29733): acceso (exportar) y cancelación (anonimizar).
// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Datos personales del cliente: exportar y anonimizar (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const dni = String(stamp).slice(-8);
  let clinicId = 0;
  let adminId = 0;
  const cookies = { admin: '', reception: '' };
  let clientId = 0;
  let petId = 0;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    clinicId = (await prisma.clinic.create({ data: { name: 'Clínica ARCO' } }))
      .id;
    const passwordHash = await bcrypt.hash('ClaveDePrueba123', 4);
    for (const role of ['ADMIN', 'RECEPTION'] as const) {
      const user = await prisma.user.create({
        data: {
          clinicId,
          fullName: role,
          email: `arco-${role.toLowerCase()}-${stamp}@uywa.pe`,
          passwordHash,
          role,
        },
      });
      if (role === 'ADMIN') adminId = user.id;
      const res = await http()
        .post('/api/auth/login')
        .send({ email: user.email, password: 'ClaveDePrueba123' })
        .expect(200);
      cookies[role === 'ADMIN' ? 'admin' : 'reception'] = String(
        res.headers['set-cookie'],
      ).split(';')[0];
    }

    const created = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        docType: 'DNI',
        docNumber: dni,
        name: 'Rosa Peña Quispe',
        phone: '987654321',
        email: 'rosa@correo.pe',
        address: 'Jr. Las Flores 123',
        consent: true,
        pet: { name: 'Toby', species: 'DOG', microchip: '981000012345678' },
      })
      .expect(201);
    clientId = created.body.id;
    petId = created.body.pets[0].id;
    await http()
      .post(`/api/clients/${clientId}/authorized`)
      .set('Cookie', cookies.reception)
      .send({ name: 'Juan Peña', dni: '12345678', relation: 'Hijo' })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma && clinicId) {
      const where = { clinicId };
      await prisma.charge.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
      await prisma.authorizedPerson.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.delete({ where: { id: clinicId } });
    }
    await app?.close();
  });

  it('el consentimiento vigente es la versión 2 e informa el envío al extranjero', async () => {
    const res = await http()
      .get('/api/clients/consent')
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(res.body.version).toBe('2026-10-v2');
    expect(res.body.text).toContain('fuera del Perú');
    const client = await http()
      .get(`/api/clients/${clientId}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(client.body.consentVersion).toBe('2026-10-v2');
  });

  it('solo el administrador exporta o anonimiza', async () => {
    await http()
      .get(`/api/clients/${clientId}/export`)
      .set('Cookie', cookies.reception)
      .expect(403);
    await http()
      .post(`/api/clients/${clientId}/anonymize`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'Lo pidió por escrito' })
      .expect(403);
  });

  it('exporta todo lo que la clínica guarda, como archivo, y queda en la bitácora', async () => {
    const res = await http()
      .get(`/api/clients/${clientId}/export`)
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="datos-C-\d{5}\.json"/,
    );
    expect(res.body.cliente).toMatchObject({
      nombre: 'Rosa Peña Quispe',
      numeroDocumento: dni,
      correo: 'rosa@correo.pe',
      consentimiento: { version: '2026-10-v2', medio: 'Formulario' },
    });
    expect(res.body.personasAutorizadas).toEqual([
      { nombre: 'Juan Peña', dni: '12345678', celular: null, relacion: 'Hijo' },
    ]);
    expect(res.body.mascotas[0]).toMatchObject({
      nombre: 'Toby',
      especie: 'Perro',
      microchip: '981000012345678',
      atenciones: [],
    });
    const log = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'client.export' },
    });
    expect(log?.entityId).toBe(String(clientId));
  });

  it('no anonimiza con una atención abierta ni con deuda pendiente', async () => {
    const visit = await prisma.visit.create({
      data: { clinicId, petId, clientId, attendedById: adminId },
    });
    const open = await http()
      .post(`/api/clients/${clientId}/anonymize`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Lo pidió por escrito' })
      .expect(409);
    expect(open.body.message).toContain('atención abierta');

    await prisma.visit.update({
      where: { id: visit.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        notes: 'Control sin hallazgos',
      },
    });
    const charge = await prisma.charge.create({
      data: {
        clinicId,
        clientId,
        visitId: visit.id,
        petId,
        kind: 'SERVICE',
        description: 'Consulta',
        quantity: 1,
        unitPrice: 50,
        discount: 0,
        igvAffectation: 'TAXED',
        igvRate: 0.18,
        sunatUnit: 'ZZ',
        taxableAmount: 42.37,
        igvAmount: 7.63,
        total: 50,
        createdById: adminId,
      },
    });
    const debt = await http()
      .post(`/api/clients/${clientId}/anonymize`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Lo pidió por escrito' })
      .expect(409);
    expect(debt.body.message).toContain('cargos pendientes');
    await prisma.charge.update({
      where: { id: charge.id },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Prueba' },
    });
  });

  it('anonimiza: borra los datos personales, conserva la historia y bloquea la edición', async () => {
    await http()
      .post(`/api/clients/${clientId}/anonymize`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'x' })
      .expect(400);

    const res = await http()
      .post(`/api/clients/${clientId}/anonymize`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Lo pidió por escrito el 28/10' })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Cliente anonimizado',
      docType: null,
      docNumber: null,
      email: null,
      address: null,
      active: false,
      marketingConsent: false,
      authorized: [],
    });
    expect(res.body.anonymizedAt).toBeTruthy();
    expect(res.body.pets[0]).toMatchObject({
      name: 'Toby',
      active: false,
      microchip: null,
    });

    // La atención de la mascota sigue ahí (historia clínica)
    expect(await prisma.visit.count({ where: { clinicId, clientId } })).toBe(1);
    // Nadie la encuentra por su nombre o DNI
    const search = await http()
      .get(`/api/clients?q=${dni}&status=all`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(search.body.total).toBe(0);
    // La bitácora guarda el motivo, no los datos borrados
    const log = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'client.anonymize' },
    });
    expect(log?.data).toMatchObject({
      reason: 'Lo pidió por escrito el 28/10',
    });
    expect(JSON.stringify(log?.data)).not.toContain('Rosa');

    const edit = await http()
      .patch(`/api/clients/${clientId}`)
      .set('Cookie', cookies.reception)
      .send({ name: 'Rosa otra vez' })
      .expect(400);
    expect(edit.body.message).toBe(
      'Este cliente fue anonimizado: sus datos ya no se pueden editar',
    );
    await http()
      .post(`/api/clients/${clientId}/pets`)
      .set('Cookie', cookies.reception)
      .send({ name: 'Nueva', species: 'CAT' })
      .expect(400);
    await http()
      .patch(`/api/pets/${petId}`)
      .set('Cookie', cookies.reception)
      .send({ active: true })
      .expect(400);
    await http()
      .post(`/api/clients/${clientId}/anonymize`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Otra vez por error' })
      .expect(400);
  });
});
