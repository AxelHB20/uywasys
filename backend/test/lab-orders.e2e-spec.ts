import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Exámenes de laboratorio (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clinicId: number;
  let clientId: number;
  let visitId: number;
  let hemograma: number;
  let bioquimico: number;
  let consulta: number;
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const as = (role: string) => ({ Cookie: cookies[role] });

  async function login(role: 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER') {
    const email = `${role.toLowerCase()}-lab-${stamp}@uywa.pe`;
    const user = await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} Lab`,
        email,
        role,
        licenseNumber: role === 'VET' ? '12345' : null,
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
    clinicId = (await prisma.clinic.create({ data: { name: 'Clínica Lab' } }))
      .id;
    const vetId = await login('VET');
    await login('RECEPTION');
    await login('CASHIER');
    const service = (
      name: string,
      category: 'LAB' | 'CONSULTATION',
      price: number,
    ) =>
      prisma.careService
        .create({ data: { clinicId, name, category, price } })
        .then((s) => s.id);
    hemograma = await service('Hemograma', 'LAB', 45);
    bioquimico = await service('Perfil bioquímico', 'LAB', 80);
    consulta = await service('Consulta', 'CONSULTATION', 50);
    const client = await prisma.client.create({
      data: {
        clinicId,
        number: 1,
        name: 'Ana Torres',
        phone: '987000333',
        consentAt: new Date(),
        consentVersion: 'test',
        consentChannel: 'FORM',
        searchText: 'ana torres 987000333',
        pets: {
          create: {
            clinicId,
            number: 1,
            name: 'Kira',
            nameSearch: 'kira',
            species: 'DOG',
          },
        },
      },
      include: { pets: true },
    });
    clientId = client.id;
    visitId = (
      await prisma.visit.create({
        data: {
          clinicId,
          petId: client.pets[0].id,
          clientId,
          attendedById: vetId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('el veterinario pide un perfil: un pedido, un cargo por examen en la cuenta', async () => {
    await http()
      .post(`/api/visits/${visitId}/lab-orders`)
      .set(as('RECEPTION'))
      .send({
        careServiceIds: [hemograma],
        destination: 'IN_HOUSE',
        charge: true,
      })
      .expect(403);
    const notLab = await http()
      .post(`/api/visits/${visitId}/lab-orders`)
      .set(as('VET'))
      .send({
        careServiceIds: [consulta],
        destination: 'IN_HOUSE',
        charge: true,
      })
      .expect(400);
    expect(notLab.body.message).toContain('Laboratorio');

    const res = await http()
      .post(`/api/visits/${visitId}/lab-orders`)
      .set(as('VET'))
      .send({
        careServiceIds: [hemograma, bioquimico],
        destination: 'EXTERNAL',
        externalLab: 'Lab Central',
        labCost: 70,
        indication: 'Prequirúrgico',
        charge: true,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      code: 'EX-00001',
      status: 'REQUESTED',
      externalLab: 'Lab Central',
      labCost: 70,
      total: 125,
      overdue: false,
    });
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Hemograma',
      'Perfil bioquímico',
    ]);
    const account = await http()
      .get(`/api/clients/${clientId}/account`)
      .set(as('CASHIER'))
      .expect(200);
    expect(JSON.stringify(account.body)).toContain('Hemograma');
  });

  it('muestra → resultado (PDF) → revisión del veterinario → aviso al dueño', async () => {
    const [order] = (
      await http()
        .get('/api/lab-orders?status=pending')
        .set(as('RECEPTION'))
        .expect(200)
    ).body.items;
    await http()
      .post(`/api/lab-orders/${order.id}/sample`)
      .set(as('RECEPTION'))
      .expect(200);
    // Sin archivo ni valores no hay resultado
    await http()
      .post(`/api/lab-orders/${order.id}/result`)
      .set(as('RECEPTION'))
      .expect(400);
    // No se avisa al dueño sin revisión
    await http()
      .post(`/api/lab-orders/${order.id}/notified`)
      .set(as('RECEPTION'))
      .expect(403);
    const ready = await http()
      .post(`/api/lab-orders/${order.id}/result`)
      .set(as('RECEPTION'))
      .field('resultText', 'Hto 38 %')
      .attach('file', pdf, 'resultado.pdf')
      .expect(200);
    expect(ready.body).toMatchObject({
      status: 'RESULT_READY',
      resultText: 'Hto 38 %',
    });
    expect(ready.body.attachment.mime).toBe('application/pdf');
    // El resultado queda en la historia como "Análisis" de la atención
    const files = await http()
      .get(`/api/pets/${order.pet.id}/attachments?visitId=${visitId}`)
      .set(as('VET'))
      .expect(200);
    expect(files.body[0]).toMatchObject({ kind: 'LAB' });

    // En "Necesita atención" del veterinario
    const alerts = await http()
      .get('/api/dashboard/alerts')
      .set(as('VET'))
      .expect(200);
    expect(alerts.body).toContainEqual(
      expect.objectContaining({
        kind: 'labReview',
        count: 1,
        link: '/examenes',
      }),
    );
    // Al veterinario le llega el aviso
    const bell = await http()
      .get('/api/notifications')
      .set(as('VET'))
      .expect(200);
    expect(
      bell.body.events.some((e: { kind: string }) => e.kind === 'labResult'),
    ).toBe(true);

    await http()
      .post(`/api/lab-orders/${order.id}/review`)
      .set(as('RECEPTION'))
      .send({ interpretation: 'Normal' })
      .expect(403);
    const reviewed = await http()
      .post(`/api/lab-orders/${order.id}/review`)
      .set(as('VET'))
      .send({ interpretation: 'Valores normales, apto para cirugía' })
      .expect(200);
    expect(reviewed.body).toMatchObject({
      status: 'REVIEWED',
      reviewedBy: 'VET Lab',
    });
    const notified = await http()
      .post(`/api/lab-orders/${order.id}/notified`)
      .set(as('RECEPTION'))
      .expect(200);
    expect(notified.body.notifiedAt).toBeTruthy();
  });

  it('cancelar un pedido sin resultado quita sus cargos; caja no ve exámenes', async () => {
    const order = (
      await http()
        .post(`/api/visits/${visitId}/lab-orders`)
        .set(as('VET'))
        .send({
          careServiceIds: [hemograma],
          destination: 'IN_HOUSE',
          charge: true,
        })
        .expect(201)
    ).body;
    const cancelled = await http()
      .post(`/api/lab-orders/${order.id}/cancel`)
      .set(as('VET'))
      .send({ reason: 'El dueño no aceptó' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', total: 0 });
    await http().get('/api/lab-orders').set(as('CASHIER')).expect(403);
    await http()
      .get(`/api/visits/${visitId}/lab-orders`)
      .set(as('CASHIER'))
      .expect(403);
  });

  it('lista: números por pestaña, búsqueda por mascota, dueño o código, lugar y "ver más"', async () => {
    for (let i = 0; i < 2; i++)
      await http()
        .post(`/api/visits/${visitId}/lab-orders`)
        .set(as('VET'))
        .send({
          careServiceIds: [hemograma],
          destination: i ? 'EXTERNAL' : 'IN_HOUSE',
          externalLab: i ? 'Lab. Central' : null,
          charge: false,
        })
        .expect(201);
    const all = (
      await http()
        .get('/api/lab-orders?status=pending')
        .set(as('RECEPTION'))
        .expect(200)
    ).body;
    expect(all.counts.pending).toBe(all.items.length);
    expect(all.counts.pending).toBeGreaterThanOrEqual(2);
    expect(all.counts).toMatchObject({ overdue: 0 });
    expect(all.items[0].pet).toMatchObject({ name: 'Kira', breed: null });
    const page = (
      await http()
        .get('/api/lab-orders?status=pending&take=1')
        .set(as('RECEPTION'))
        .expect(200)
    ).body;
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    const next = (
      await http()
        .get('/api/lab-orders?status=pending&take=1&skip=1')
        .set(as('RECEPTION'))
        .expect(200)
    ).body;
    expect(next.items[0].id).not.toBe(page.items[0].id);
    const byCode = (
      await http()
        .get(`/api/lab-orders?status=all&q=${page.items[0].code}`)
        .set(as('RECEPTION'))
        .expect(200)
    ).body;
    expect(byCode.items.map((o: { id: number }) => o.id)).toEqual([
      page.items[0].id,
    ]);
    for (const q of ['kira', 'Ana Tórres', '987000333'])
      expect(
        (
          await http()
            .get(`/api/lab-orders?status=pending&q=${encodeURIComponent(q)}`)
            .set(as('RECEPTION'))
            .expect(200)
        ).body.items.length,
      ).toBe(all.items.length);
    const none = (
      await http()
        .get('/api/lab-orders?status=pending&q=nadie')
        .set(as('RECEPTION'))
        .expect(200)
    ).body;
    expect(none).toMatchObject({ items: [], counts: { pending: 0 } });
    const external = (
      await http()
        .get('/api/lab-orders?status=pending&destination=EXTERNAL')
        .set(as('RECEPTION'))
        .expect(200)
    ).body;
    expect(
      external.items.every(
        (o: { destination: string }) => o.destination === 'EXTERNAL',
      ),
    ).toBe(true);
    expect(external.counts.pending).toBe(external.items.length);
    // Demorado: 3 días o más sin resultado
    await prisma.labOrder.update({
      where: { id: all.items[0].id },
      data: { requestedAt: new Date(Date.now() - 4 * 86_400_000) },
    });
    const late = (
      await http()
        .get('/api/lab-orders?status=pending')
        .set(as('RECEPTION'))
        .expect(200)
    ).body;
    expect(late.counts.overdue).toBe(1);
    expect(late.items[0]).toMatchObject({ id: all.items[0].id, overdue: true });
    await http()
      .get('/api/lab-orders?take=500')
      .set(as('RECEPTION'))
      .expect(400);
  });

  it('cancelar un examen ya pagado: se cancela y el cobro se queda', async () => {
    const order = (
      await http()
        .post(`/api/visits/${visitId}/lab-orders`)
        .set(as('VET'))
        .send({
          careServiceIds: [hemograma],
          destination: 'EXTERNAL',
          externalLab: 'Lab. Central',
          charge: true,
        })
        .expect(201)
    ).body;
    expect(order.total).toBeGreaterThan(0);
    const item = await prisma.labOrderItem.findFirstOrThrow({
      where: { labOrderId: order.id },
    });
    const charge = await prisma.charge.update({
      where: { id: item.chargeId! },
      data: { status: 'PAID', paidAmount: order.total },
    });
    const cancelled = await http()
      .post(`/api/lab-orders/${order.id}/cancel`)
      .set(as('VET'))
      .send({ reason: 'El laboratorio perdió la muestra' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      total: order.total,
      paid: order.total,
    });
    const after = await prisma.charge.findUniqueOrThrow({
      where: { id: charge.id },
    });
    expect(after.status).toBe('PAID');
    // Recepción no cancela
    await http()
      .post(`/api/lab-orders/${order.id}/cancel`)
      .set(as('RECEPTION'))
      .send({ reason: 'x' })
      .expect(403);
  });

  it('una atención cerrada no recibe pedidos nuevos', async () => {
    await prisma.visit.update({
      where: { id: visitId },
      data: { status: 'CLOSED' },
    });
    await http()
      .post(`/api/visits/${visitId}/lab-orders`)
      .set(as('VET'))
      .send({
        careServiceIds: [hemograma],
        destination: 'IN_HOUSE',
        charge: false,
      })
      .expect(409);
  });
});
