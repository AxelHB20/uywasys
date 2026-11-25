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
import { BillingHealthChecker } from '../src/billing/billing-health.checker.js';
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
        // "admin" es la cuenta de soporte técnico: la única que configura la facturación
        isSupport: key === 'admin',
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
    await login(mine, 'ADMIN', 'owner');
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
    // Lucode no pide ruta: va al sandbox o a producción según "Producción"
    const lucode = await configure({ provider: 'LUCODE', apiUrl: null }).expect(
      400,
    );
    expect(lucode.body.message).toContain('el token del PSE');
    expect(lucode.body.message).not.toContain('la ruta del PSE');
    // Mifact pide dirección fiscal y ubigeo; la ruta solo en producción (sin ruta usa su demo)
    const mifact = await configure({ provider: 'MIFACT', apiUrl: null }).expect(
      400,
    );
    expect(mifact.body.message).toContain('la dirección fiscal');
    expect(mifact.body.message).toContain('el ubigeo');
    expect(mifact.body.message).not.toContain('ruta');
    const mifactProd = await configure({
      provider: 'MIFACT',
      production: true,
      apiUrl: null,
    }).expect(400);
    expect(mifactProd.body.message).toContain('la ruta de producción');
    await configure({ provider: 'MIFACT', ubigeo: '1501' }).expect(400);
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

    // La boleta anulada lo dice, y se encuentra por su número o por "Anuladas"
    const annulled = await http()
      .get('/api/billing/documents?status=ANNULLED')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(annulled.body.items).toHaveLength(1);
    expect(annulled.body.items[0]).toMatchObject({
      code: 'B001-00000003',
      annulledBy: { code: 'BC01-00000001' },
    });
    const found = await http()
      .get('/api/billing/documents?q=B001-3')
      .set('Cookie', cookies.cashier)
      .expect(200);
    expect(found.body.items.map((d: { code: string }) => d.code)).toEqual([
      'B001-00000003',
    ]);
    // El resumen resta la nota de crédito
    const all = await http()
      .get('/api/billing/documents')
      .set('Cookie', cookies.cashier)
      .expect(200);
    const sum = all.body.summary;
    expect(sum.annulled).toBe(1);
    expect(sum.creditNotes).toEqual({ count: 1, amount: 50 });
    expect(sum.net).toBe(
      Math.round((sum.boletas.amount + sum.facturas.amount - 50) * 100) / 100,
    );

    // En la caja, la devolución nombra la boleta, no la nota de venta interna
    const session = await http()
      .get('/api/cash/sessions/current')
      .set('Cookie', cookies.cashier)
      .expect(200);
    const refund = session.body.movements.find(
      (m: { kind: string }) => m.kind === 'REFUND',
    );
    expect(refund).toMatchObject({
      receiptCode: 'B001-00000003',
      reason: 'Cobro duplicado',
    });
  });

  describe('con el PSE (Nubefact)', () => {
    let fetchMock: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      await prisma.clinic.update({
        where: { id: clinicIds[0] },
        data: { ruc: '20601234561' },
      });
      fetchMock = vi.spyOn(globalThis, 'fetch');
      // Al activar el PSE se prueba la conexión antes de guardar
      fetchMock.mockResolvedValueOnce(nubefactNotFound());
      await configure({
        provider: 'NUBEFACT',
        apiUrl: 'https://api.nubefact.com/api/v1/ruta',
      }).expect(200);
      fetchMock.mockReset();
    });

    /** Respuesta de Nubefact a la consulta de prueba: el token vale, el comprobante no existe */
    const nubefactNotFound = () =>
      new Response(
        JSON.stringify({ errors: 'El documento no existe', codigo: 24 }),
        { status: 200 },
      );

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
    it('solo soporte técnico ve y cambia la facturación (token incluido); el token se prueba antes de guardar', async () => {
      const denied = await http()
        .put('/api/billing/settings')
        .set('Cookie', cookies.owner)
        .send({ ...settings, provider: 'NUBEFACT' })
        .expect(403);
      expect(denied.body.message).toContain('soporte técnico');
      // El RUC tampoco: va en cada comprobante
      const ruc = await http()
        .patch('/api/clinic')
        .set('Cookie', cookies.owner)
        .send({ name: 'Clínica e2e facturación', ruc: '20100066603' })
        .expect(403);
      expect(ruc.body.message).toContain('soporte técnico');

      // El dueño no ve la configuración ni maneja el token
      for (const [method, path] of [
        ['get', '/api/billing/settings'],
        ['put', '/api/billing/settings/token'],
        ['post', '/api/billing/settings/test'],
      ] as const)
        await http()
          [method](path)
          .set('Cookie', cookies.owner)
          .send({ apiToken: 'token-del-dueno-123' })
          .expect(403);

      const before = await prisma.billingSettings.findUniqueOrThrow({
        where: { clinicId: clinicIds[0] },
      });
      // Token malo: el PSE lo rechaza y no se guarda nada
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
      const bad = await http()
        .put('/api/billing/settings/token')
        .set('Cookie', cookies.admin)
        .send({ apiToken: 'token-equivocado' })
        .expect(400);
      expect(bad.body.message).toContain('No se guardó');
      expect(
        (
          await prisma.billingSettings.findUniqueOrThrow({
            where: { clinicId: clinicIds[0] },
          })
        ).apiTokenEnc,
      ).toBe(before.apiTokenEnc);

      fetchMock.mockResolvedValueOnce(nubefactNotFound());
      await http()
        .put('/api/billing/settings/token')
        .set('Cookie', cookies.admin)
        .send({ apiToken: 'token-secreto-del-pse' })
        .expect(200);
      const after = await prisma.billingSettings.findUniqueOrThrow({
        where: { clinicId: clinicIds[0] },
      });
      expect(after.apiTokenEnc).not.toBe(before.apiTokenEnc);
      // El dueño no recibe avisos de cambios de configuración
      const bell = await http()
        .get('/api/notifications')
        .set('Cookie', cookies.owner)
        .expect(200);
      expect(
        bell.body.events.some(
          (e: { kind: string }) => e.kind === 'billingConfig',
        ),
      ).toBe(false);
      await http()
        .put('/api/billing/settings/token')
        .set('Cookie', cookies.cashier)
        .send({ apiToken: 'token-secreto-del-pse' })
        .expect(403);
      fetchMock.mockReset();
    });

    it('con comprobantes sin respuesta no se cambia de proveedor; "Reintentar todos" los reenvía', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const sale = await sell('BOLETA', ids.rosa).expect(201);
      await sender.tick();
      const locked = await configure({ provider: 'SIMULATED' }).expect(409);
      expect(locked.body.message).toContain('sin respuesta de SUNAT');

      const retried = await http()
        .post('/api/billing/documents/retry-all')
        .set('Cookie', cookies.owner)
        .expect(200);
      expect(retried.body.count).toBe(1);
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ aceptada_por_sunat: true, codigo_hash: 'H2' }),
          { status: 200 },
        ),
      );
      await sender.tick();
      const doc = await prisma.electronicDocument.findFirstOrThrow({
        where: { receiptId: sale.body.receipt.id },
      });
      expect(doc.status).toBe('ACCEPTED');
      fetchMock.mockReset();
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

  describe('datos del comprador en el cobro', () => {
    const osys = {
      docType: 'RUC',
      docNumber: '20601847834',
      name: 'OSYS COMPANY S.A.C.',
      address: 'Calle Melchormalo 125, Surco',
      email: 'conta@osys.pe',
    };
    const sale = (body: Record<string, unknown>, quantity = 1) =>
      http()
        .post('/api/cash/counter-sales')
        .set('Cookie', cookies.cashier)
        .send({
          requestKey: randomUUID(),
          items: [{ careServiceId: ids.consulta, quantity }],
          payments: [{ method: 'CASH', amount: 50 * quantity }],
          ...body,
        });

    it('cliente varios pide factura: sale con el RUC escrito y no se guarda en ningún cliente', async () => {
      const bad = await sale({
        document: 'FACTURA',
        buyer: { ...osys, docNumber: '20601847835' },
      }).expect(400);
      expect(JSON.stringify(bad.body)).toContain('RUC no es válido');
      const res = await sale({ document: 'FACTURA', buyer: osys }).expect(201);
      expect(res.body.receipt.document).toMatchObject({
        type: 'FACTURA',
        customer: {
          docType: '6',
          docNumber: '20601847834',
          name: 'OSYS COMPANY S.A.C.',
        },
      });
      const doc = await prisma.electronicDocument.findUniqueOrThrow({
        where: { id: res.body.receipt.document.id },
      });
      expect(doc.customerEmail).toBe('conta@osys.pe');
      expect(
        await prisma.client.count({ where: { invoiceRuc: '20601847834' } }),
      ).toBe(0);
    });

    it('cliente con DNI factura a su empresa: se guarda en su ficha y la próxima vez sale solo', async () => {
      const none = await http()
        .get(`/api/billing/buyer/${ids.rosa}`)
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(none.body).toEqual({});
      await sale({
        document: 'FACTURA',
        clientId: ids.rosa,
        buyer: osys,
      }).expect(201);
      const rosa = await prisma.client.findUniqueOrThrow({
        where: { id: ids.rosa },
      });
      // Su DNI no se toca: el RUC va en sus datos de facturación
      expect(rosa).toMatchObject({
        docType: 'DNI',
        invoiceRuc: '20601847834',
        invoiceName: 'OSYS COMPANY S.A.C.',
        invoiceEmail: 'conta@osys.pe',
      });
      const proposed = await http()
        .get(`/api/billing/buyer/${ids.rosa}`)
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(proposed.body).toMatchObject({
        docNumber: '20601847834',
        name: 'OSYS COMPANY S.A.C.',
      });
      // Segunda factura sin escribir nada
      const again = await sale({
        document: 'FACTURA',
        clientId: ids.rosa,
      }).expect(201);
      expect(again.body.receipt.document.customer.docNumber).toBe(
        '20601847834',
      );
    });

    it('la ficha edita los datos de facturación: RUC válido, razón social obligatoria, se pueden borrar', async () => {
      const patch = (body: Record<string, unknown>) =>
        http()
          .patch(`/api/clients/${ids.rosa}`)
          .set('Cookie', cookies.reception)
          .send(body);
      await patch({ invoiceRuc: '20601847835' }).expect(400);
      const noName = await patch({
        invoiceRuc: '20100070970',
        invoiceName: null,
      }).expect(400);
      expect(noName.body.message).toContain('razón social');
      const ok = await patch({
        invoiceRuc: '20100070970',
        invoiceName: 'Otra Empresa SAC',
      }).expect(200);
      expect(ok.body).toMatchObject({
        invoiceRuc: '20100070970',
        invoiceName: 'Otra Empresa SAC',
      });
      const cleared = await patch({ invoiceRuc: null }).expect(200);
      expect(cleared.body).toMatchObject({
        invoiceRuc: null,
        invoiceName: null,
        invoiceEmail: null,
      });
    });

    it('boleta de más de S/ 700 de cliente varios: pide el DNI y lo acepta escrito en el cobro', async () => {
      // 15 × S/ 50 = S/ 750: supera S/ 700 (700 justos no piden DNI: ver document-builder)
      const without = await sale({ document: 'BOLETA' }, 15).expect(400);
      expect(without.body.message).toContain('DNI');
      const res = await sale(
        {
          document: 'BOLETA',
          buyer: { docType: 'DNI', docNumber: '45678912', name: 'ROSA PEÑA' },
        },
        15,
      ).expect(201);
      expect(res.body.receipt.document.customer).toMatchObject({
        docType: '1',
        docNumber: '45678912',
      });
    });

    it('búsqueda: lo que la clínica ya tiene sale sin consultar fuera; lo desconocido, vacío', async () => {
      const fetch = vi.spyOn(globalThis, 'fetch');
      const found = await http()
        .get('/api/billing/lookup?type=RUC&number=20601847834')
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(found.body).toMatchObject({
        name: 'OSYS COMPANY S.A.C.',
        source: 'LOCAL',
      });
      const unknown = await http()
        .get('/api/billing/lookup?type=RUC&number=20100070970')
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(unknown.body).toEqual({});
      // Sin token de APISPERU no sale a internet
      expect(
        fetch.mock.calls.filter((c) => (c[0] as string).includes('apisperu')),
      ).toEqual([]);
      fetch.mockRestore();

      // Con token de APISPERU, lo desconocido se consulta (y el token no sale nunca)
      const saved = await configure({
        // Sigue con el PSE (con comprobantes pendientes no se puede cambiar de proveedor)
        provider: 'NUBEFACT',
        apiUrl: 'https://api.nubefact.com/api/v1/ruta',
        lookupToken: 'tok-apisperu',
      }).expect(200);
      expect(saved.body.hasLookupToken).toBe(true);
      expect(JSON.stringify(saved.body)).not.toContain('tok-apisperu');
      const remote = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            razonSocial: 'MINISTERIO DE ECONOMIA Y FINANZAS',
            direccion: 'JR. JUNIN NRO. 319',
            estado: 'ACTIVO',
            condicion: 'HABIDO',
          }),
          { status: 200 },
        ),
      );
      const looked = await http()
        .get('/api/billing/lookup?type=RUC&number=20131370645')
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(looked.body).toMatchObject({
        name: 'MINISTERIO DE ECONOMIA Y FINANZAS',
        status: 'ACTIVO',
        source: 'APISPERU',
      });
      expect(remote.mock.calls[0][0] as string).toContain('token=tok-apisperu');
      remote.mockRestore();
      await configure({
        provider: 'NUBEFACT',
        apiUrl: 'https://api.nubefact.com/api/v1/ruta',
        clearLookupToken: true,
      }).expect(200);
    });

    it('A4: imprime lo mismo que se emitió, la nota de crédito tiene la suya y el enlace del cliente es seguro', async () => {
      const sold = await sale({ document: 'FACTURA', buyer: osys }, 2).expect(
        201,
      );
      const id = sold.body.receipt.document.id;
      const print = await http()
        .get(`/api/billing/documents/${id}/print`)
        .set('Cookie', cookies.cashier)
        .expect(200);
      const doc = await prisma.electronicDocument.findUniqueOrThrow({
        where: { id },
      });
      expect(print.body).toMatchObject({
        type: 'FACTURA',
        customer: {
          docType: '6',
          docNumber: '20601847834',
          name: 'OSYS COMPANY S.A.C.',
        },
        totals: { total: doc.total.toNumber(), igv: doc.igvAmount.toNumber() },
        amountInWords: 'SON: CIEN CON 00/100 SOLES',
        related: null,
        annulledBy: null,
      });
      expect(print.body.lines).toHaveLength(
        (doc.items as unknown as unknown[]).length,
      );
      expect(print.body.lines[0]).toMatchObject({ quantity: 2, total: 100 });
      expect(print.body.receiptCode).toMatch(/^NV-/);
      // Otra clínica no lo ve
      await http()
        .get(`/api/billing/documents/${id}/print`)
        .set('Cookie', cookies.other)
        .expect(404);

      // La nota de crédito tiene su propio A4 con el comprobante que anula
      await sender.tick();
      await http()
        .post(`/api/cash/receipts/${sold.body.receipt.id}/void`)
        .set('Cookie', cookies.admin)
        .send({ reason: 'Error de cobro' })
        .expect(201);
      const annulled = await http()
        .get(`/api/billing/documents/${id}/print`)
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(annulled.body.annulledBy.code).toMatch(/^FC01-/);
      const nc = await prisma.electronicDocument.findFirstOrThrow({
        where: { relatedId: id, type: 'CREDIT_NOTE' },
      });
      const ncPrint = await http()
        .get(`/api/billing/documents/${nc.id}/print`)
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(ncPrint.body).toMatchObject({
        type: 'CREDIT_NOTE',
        related: { type: 'FACTURA', code: print.body.code },
      });
      expect(ncPrint.body.reason).toBeTruthy();
    });

    it('rechazado por SUNAT: "Corregir" emite otro del mismo tipo, sin nota de crédito, y deja de ser problema', async () => {
      const problems = async () =>
        (
          await http()
            .get('/api/billing/documents?status=PROBLEMS')
            .set('Cookie', cookies.cashier)
            .expect(200)
        ).body;
      const before = (await problems()).problems;
      const boleta = await sale({ document: 'BOLETA' }).expect(201);
      const id = boleta.body.receipt.document.id;
      // Uno aceptado no se "corrige"
      await http()
        .post(`/api/billing/documents/${id}/reissue`)
        .set('Cookie', cookies.cashier)
        .send({
          buyer: { docType: 'DNI', docNumber: '45678912', name: 'ROSA PEÑA' },
        })
        .expect(409);
      await prisma.electronicDocument.update({
        where: { id },
        data: {
          status: 'REJECTED',
          sunatDescription: 'El DNI no es válido',
          nextAttemptAt: null,
        },
      });
      expect((await problems()).problems).toBe(before + 1);
      // La boleta lleva DNI: para RUC está "Cambiar a factura"
      await http()
        .post(`/api/billing/documents/${id}/reissue`)
        .set('Cookie', cookies.cashier)
        .send({ buyer: osys })
        .expect(400);
      const fixed = await http()
        .post(`/api/billing/documents/${id}/reissue`)
        .set('Cookie', cookies.cashier)
        .send({
          buyer: { docType: 'DNI', docNumber: '45678912', name: 'ROSA PEÑA' },
        })
        .expect(201);
      expect(fixed.body.code).toMatch(/^B001-/);
      const docs = await prisma.electronicDocument.findMany({
        where: { receiptId: boleta.body.receipt.id },
        orderBy: { id: 'asc' },
      });
      expect(docs.map((d) => d.type)).toEqual(['BOLETA', 'BOLETA']);
      expect(docs[0].replacedAt).not.toBeNull();
      expect(docs[1]).toMatchObject({
        customerDocNumber: '45678912',
        customerName: 'ROSA PEÑA',
      });
      const after = await problems();
      expect(after.problems).toBe(before);
      expect(after.items.map((d: { id: number }) => d.id)).not.toContain(id);
      // Dos veces no
      await http()
        .post(`/api/billing/documents/${id}/reissue`)
        .set('Cookie', cookies.cashier)
        .send({
          buyer: { docType: 'DNI', docNumber: '45678912', name: 'ROSA PEÑA' },
        })
        .expect(409);
      // El ticket muestra el nuevo
      const ticket = await http()
        .get(`/api/cash/receipts/${boleta.body.receipt.id}`)
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(ticket.body.document.code).toBe(fixed.body.code);
    });

    it('anular un cobro con comprobante rechazado lo deja resuelto', async () => {
      const boleta = await sale({ document: 'BOLETA' }).expect(201);
      const id = boleta.body.receipt.document.id;
      await prisma.electronicDocument.update({
        where: { id },
        data: { status: 'REJECTED', nextAttemptAt: null },
      });
      await http()
        .post(`/api/cash/receipts/${boleta.body.receipt.id}/void`)
        .set('Cookie', cookies.admin)
        .send({ reason: 'Se cobró dos veces' })
        .expect(201);
      const doc = await prisma.electronicDocument.findUniqueOrThrow({
        where: { id },
      });
      expect(doc.replacedAt).not.toBeNull();
    });

    it('"A factura" solo dentro del mes de la boleta (el mes anterior ya se declaró)', async () => {
      const boleta = await sale({ document: 'BOLETA' }).expect(201);
      const id = boleta.body.receipt.document.id;
      const old = new Date();
      old.setUTCMonth(old.getUTCMonth() - 1, 15);
      await prisma.electronicDocument.update({
        where: { id },
        data: {
          issueDate: new Date(
            Date.UTC(old.getUTCFullYear(), old.getUTCMonth(), 15),
          ),
        },
      });
      const res = await http()
        .post(`/api/billing/documents/${id}/factura`)
        .set('Cookie', cookies.cashier)
        .send({ buyer: osys })
        .expect(409);
      expect(res.body.message).toContain('dentro del mes');
    });

    it('dos clics a la vez en "A factura" emiten una sola factura', async () => {
      const boleta = await sale({ document: 'BOLETA' }).expect(201);
      const id = boleta.body.receipt.document.id;
      const send = () =>
        http()
          .post(`/api/billing/documents/${id}/factura`)
          .set('Cookie', cookies.cashier)
          .send({ buyer: osys });
      const results = await Promise.all([send(), send(), send()]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409, 409,
      ]);
      expect(
        await prisma.electronicDocument.count({
          where: { receiptId: boleta.body.receipt.id, type: 'FACTURA' },
        }),
      ).toBe(1);
    });

    it('cambiar boleta por factura: nota de crédito + factura; anular el cobro anula la factura', async () => {
      const boleta = await sale({
        document: 'BOLETA',
        clientId: ids.rosa,
      }).expect(201);
      await sender.tick();
      const boletaId = boleta.body.receipt.document.id;
      // Otra clínica no la ve
      await http()
        .post(`/api/billing/documents/${boletaId}/factura`)
        .set('Cookie', cookies.other)
        .send({ buyer: osys })
        .expect(404);
      const changed = await http()
        .post(`/api/billing/documents/${boletaId}/factura`)
        .set('Cookie', cookies.cashier)
        .send({ buyer: osys })
        .expect(201);
      expect(changed.body.code).toMatch(/^F001-/);
      // Dos veces no (ni con dos clics al mismo tiempo: ver la prueba de abajo)
      await http()
        .post(`/api/billing/documents/${boletaId}/factura`)
        .set('Cookie', cookies.cashier)
        .send({ buyer: osys })
        .expect(409);
      const docs = await prisma.electronicDocument.findMany({
        where: { receiptId: boleta.body.receipt.id },
        orderBy: { id: 'asc' },
      });
      expect(docs.map((d) => d.type)).toEqual([
        'BOLETA',
        'CREDIT_NOTE',
        'FACTURA',
      ]);
      expect(docs[1].relatedId).toBe(boletaId);
      expect(docs[2].total.toNumber()).toBe(50);
      // El ticket muestra la factura
      const ticket = await http()
        .get(`/api/cash/receipts/${boleta.body.receipt.id}`)
        .set('Cookie', cookies.cashier)
        .expect(200);
      expect(ticket.body.document.code).toBe(changed.body.code);
      await sender.tick();
      // Anular el cobro: la nota de crédito va contra la factura, no contra la boleta
      await http()
        .post(`/api/cash/receipts/${boleta.body.receipt.id}/void`)
        .set('Cookie', cookies.admin)
        .send({ reason: 'Devolución' })
        .expect(201);
      const notes = await prisma.electronicDocument.findMany({
        where: { receiptId: boleta.body.receipt.id, type: 'CREDIT_NOTE' },
        orderBy: { id: 'asc' },
      });
      expect(notes.map((n) => n.relatedId)).toEqual([boletaId, docs[2].id]);
      // Una factura no se "cambia por factura"
      await http()
        .post(`/api/billing/documents/${docs[2].id}/factura`)
        .set('Cookie', cookies.cashier)
        .send({ buyer: osys })
        .expect(400);
    });
  });

  describe('salud de la conexión con el PSE', () => {
    const notFound = () =>
      new Response(
        JSON.stringify({ errors: 'El documento no existe', codigo: 24 }),
        { status: 200 },
      );
    const accepted = () =>
      new Response(
        JSON.stringify({ aceptada_por_sunat: true, codigo_hash: 'H' }),
        { status: 200 },
      );
    const notifications = (key: string) =>
      http().get('/api/notifications').set('Cookie', cookies[key]).expect(200);
    const health = () =>
      prisma.billingSettings.findUniqueOrThrow({
        where: { clinicId: clinicIds[0] },
      });
    let fetchMock: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      await login(clinicIds[0], 'VET', 'vet');
      // Empieza limpio: nada en cola y la conexión sin revisar
      await prisma.electronicDocument.updateMany({
        where: {
          clinicId: clinicIds[0],
          status: { in: ['PENDING', 'SENT', 'ERROR'] },
        },
        data: { status: 'ACCEPTED', nextAttemptAt: null },
      });
      await prisma.billingSettings.update({
        where: { clinicId: clinicIds[0] },
        data: { health: null, healthSince: null, healthFailures: 0 },
      });
      fetchMock = vi.spyOn(globalThis, 'fetch');
    });

    afterAll(() => fetchMock.mockRestore());

    it('token rechazado: se detiene, avisa una sola vez por rol y al actualizar el token sale solo', async () => {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
      const sale = await sell('BOLETA', ids.rosa).expect(201);
      await sender.tick();
      const doc = await prisma.electronicDocument.findFirstOrThrow({
        where: { receiptId: sale.body.receipt.id },
      });
      expect(doc).toMatchObject({
        status: 'ERROR',
        errorKind: 'auth',
        nextAttemptAt: null,
      });
      expect((await health()).health).toBe('TOKEN');

      // Soporte técnico: el token y el botón para cambiarlo
      const support = (await notifications('admin')).body;
      expect(support.banners[0]).toMatchObject({
        tone: 'danger',
        title: 'La facturación está detenida',
        dismissible: false,
        action: {
          label: 'Actualizar token',
          link: '/comprobantes/configuracion',
        },
      });
      // El dueño no maneja tokens: sigue cobrando y avisa a soporte
      const admin = (await notifications('owner')).body;
      expect(admin.banners).toHaveLength(1);
      expect(admin.banners[0]).toMatchObject({
        tone: 'danger',
        title: 'La facturación está detenida',
        action: { label: 'Ver comprobantes', link: '/comprobantes' },
      });
      expect(admin.banners[0].detail).toContain('Puedes seguir cobrando');
      expect(admin.banners[0].detail).toContain('Avisa a soporte técnico');
      expect(admin.banners[0].detail).not.toContain('token');
      // Un solo aviso en la campana, no uno por comprobante
      const kinds = admin.events.map((e: { kind: string }) => e.kind);
      expect(kinds.filter((k: string) => k === 'billingStopped')).toHaveLength(
        1,
      );
      expect(
        admin.events.some(
          (e: { code?: string }) => e.code === sale.body.receipt.document.code,
        ),
      ).toBe(false);
      // …pero el contador de "comprobantes con problemas" sí lo cuenta (no se pierde)
      expect(
        admin.alerts.find((a: { kind: string }) => a.kind === 'billing')?.count,
      ).toBeGreaterThanOrEqual(1);

      const cashier = (await notifications('cashier')).body;
      expect(cashier.banners[0].action).toBeUndefined();
      expect(cashier.banners[0].detail).toContain('Avisa al administrador');
      expect((await notifications('vet')).body.banners).toEqual([]);

      // Soporte pega el token nuevo: se prueba, se apaga la alerta y el comprobante vuelve a la cola
      fetchMock.mockResolvedValueOnce(notFound());
      await http()
        .put('/api/billing/settings/token')
        .set('Cookie', cookies.admin)
        .send({ apiToken: 'token-nuevo' })
        .expect(200);
      expect((await health()).health).toBe('OK');
      expect((await notifications('owner')).body.banners).toEqual([]);
      const queued = await prisma.electronicDocument.findUniqueOrThrow({
        where: { id: doc.id },
      });
      expect(queued.nextAttemptAt).not.toBeNull();
      expect(queued.errorKind).toBeNull();
      fetchMock.mockResolvedValueOnce(accepted());
      await sender.tick();
      expect(
        (
          await prisma.electronicDocument.findUniqueOrThrow({
            where: { id: doc.id },
          })
        ).status,
      ).toBe('ACCEPTED');
    });

    it('la revisión automática solo avisa "sin conexión" tras 3 fallos seguidos, y se recupera sola', async () => {
      const checker = app.get(BillingHealthChecker);
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await checker.runAll();
      await checker.runAll();
      expect((await health()).health).toBe('OK');
      expect((await notifications('cashier')).body.banners).toEqual([]);
      await checker.runAll();
      const down = await health();
      expect(down).toMatchObject({ health: 'UNREACHABLE', healthFailures: 3 });
      const banner = (await notifications('cashier')).body.banners[0];
      expect(banner).toMatchObject({ tone: 'warning', dismissible: true });
      expect(banner.title).toContain('Sin conexión');

      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(notFound());
      await checker.runAll();
      expect(await health()).toMatchObject({ health: 'OK', healthFailures: 0 });
      expect((await notifications('cashier')).body.banners).toEqual([]);
    });

    it('un comprobante sin aceptar pasado un día avisa al administrador y se filtra', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const sale = await sell('BOLETA', ids.rosa).expect(201);
      await sender.tick();
      const doc = await prisma.electronicDocument.findFirstOrThrow({
        where: { receiptId: sale.body.receipt.id },
      });
      await prisma.electronicDocument.update({
        where: { id: doc.id },
        data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      const late = (await notifications('owner')).body.alerts.find(
        (a: { kind: string }) => a.kind === 'billingLate',
      );
      expect(late).toMatchObject({ count: 1, query: { estado: 'LATE' } });
      expect(
        (await notifications('cashier')).body.alerts.some(
          (a: { kind: string }) => a.kind === 'billingLate',
        ),
      ).toBe(false);
      const list = await http()
        .get('/api/billing/documents?status=LATE')
        .set('Cookie', cookies.owner)
        .expect(200);
      expect(list.body.items.map((d: { id: number }) => d.id)).toEqual([
        doc.id,
      ]);
      await prisma.electronicDocument.update({
        where: { id: doc.id },
        data: { status: 'ACCEPTED', nextAttemptAt: null },
      });
    });

    it('antes de que algo se detenga: cupo del mes, vencimientos y token viejo los ve solo soporte técnico', async () => {
      // "Actualizar token" guardó la fecha del token
      const saved = await health();
      expect(saved.tokenUpdatedAt).not.toBeNull();
      const view = await http()
        .get('/api/billing/settings')
        .set('Cookie', cookies.admin)
        .expect(200);
      const used: number = view.body.usedThisMonth;
      expect(used).toBeGreaterThanOrEqual(1);

      const soon = new Date(Date.now() + 3 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await prisma.billingSettings.update({
        where: { clinicId: clinicIds[0] },
        data: {
          monthlyQuota: used,
          domainExpiresOn: new Date(`${soon}T00:00:00Z`),
        },
      });
      const owner = (await notifications('admin')).body.banners;
      expect(owner.map((b: { id: string }) => b.id.split(':')[0])).toEqual([
        'quota',
        'due',
      ]);
      expect(owner[0]).toMatchObject({ tone: 'danger', dismissible: false });
      expect(owner[1].title).toMatch(/^El dominio vence en \d días/);
      // Ni el dueño ni la caja ven planes, dominios ni tokens
      expect((await notifications('owner')).body.banners).toEqual([]);
      expect((await notifications('cashier')).body.banners).toEqual([]);

      const again = await http()
        .get('/api/billing/settings')
        .set('Cookie', cookies.admin)
        .expect(200);
      expect(again.body).toMatchObject({
        monthlyQuota: used,
        domainExpiresOn: soon,
      });
      await prisma.billingSettings.update({
        where: { clinicId: clinicIds[0] },
        data: { monthlyQuota: null, domainExpiresOn: null },
      });
    });
  });
});
