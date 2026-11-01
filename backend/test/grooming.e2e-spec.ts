import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'GROOMER' | 'CASHIER';

/** PNG de prueba (cabecera válida) para la firma del dueño */
function png(size = 2000): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([header, Buffer.alloc(size - header.length, 7)]);
}

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Grooming (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const ids = { bath: 0, nails: 0, consult: 0, pet: 0, pet2: 0, session: 0 };

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-groom-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    userIds[key] = user.id;
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  async function newPet(name: string, aggressive = false) {
    const res = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        name: `Dueño de ${name}`,
        phone: '987654321',
        consent: true,
        pet: { name, species: 'DOG', breed: 'Shih Tzu' },
      })
      .expect(201);
    const petId: number = res.body.pets[0].id;
    if (aggressive)
      await prisma.pet.update({ where: { id: petId }, data: { aggressive } });
    return petId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e grooming', 'Otra clínica grooming'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'GROOMER', 'groomer');
    await login(mine, 'CASHIER', 'cashier');
    await login(other, 'ADMIN', 'other');
    // El groomer gana 30 % de lo cobrado de sus servicios
    await http()
      .patch(`/api/users/${userIds.groomer}`)
      .set('Cookie', cookies.admin)
      .send({ commissionPercent: 30 })
      .expect(200);

    const service = async (body: object) =>
      (
        await http()
          .post('/api/care-services')
          .set('Cookie', cookies.admin)
          .send(body)
          .expect(201)
      ).body;
    const bath = await service({
      name: 'Baño completo',
      category: 'GROOMING',
      price: 40,
      sizePrices: [
        { size: 'MEDIUM', price: 55 },
        { size: 'LARGE', price: 70 },
      ],
    });
    expect(bath.sizePrices).toEqual([
      { size: 'MEDIUM', price: 55 },
      { size: 'LARGE', price: 70 },
    ]);
    ids.bath = bath.id;
    ids.nails = (
      await service({ name: 'Corte de uñas', category: 'GROOMING', price: 15 })
    ).id;
    ids.consult = (
      await service({ name: 'Consulta', category: 'CONSULTATION', price: 50 })
    ).id;
    ids.pet = await newPet('Copito', true);
    ids.pet2 = await newPet('Peluche');
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.groomingSession.deleteMany({ where });
      await prisma.cashMovement.deleteMany({ where });
      await prisma.paymentAllocation.deleteMany({
        where: { receipt: { clinicId: { in: clinicIds } } },
      });
      await prisma.payment.deleteMany({ where });
      await prisma.receipt.deleteMany({ where });
      await prisma.cashSession.deleteMany({ where });
      await prisma.cashRegister.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
      await prisma.careService.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  const checkIn = (key: string, body: object) =>
    http().post('/api/grooming').set('Cookie', cookies[key]).send(body);

  it('el ingreso cobra al precio del tamaño y guarda el checklist y la firma', async () => {
    await checkIn('cashier', {
      petId: ids.pet,
      size: 'MEDIUM',
      services: [{ careServiceId: ids.bath }],
    }).expect(403);
    const notGrooming = await checkIn('groomer', {
      petId: ids.pet,
      size: 'MEDIUM',
      services: [{ careServiceId: ids.consult }],
    }).expect(400);
    expect(notGrooming.body.message).toContain('no es un servicio de baño');

    const res = await checkIn('groomer', {
      petId: ids.pet,
      size: 'MEDIUM',
      services: [{ careServiceId: ids.bath }, { careServiceId: ids.nails }],
      fleas: true,
      matting: true,
      skinNotes: 'Irritación detrás de la oreja izquierda',
      belongings: 'Collar rojo',
      instructions: 'Corte cachorro, sin perfume',
      transport: 'PICKUP',
      transportAddress: 'Av. Los Olivos 123, Comas',
      signerName: 'Dueño de Copito',
      signature: `data:image/png;base64,${png().toString('base64')}`,
    }).expect(201);
    ids.session = res.body.id;
    expect(res.body).toMatchObject({
      code: 'GR-00001',
      status: 'WAITING',
      size: 'MEDIUM',
      fleas: true,
      matting: true,
      aggressive: true, // viene de la ficha
      transport: 'PICKUP',
      total: 70,
      pending: 70,
      signerName: 'Dueño de Copito',
    });
    expect(res.body.signature).toMatch(/^data:image\/png;base64,/);
    expect(
      res.body.services.map((s: { description: string }) => s.description),
    ).toEqual(['Baño completo (mediano)', 'Corte de uñas']);

    // Una sola atención abierta por mascota
    await checkIn('reception', {
      petId: ids.pet,
      size: 'MEDIUM',
      services: [{ careServiceId: ids.nails }],
    }).expect(409);
    // Un servicio agregado después en la atención también toma el precio del tamaño
    const extra = await http()
      .post('/api/charges')
      .set('Cookie', cookies.reception)
      .send({
        visitId: res.body.visitId,
        items: [{ careServiceId: ids.bath, quantity: 1 }],
      })
      .expect(201);
    expect(extra.body.charges[0]).toMatchObject({
      description: 'Baño completo (mediano)',
      total: 55,
    });
  });

  it('el tablero avanza, salta pasos y vuelve solo uno atrás', async () => {
    const move = (status: string, key = 'groomer') =>
      http()
        .patch(`/api/grooming/${ids.session}/status`)
        .set('Cookie', cookies[key])
        .send({ status });

    const bathing = await move('BATHING').expect(200);
    expect(bathing.body.groomer).toEqual({
      id: userIds.groomer,
      fullName: 'GROOMER groomer',
    });
    expect(bathing.body.bathingAt).not.toBeNull();
    const back = await move('WAITING').expect(200);
    expect(back.body).toMatchObject({ status: 'WAITING', bathingAt: null });
    await move('CUTTING').expect(200); // baño saltado
    const twoBack = await move('WAITING').expect(409);
    expect(twoBack.body.message).toContain('solo se puede volver a Baño');
    await move('READY').expect(200);
    await move('DELIVERED').expect(400);
    await move('READY', 'cashier').expect(403);

    const notified = await http()
      .post(`/api/grooming/${ids.session}/notify`)
      .set('Cookie', cookies.reception)
      .expect(201);
    expect(notified.body.notifiedAt).not.toBeNull();

    const board = await http()
      .get('/api/grooming')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(board.body.map((c: { id: number }) => c.id)).toContain(ids.session);
    const other = await http()
      .get('/api/grooming')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(other.body).toEqual([]);
    await http()
      .get(`/api/grooming/${ids.session}`)
      .set('Cookie', cookies.other)
      .expect(404);
  });

  it('la atención no se cierra a mano: se entrega desde el tablero y queda por cobrar', async () => {
    const session = await prisma.groomingSession.findUniqueOrThrow({
      where: { id: ids.session },
    });
    await http()
      .post(`/api/visits/${session.visitId}/close`)
      .set('Cookie', cookies.reception)
      .expect(409);

    const res = await http()
      .post(`/api/grooming/${ids.session}/deliver`)
      .set('Cookie', cookies.reception)
      .send({
        pickedUpBy: 'Ana Torres',
        pickedUpDocument: '45678912',
        pickedUpRelation: 'Hija',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'DELIVERED',
      pickedUpBy: 'Ana Torres',
      pending: 125,
      deliveredBy: { id: userIds.reception },
    });
    const visit = await prisma.visit.findUniqueOrThrow({
      where: { id: session.visitId },
    });
    expect(visit).toMatchObject({ status: 'CLOSED', type: 'GROOMING' });
    await http()
      .patch(`/api/grooming/${ids.session}/status`)
      .set('Cookie', cookies.groomer)
      .send({ status: 'READY' })
      .expect(409);

    const history = await http()
      .get(`/api/pets/${ids.pet}/grooming`)
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(history.body[0]).toMatchObject({
      id: ids.session,
      status: 'DELIVERED',
    });
  });

  it('comisiona lo cobrado de sus servicios, con el porcentaje que tenía al entregar', async () => {
    const detail = await http()
      .get(`/api/grooming/${ids.session}`)
      .set('Cookie', cookies.reception)
      .expect(200);
    // Paga 70 de 125: se cubren los cargos más antiguos (baño 55 + uñas 15)
    await http()
      .post('/api/cash/sessions')
      .set('Cookie', cookies.cashier)
      .send({ openingAmount: 0 })
      .expect(201);
    await http()
      .post('/api/cash/receipts')
      .set('Cookie', cookies.cashier)
      .send({
        requestKey: `groom-${stamp}`,
        clientId: detail.body.client.id,
        amount: 70,
        payments: [{ method: 'CASH', amount: 70, tendered: 70 }],
        document: 'NOTE',
      })
      .expect(201);
    // Subirle el porcentaje después no cambia lo ya entregado
    await http()
      .patch(`/api/users/${userIds.groomer}`)
      .set('Cookie', cookies.admin)
      .send({ commissionPercent: 50 })
      .expect(200);

    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
    }).format(new Date());
    const query = `from=${day}&to=${day}`;
    await http()
      .get(`/api/grooming/commissions?${query}`)
      .set('Cookie', cookies.reception)
      .expect(403);
    const res = await http()
      .get(`/api/grooming/commissions?${query}`)
      .set('Cookie', cookies.groomer)
      .expect(200);
    expect(res.body.rows).toEqual([
      {
        groomer: { id: userIds.groomer, fullName: 'GROOMER groomer' },
        currentPercent: 50,
        services: 1,
        paid: 70,
        pending: 55,
        commission: 21,
      },
    ]);
    expect(res.body.lines[0]).toMatchObject({
      code: 'GR-00001',
      percent: 30,
      commission: 21,
    });

    const excel = await http()
      .get(`/api/grooming/commissions/excel?${query}`)
      .set('Cookie', cookies.admin)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((excel.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await http()
      .get('/api/grooming/commissions?from=2026-01-01&to=2026-12-31')
      .set('Cookie', cookies.admin)
      .expect(400);
  });

  it('cancelar quita los cargos; solo recepción o el administrador', async () => {
    const res = await checkIn('reception', {
      petId: ids.pet2,
      size: 'LARGE',
      services: [{ careServiceId: ids.bath }],
    }).expect(201);
    expect(res.body).toMatchObject({
      code: 'GR-00002',
      total: 70,
      aggressive: false,
    });
    await http()
      .post(`/api/grooming/${res.body.id}/deliver`)
      .set('Cookie', cookies.reception)
      .send({ pickedUpBy: 'Dueño', pickedUpRelation: 'Propietario' })
      .expect(409);
    await http()
      .post(`/api/grooming/${res.body.id}/cancel`)
      .set('Cookie', cookies.groomer)
      .send({ reason: 'El dueño se lo llevó' })
      .expect(403);
    const cancelled = await http()
      .post(`/api/grooming/${res.body.id}/cancel`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'El dueño se lo llevó' })
      .expect(201);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'El dueño se lo llevó',
      services: [],
      total: 0,
    });
    const visit = await prisma.visit.findUniqueOrThrow({
      where: { id: res.body.visitId },
    });
    expect(visit.status).toBe('CANCELLED');
    await http()
      .post(`/api/grooming/${res.body.id}/cancel`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Otra vez' })
      .expect(409);
  });
});
