import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { BillingSender } from '../src/billing/billing.sender.js';
import type { Role } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Fase 4: boletas, facturas y notas de crédito por el PSE. La cola de envío se mueve a mano (tick).
describe('Comprobantes electrónicos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sender: BillingSender;
  const stamp = Date.now();
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const ids = { rosa: 0, empresa: 0, consulta: 0 };

  const http = () => request(app.getHttpServer());

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-bill-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${role} ${key}`,
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
  }

  const settings = {
    enabled: true,
    provider: 'SIMULATED',
    production: false,
    legalName: 'Veterinaria Demo S.A.C.',
    apiUrl: null,
    boletaSeries: 'B001',
    facturaSeries: 'F001',
    boletaCreditSeries: 'BC01',
    facturaCreditSeries: 'FC01',
  };
  const configure = (body: Record<string, unknown>) =>
    http()
      .put('/api/billing/settings')
      .set('Cookie', cookies.admin)
      .send({ ...settings, ...body });

  /** Venta de mostrador de una consulta (S/ 50) con el comprobante pedido. */
  const sell = (document: string, clientId?: number, quantity = 1) =>
    http()
      .post('/api/cash/counter-sales')
      .set('Cookie', cookies.cashier)
      .send({
        requestKey: randomUUID(),
        clientId,
        document,
        items: [{ careServiceId: ids.consulta, quantity }],
        payments: [{ method: 'CASH', amount: 50 * quantity }],
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    sender = app.get(BillingSender);

    for (const name of ['Clínica e2e facturación', 'Otra clínica facturación'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'CASHIER', 'cashier');
    await login(mine, 'RECEPTION', 'reception');
    await login(other, 'ADMIN', 'other');

    const dni = String(stamp).slice(-8);
    ids.rosa = (
      await http()
        .post('/api/clients')
        .set('Cookie', cookies.reception)
        .send({
          docType: 'DNI',
          docNumber: dni,
          name: 'Rosa Peña Quispe',
          phone: '987654321',
          consent: true,
        })
        .expect(201)
    ).body.id;
    ids.empresa = (
      await http()
        .post('/api/clients')
        .set('Cookie', cookies.reception)
        .send({
          docType: 'RUC',
          docNumber: '20131312955',
          name: 'Albergue Patitas Felices SAC',
          phone: '956781234',
          address: 'Av. Lima 123, Chosica',
          consent: true,
        })
        .expect(201)
    ).body.id;
    ids.consulta = (
      await http()
        .post('/api/care-services')
        .set('Cookie', cookies.admin)
        .send({ name: 'Consulta general', category: 'CONSULTATION', price: 50 })
        .expect(201)
    ).body.id;
    await http()
      .post('/api/cash/sessions')
      .set('Cookie', cookies.cashier)
      .send({ openingAmount: 100 })
      .expect(201);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.electronicDocument.deleteMany({
        where: { ...where, relatedId: { not: null } },
      });
      await prisma.electronicDocument.deleteMany({ where });
      await prisma.billingSettings.deleteMany({ where });
      await prisma.cashMovement.deleteMany({ where });
      await prisma.paymentAllocation.deleteMany({
        where: { receipt: { clinicId: { in: clinicIds } } },
      });
      await prisma.payment.deleteMany({ where });
      await prisma.receipt.deleteMany({ where });
      await prisma.cashSession.deleteMany({ where });
      await prisma.cashRegister.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.careService.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('sin activar, solo hay notas de venta: pedir boleta no cobra nada', async () => {
    const status = await http()
      .get('/api/billing/status')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(status.body).toMatchObject({ enabled: false, simulated: true });
    const res = await sell('BOLETA', ids.rosa).expect(400);
    expect(res.body.message).toContain('no está activada');
    expect(
      await prisma.receipt.count({ where: { clinicId: clinicIds[0] } }),
    ).toBe(0);
  });

  it('configuración: solo el administrador, el PSE real pide sus datos y el token nunca sale', async () => {
    await http()
      .get('/api/billing/settings')
      .set('Cookie', cookies.cashier)
      .expect(403);
    const missing = await configure({
      provider: 'NUBEFACT',
      apiUrl: 'https://api.nubefact.com/api/v1/ruta',
    }).expect(400);
    expect(missing.body.message).toContain('el RUC de la clínica');
    expect(missing.body.message).toContain('el token del PSE');
    await configure({ apiUrl: 'http://inseguro.pe' }).expect(400);

    const saved = await configure({
      enabled: false,
      provider: 'NUBEFACT',
      apiUrl: 'https://api.nubefact.com/api/v1/ruta',
      apiToken: 'token-secreto-del-pse',
    }).expect(200);
    expect(saved.body).toMatchObject({ hasToken: true, provider: 'NUBEFACT' });
    expect(JSON.stringify(saved.body)).not.toContain('token-secreto-del-pse');
    const row = await prisma.billingSettings.findUniqueOrThrow({
      where: { clinicId: clinicIds[0] },
    });
    expect(row.apiTokenEnc).not.toContain('token-secreto-del-pse');

    // Simulación activa (el token guardado se conserva para cuando llegue el PSE)
    const sim = await configure({
      apiUrl: 'https://api.nubefact.com/api/v1/ruta',
    }).expect(200);
    expect(sim.body).toMatchObject({
      enabled: true,
      provider: 'SIMULATED',
      hasToken: true,
      missing: [],
    });
    const test = await http()
      .post('/api/billing/settings/test')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(test.body.message).toContain('Simulación');
  });

  it('boleta con DNI: se numera B001-00000001 al cobrar y la cola la deja aceptada', async () => {
    const res = await sell('BOLETA', ids.rosa).expect(201);
    expect(res.body.receipt.document).toMatchObject({
      type: 'BOLETA',
      code: 'B001-00000001',
      status: 'PENDING',
      legalName: 'Veterinaria Demo S.A.C.',
      customer: { docType: '1', name: 'Rosa Peña Quispe' },
      totals: { taxed: 42.37, igv: 7.63, total: 50 },
      amountInWords: 'SON: CINCUENTA CON 00/100 SOLES',
      simulated: true,
    });
    expect(await sender.tick()).toBe(1);
    const ticket = await http()
      .get(`/api/cash/receipts/${res.body.receipt.id}`)
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(ticket.body.document.status).toBe('ACCEPTED');
    expect(ticket.body.document.qrText).toContain('|03|B001|1|7.63|50.00|');
  });

  it('factura solo con RUC; "clientes varios" va con boleta sin documento', async () => {
    const noRuc = await sell('FACTURA', ids.rosa).expect(400);
    expect(noRuc.body.message).toContain('RUC');
    const factura = await sell('FACTURA', ids.empresa).expect(201);
    expect(factura.body.receipt.document).toMatchObject({
      code: 'F001-00000001',
      customer: {
        docType: '6',
        docNumber: '20131312955',
        address: 'Av. Lima 123, Chosica',
      },
    });
    const varios = await sell('BOLETA').expect(201);
    expect(varios.body.receipt.document).toMatchObject({
      code: 'B001-00000002',
      customer: { docType: '-', docNumber: '-', name: 'CLIENTES VARIOS' },
    });
    await sender.tick();
  });

  it('anular un cobro con boleta emite su nota de crédito BC01', async () => {
    const sale = await sell('BOLETA', ids.rosa).expect(201);
    await sender.tick();
    const voided = await http()
      .post(`/api/cash/receipts/${sale.body.receipt.id}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Cobro duplicado' })
      .expect(201);
    expect(voided.body.document.creditNote).toEqual({
      code: 'BC01-00000001',
      status: 'PENDING',
    });
    await sender.tick();
    const list = await http()
      .get('/api/billing/documents?type=CREDIT_NOTE')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(list.body.items[0]).toMatchObject({
      code: 'BC01-00000001',
      status: 'ACCEPTED',
      related: 'B001-00000003',
      total: 50,
    });
  });

  describe('con el PSE (Nubefact)', () => {
    let fetchMock: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      await prisma.clinic.update({
        where: { id: clinicIds[0] },
        data: { ruc: '20601234561' },
      });
      await configure({
        provider: 'NUBEFACT',
        apiUrl: 'https://api.nubefact.com/api/v1/ruta',
      }).expect(200);
      fetchMock = vi.spyOn(globalThis, 'fetch');
    });

    it('si el PSE está caído, cobra igual, queda en error y se reprograma; al volver, sale', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const sale = await sell('BOLETA', ids.rosa).expect(201);
      expect(sale.body.receipt.document.code).toBe('B001-00000004');
      await sender.tick();
      const [failed] = (
        await http()
          .get('/api/billing/documents?status=PROBLEMS')
          .set('Cookie', cookies.cashier)
          .expect(200)
      ).body.items;
      expect(failed).toMatchObject({
        code: 'B001-00000004',
        status: 'ERROR',
        attempts: 1,
      });
      expect(failed.lastError).toContain('El PSE no respondió');
      expect(new Date(failed.nextAttemptAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
      // El token viajó descifrado en la cabecera
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Token token="token-secreto-del-pse"',
      );

      // Una nota de crédito espera a que su boleta llegue a SUNAT
      await http()
        .post(`/api/cash/receipts/${sale.body.receipt.id}/void`)
        .set('Cookie', cookies.admin)
        .send({ reason: 'Error de cobro' })
        .expect(201);
      await http()
        .post(`/api/billing/documents/${failed.id}/retry`)
        .set('Cookie', cookies.cashier)
        .expect(403);
      await http()
        .post(`/api/billing/documents/${failed.id}/retry`)
        .set('Cookie', cookies.admin)
        .expect(200);
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            aceptada_por_sunat: true,
            codigo_hash: 'HASH123',
            enlace_del_pdf: 'https://nubefact/pdf/1',
          }),
          { status: 200 },
        ),
      );
      await sender.tick();
      const docs = (
        await http()
          .get('/api/billing/documents')
          .set('Cookie', cookies.admin)
          .expect(200)
      ).body.items;
      const boleta = docs.find(
        (d: { code: string }) => d.code === 'B001-00000004',
      );
      const note = docs.find(
        (d: { related: string | null }) => d.related === 'B001-00000004',
      );
      expect(boleta).toMatchObject({
        status: 'ACCEPTED',
        attempts: 2,
        pdfUrl: 'https://nubefact/pdf/1',
      });
      // En el mismo ciclo la boleta salió primero y luego su nota
      expect(note).toMatchObject({ code: 'BC01-00000002' });
      await sender.tick();
      fetchMock.mockReset();
    });

    it('lo que SUNAT rechaza no se reenvía y avisa en la campana', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            aceptada_por_sunat: false,
            sunat_responsecode: '2017',
            sunat_description: 'El RUC no existe',
          }),
          { status: 200 },
        ),
      );
      const sale = await sell('FACTURA', ids.empresa).expect(201);
      await sender.tick();
      const doc = await prisma.electronicDocument.findFirstOrThrow({
        where: { receiptId: sale.body.receipt.id },
      });
      expect(doc).toMatchObject({
        status: 'REJECTED',
        sunatDescription: 'El RUC no existe',
        nextAttemptAt: null,
      });
      await http()
        .post(`/api/billing/documents/${doc.id}/retry`)
        .set('Cookie', cookies.admin)
        .expect(409);
      const alerts = await http()
        .get('/api/dashboard/alerts')
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(alerts.body).toContainEqual(
        expect.objectContaining({ kind: 'billing', count: 1 }),
      );
    });
  });

  it('registro de ventas en Excel: las notas de crédito restan', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
    }).format(new Date());
    const res = await http()
      .get(`/api/billing/report?from=${today}&to=${today}`)
      .set('Cookie', cookies.admin)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as never);
    const rows = book.worksheets[0].getSheetValues().slice(2) as unknown[][];
    const codes = rows.map((r) => r[3]);
    expect(codes).toContain('B001-00000001');
    const note = rows.find((r) => r[3] === 'BC01-00000001')!;
    expect(note[11]).toBe(-50);
    expect(note[13]).toBe('B001-00000003');
  });

  it('cada clínica ve solo sus comprobantes', async () => {
    const other = await http()
      .get('/api/billing/documents')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(other.body.total).toBe(0);
    const mine = await prisma.electronicDocument.findFirstOrThrow({
      where: { clinicId: clinicIds[0] },
    });
    await http()
      .post(`/api/billing/documents/${mine.id}/retry`)
      .set('Cookie', cookies.other)
      .expect(404);
  });
});
