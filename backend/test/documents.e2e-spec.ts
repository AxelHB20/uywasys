import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER';

/** PNG válido de 1×1 relleno hasta el tamaño pedido (para la firma) */
function png(size = 2000): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([header, Buffer.alloc(size - header.length, 7)]);
}
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF',
);

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Adjuntos y consentimientos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const ids = { pet: 0, visit: 0, attachment: 0, consent: 0 };

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-docs-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
        email,
        role,
        licenseNumber: role === 'VET' ? 'CMVP-55' : null,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['Clínica e2e documentos', 'Otra clínica documentos'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'CASHIER', 'cashier');
    await login(other, 'ADMIN', 'other');

    const res = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        name: 'Rosa Quispe',
        phone: '987654321',
        consent: true,
        pet: { name: 'Toby', species: 'DOG', breed: 'Mestizo' },
      })
      .expect(201);
    ids.pet = res.body.pets[0].id;
    ids.visit = (
      await http()
        .post('/api/visits')
        .set('Cookie', cookies.vet)
        .send({ petId: ids.pet })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.consent.deleteMany({ where });
      await prisma.attachment.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('sube un PDF a la atención y lo devuelve tal cual; rechaza lo que no es foto ni PDF', async () => {
    await http()
      .post(`/api/pets/${ids.pet}/attachments`)
      .set('Cookie', cookies.cashier)
      .field('kind', 'LAB')
      .field('title', 'Hemograma')
      .attach('file', pdf, 'hemograma.pdf')
      .expect(403);
    const bad = await http()
      .post(`/api/pets/${ids.pet}/attachments`)
      .set('Cookie', cookies.reception)
      .field('kind', 'LAB')
      .field('title', 'Virus')
      .attach('file', Buffer.from('MZ fake exe'), 'resultado.pdf')
      .expect(400);
    expect(bad.body.message).toContain('fotos');

    const res = await http()
      .post(`/api/pets/${ids.pet}/attachments`)
      .set('Cookie', cookies.reception)
      .field('kind', 'LAB')
      .field('title', 'Hemograma completo')
      .field('visitId', String(ids.visit))
      .attach('file', pdf, 'Hemograma Toby ñ.pdf')
      .expect(201);
    ids.attachment = res.body.id;
    expect(res.body).toMatchObject({
      mime: 'application/pdf',
      fileName: 'Hemograma Toby n.pdf',
      visitId: ids.visit,
      size: pdf.length,
    });

    // Caja no abre la historia clínica
    await http()
      .get(`/api/attachments/${ids.attachment}/file`)
      .set('Cookie', cookies.cashier)
      .expect(403);
    const file = await http()
      .get(`/api/attachments/${ids.attachment}/file`)
      .set('Cookie', cookies.reception)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect((file.body as Buffer).equals(pdf)).toBe(true);

    await http()
      .get(`/api/attachments/${ids.attachment}/file`)
      .set('Cookie', cookies.other)
      .expect(404);
    const list = await http()
      .get(`/api/pets/${ids.pet}/attachments?visitId=${ids.visit}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('un archivo equivocado se anula (quien lo subió o el administrador)', async () => {
    await http()
      .post(`/api/attachments/${ids.attachment}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'No es de este paciente' })
      .expect(403);
    const res = await http()
      .post(`/api/attachments/${ids.attachment}/void`)
      .set('Cookie', cookies.reception)
      .send({ reason: 'No es de este paciente' })
      .expect(201);
    expect(res.body.voidReason).toBe('No es de este paciente');
  });

  it('arma el texto del consentimiento con los datos del paciente', async () => {
    await http()
      .get(`/api/consents/template?type=SURGERY&petId=${ids.pet}`)
      .set('Cookie', cookies.reception)
      .expect(403);
    const res = await http()
      .get(
        `/api/consents/template?type=SURGERY&petId=${ids.pet}&procedure=Castración`,
      )
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(res.body.title).toBe('Consentimiento informado para cirugía');
    expect(res.body.text).toContain('Yo, Rosa Quispe');
    expect(res.body.text).toContain('Toby (perro, Mestizo)');
    expect(res.body.text).toContain('Procedimiento: Castración.');
    expect(res.body.text).toContain('Clínica e2e documentos');
  });

  it('firma el consentimiento: guarda texto, firma y un hash verificable', async () => {
    const text =
      'Yo, Rosa Quispe, autorizo la castración de Toby. Entiendo los riesgos de la anestesia y la cirugía.';
    const signature = `data:image/png;base64,${png().toString('base64')}`;
    const base = {
      petId: ids.pet,
      visitId: ids.visit,
      type: 'SURGERY',
      procedure: 'Castración',
      text,
      signerName: 'Rosa Quispe',
      signerDocument: '45678912',
      signerRelation: 'Propietaria',
    };
    await http()
      .post('/api/consents')
      .set('Cookie', cookies.reception)
      .send({ ...base, signature })
      .expect(403);
    // Sin trazo (PNG casi vacío) no hay firma
    await http()
      .post('/api/consents')
      .set('Cookie', cookies.vet)
      .send({
        ...base,
        signature: `data:image/png;base64,${png(100).toString('base64')}`,
      })
      .expect(400);

    const res = await http()
      .post('/api/consents')
      .set('Cookie', cookies.vet)
      .send({ ...base, signature })
      .expect(201);
    ids.consent = res.body.id;
    expect(res.body).toMatchObject({
      code: 'CI-00001',
      text,
      signature,
      vet: { licenseNumber: 'CMVP-55' },
      pet: { name: 'Toby' },
    });
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          type: 'SURGERY',
          procedure: 'Castración',
          text,
          signerName: 'Rosa Quispe',
          signerDocument: '45678912',
          signerRelation: 'Propietaria',
          petId: ids.pet,
          signedAt: new Date(res.body.signedAt).toISOString(),
          signature: png().toString('base64'),
        }),
      )
      .digest('hex');
    expect(res.body.hash).toBe(expected);

    await http()
      .get(`/api/pets/${ids.pet}/consents`)
      .set('Cookie', cookies.cashier)
      .expect(403);
    const list = await http()
      .get(`/api/pets/${ids.pet}/consents`)
      .set('Cookie', cookies.reception)
      .expect(200);
    expect(list.body[0]).toMatchObject({
      code: 'CI-00001',
      signerName: 'Rosa Quispe',
    });
    await http()
      .get(`/api/consents/${ids.consent}`)
      .set('Cookie', cookies.other)
      .expect(404);
  });

  it('se anula con motivo; no se edita', async () => {
    const res = await http()
      .post(`/api/consents/${ids.consent}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Se firmó con el procedimiento equivocado' })
      .expect(201);
    expect(res.body.voidReason).toBe(
      'Se firmó con el procedimiento equivocado',
    );
    await http()
      .post(`/api/consents/${ids.consent}/void`)
      .set('Cookie', cookies.vet)
      .send({ reason: 'Otra vez' })
      .expect(409);
  });

  it('acepta la foto comprimida (WebP) y el administrador ve cuánto ocupan los archivos', async () => {
    // Cabecera mínima de un WebP: así llega lo que comprime la web
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x24, 0, 0, 0]),
      Buffer.from('WEBPVP8 '),
      Buffer.alloc(32),
    ]);
    const photo = await http()
      .post(`/api/pets/${ids.pet}/attachments`)
      .set('Cookie', cookies.reception)
      .field('kind', 'PHOTO')
      .field('title', 'Herida pata')
      .attach('file', webp, 'herida.webp')
      .expect(201);
    expect(photo.body).toMatchObject({
      mime: 'image/webp',
      fileName: 'herida.webp',
    });

    await http()
      .get('/api/clinic/storage')
      .set('Cookie', cookies.reception)
      .expect(403);
    const usage = await http()
      .get('/api/clinic/storage')
      .set('Cookie', cookies.admin)
      .expect(200);
    const files = await prisma.attachment.aggregate({
      where: { clinicId: clinicIds[0] },
      _count: true,
      _sum: { size: true },
    });
    expect(usage.body.attachments).toEqual({
      count: files._count,
      bytes: files._sum.size,
    });
    expect(usage.body.totalBytes).toBeGreaterThanOrEqual(files._sum.size ?? 0);
    // Otra clínica no suma lo de esta
    const other = await http()
      .get('/api/clinic/storage')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(other.body.attachments.count).toBe(0);
  });
});
