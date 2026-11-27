import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { clinicDay } from '../src/common/time/clinic-day.js';
import { addDays } from '../src/inventory/expiry.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Compras y proveedores (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const stamp = Date.now();
  const today = clinicDay('America/Lima');
  const http = () => request(app.getHttpServer());
  const ids: Record<string, number> = {};

  async function login(
    clinicId: number,
    role: 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER',
    key: string,
  ) {
    const email = `${key}-co-${stamp}@uywa.pe`;
    await prisma.user.create({
      data: {
        clinicId,
        fullName: `${key} Compras`,
        email,
        role,
        licenseNumber: role === 'VET' ? 'CMVP-9090' : null,
        passwordHash: await bcrypt.hash('Clave12345', 4),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: 'Clave12345' })
      .expect(200);
    cookies[key] = String(res.headers['set-cookie']).split(';')[0];
  }

  async function product(body: Record<string, unknown>) {
    const res = await http()
      .post('/api/inventory/products')
      .set('Cookie', cookies.admin)
      .send(body)
      .expect(201);
    return res.body as {
      id: number;
      presentations: { id: number; name: string }[];
    };
  }

  const stockOf = async (id: number) =>
    Number(
      (await prisma.product.findUniqueOrThrow({ where: { id } })).totalStock,
    );

  const purchase = (cookie: string, body: Record<string, unknown>) =>
    http().post('/api/inventory/purchases').set('Cookie', cookie).send(body);

  const ficha = (over: Record<string, unknown> = {}) => ({
    supplierId: ids.andina,
    docType: 'FACTURA',
    docNumber: 'F001-00123',
    issuedAt: today,
    pricesIncludeIgv: false,
    lines: [
      {
        productId: ids.amoxi,
        presentationId: ids.amoxiCaja,
        quantity: 5,
        unitPrice: 40,
        lotNumber: 'A23B',
        expiresAt: addDays(today, 400),
      },
      {
        productId: ids.cama,
        presentationId: ids.camaUnidad,
        quantity: 2,
        unitPrice: 50,
      },
    ],
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const name of ['Clínica e2e compras', 'Otra clínica compras'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet');
    await login(mine, 'RECEPTION', 'reception');
    await login(mine, 'CASHIER', 'cashier');
    await login(other, 'ADMIN', 'other');

    const amoxi = await product({
      name: 'Amoxicilina 500 mg',
      category: 'MEDICINE',
      baseUnit: 'TABLET',
      minStock: 100,
      presentations: [
        { name: 'Caja x 100', factor: 100, price: 120 },
        { name: 'Tableta', factor: 1, price: 1.5 },
      ],
    });
    ids.amoxi = amoxi.id;
    ids.amoxiCaja = amoxi.presentations.find(
      (p) => p.name === 'Caja x 100',
    )!.id;
    const cama = await product({
      name: 'Cama mediana',
      category: 'ACCESSORY',
      baseUnit: 'UNIT',
      tracksExpiry: false,
      igv: 'TAXED',
      presentations: [{ name: 'Unidad', factor: 1, price: 95 }],
    });
    ids.cama = cama.id;
    ids.camaUnidad = cama.presentations[0].id;
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.stockShortage.deleteMany({ where });
      await prisma.charge.deleteMany({ where });
      await prisma.visit.deleteMany({ where });
      await prisma.queueEntry.deleteMany({ where });
      await prisma.careServiceSupply.deleteMany({
        where: { service: { clinicId: { in: clinicIds } } },
      });
      await prisma.careService.deleteMany({ where });
      await prisma.stockMovement.deleteMany({ where });
      await prisma.purchaseLine.deleteMany({
        where: { purchase: { clinicId: { in: clinicIds } } },
      });
      await prisma.purchaseFile.deleteMany({
        where: { purchase: { clinicId: { in: clinicIds } } },
      });
      await prisma.productBatch.deleteMany({ where });
      await prisma.purchase.deleteMany({ where });
      await prisma.supplier.deleteMany({ where });
      await prisma.productPresentation.deleteMany({ where });
      await prisma.product.deleteMany({ where });
      await prisma.pet.deleteMany({ where });
      await prisma.client.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.clinicSequence.deleteMany({ where });
      await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    }
    await app?.close();
  });

  it('proveedores: recepción y caja no entran; RUC válido y sin repetir', async () => {
    for (const who of ['reception', 'cashier'])
      await http()
        .get('/api/inventory/suppliers')
        .set('Cookie', cookies[who])
        .expect(403);

    const bad = await http()
      .post('/api/inventory/suppliers')
      .set('Cookie', cookies.vet)
      .send({ name: 'Droguería Andina S.A.C.', ruc: '20123456780' })
      .expect(400);
    expect(String(bad.body.errors)).toContain('RUC');

    const res = await http()
      .post('/api/inventory/suppliers')
      .set('Cookie', cookies.vet)
      .send({
        name: 'Droguería Andina S.A.C.',
        ruc: '20131312955',
        contact: 'Luis Rojas',
        phone: '987 654 321',
      })
      .expect(201);
    ids.andina = res.body.id;
    expect(res.body).toMatchObject({ phone: '987654321', purchases: 0 });
    // El veterinario no ve totales en dinero
    expect(res.body.yearTotal).toBeUndefined();

    const sameRuc = await http()
      .post('/api/inventory/suppliers')
      .set('Cookie', cookies.admin)
      .send({ name: 'Otro nombre', ruc: '20131312955' })
      .expect(409);
    expect(sameRuc.body.message).toContain('Droguería Andina');
    await http()
      .post('/api/inventory/suppliers')
      .set('Cookie', cookies.admin)
      .send({ name: 'drogueria  andina s.a.c.' })
      .expect(409);

    ids.other = (
      await http()
        .post('/api/inventory/suppliers')
        .set('Cookie', cookies.other)
        .send({ name: 'Proveedor de otra clínica' })
        .expect(201)
    ).body.id;
  });

  it('recibe la ficha completa: un lote por línea, costo sin IGV y totales', async () => {
    await purchase(cookies.reception, ficha()).expect(403);
    const before = await stockOf(ids.amoxi);
    const res = await purchase(cookies.vet, ficha()).expect(201);
    ids.p1 = res.body.id;
    expect(res.body).toMatchObject({
      code: 'CO-00001',
      docType: 'FACTURA',
      docNumber: 'F001-00123',
      supplier: { id: ids.andina, name: 'Droguería Andina S.A.C.' },
      subtotal: 300,
      igv: 54,
      total: 354,
      status: 'RECEIVED',
      canVoid: true,
      lines: 2,
    });
    const amoxi = res.body.lineItems.find(
      (l: { product: { id: number } }) => l.product.id === ids.amoxi,
    );
    expect(amoxi).toMatchObject({
      quantity: 5,
      unitPrice: 40,
      taxable: 200,
      igv: 36,
      total: 236,
      description: 'Amoxicilina 500 mg · Caja x 100',
      batch: { lotNumber: 'A23B', initialQuantity: 500, quantity: 500 },
    });
    // 200 sin IGV entre 500 tabletas
    expect(amoxi.batch.unitCost).toBe(0.4);
    expect(await stockOf(ids.amoxi)).toBe(before + 500);

    const batch = await prisma.productBatch.findUniqueOrThrow({
      where: { id: amoxi.batch.id },
    });
    expect(batch).toMatchObject({
      supplierId: ids.andina,
      purchaseId: ids.p1,
      supplier: 'Droguería Andina S.A.C.',
      documentNumber: 'F001-00123',
    });
    const move = await prisma.stockMovement.findFirstOrThrow({
      where: { batchId: amoxi.batch.id },
    });
    expect(move).toMatchObject({ type: 'PURCHASE' });
    expect(move.reason).toBe(
      'Compra CO-00001 · F001-00123 · Droguería Andina S.A.C.',
    );

    // El lote sabe de qué ficha vino (solo para quien ve costos)
    const detail = await http()
      .get(`/api/inventory/products/${ids.amoxi}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(
      detail.body.batches.find((b: { id: number }) => b.id === amoxi.batch.id),
    ).toMatchObject({
      purchase: { id: ids.p1, code: 'CO-00001' },
      unitCost: 0.4,
    });
  });

  it('recepción y caja ven el stock pero no lo que pagó la clínica', async () => {
    for (const who of ['reception', 'cashier']) {
      const res = await http()
        .get(`/api/inventory/products/${ids.amoxi}`)
        .set('Cookie', cookies[who])
        .expect(200);
      expect(res.body.totalStock).toBeGreaterThan(0);
      for (const b of res.body.batches)
        expect(b).toMatchObject({
          unitCost: null,
          supplier: null,
          documentNumber: null,
          purchase: null,
        });
    }
  });

  it('la misma ficha no entra dos veces, aunque se escriba distinto', async () => {
    const res = await purchase(
      cookies.admin,
      ficha({ docNumber: ' f001 - 123 ' }),
    ).expect(409);
    expect(res.body.message).toContain('CO-00001');
    // Otro tipo de comprobante con el mismo número sí es otra ficha
    await purchase(
      cookies.admin,
      ficha({
        docType: 'GUIA',
        docNumber: 'F001-123',
        lines: [ficha().lines[1]],
      }),
    ).expect(201);
  });

  it('valida cada línea antes de tocar el stock', async () => {
    const before = await stockOf(ids.amoxi);
    const noLot = await purchase(
      cookies.vet,
      ficha({
        docNumber: 'F001-200',
        lines: [{ ...ficha().lines[0], expiresAt: null }],
      }),
    ).expect(400);
    expect(noLot.body.message).toBe(
      'Línea 1: ingresa el vencimiento de Amoxicilina 500 mg',
    );
    const expired = await purchase(
      cookies.vet,
      ficha({
        docNumber: 'F001-201',
        lines: [
          ficha().lines[1],
          { ...ficha().lines[0], expiresAt: addDays(today, -1) },
        ],
      }),
    ).expect(400);
    expect(expired.body.message).toContain('Línea 2');
    expect(expired.body.message).toContain('vencido');
    await purchase(
      cookies.vet,
      ficha({ docNumber: 'F001-202', issuedAt: addDays(today, 1) }),
    ).expect(400);
    await purchase(
      cookies.vet,
      ficha({ docNumber: 'F001-203', supplierId: ids.other }),
    ).expect(400);
    await purchase(
      cookies.vet,
      ficha({ docNumber: 'F001-204', lines: [] }),
    ).expect(400);
    expect(await stockOf(ids.amoxi)).toBe(before);
  });

  it('precios con IGV: el costo del lote queda sin IGV', async () => {
    const res = await purchase(
      cookies.vet,
      ficha({
        docNumber: 'F001-300',
        pricesIncludeIgv: true,
        lines: [{ ...ficha().lines[1], quantity: 1, unitPrice: 59 }],
      }),
    ).expect(201);
    expect(res.body).toMatchObject({ subtotal: 50, igv: 9, total: 59 });
    expect(res.body.lineItems[0].batch.unitCost).toBe(50);
    ids.p3 = res.body.id;
  });

  it('corrige el comprobante (llegó la factura después de la guía) sin tocar el stock', async () => {
    const before = await stockOf(ids.cama);
    const res = await http()
      .patch(`/api/inventory/purchases/${ids.p3}`)
      .set('Cookie', cookies.vet)
      .send({
        supplierId: ids.andina,
        docType: 'FACTURA',
        docNumber: 'F001-301',
        issuedAt: addDays(today, -2),
      })
      .expect(200);
    expect(res.body).toMatchObject({
      docNumber: 'F001-301',
      issuedAt: addDays(today, -2),
    });
    expect(await stockOf(ids.cama)).toBe(before);
    const batch = await prisma.productBatch.findFirstOrThrow({
      where: { purchaseId: ids.p3 },
    });
    expect(batch.documentNumber).toBe('F001-301');
    // No puede quedar igual a otra ficha ya registrada
    await http()
      .patch(`/api/inventory/purchases/${ids.p3}`)
      .set('Cookie', cookies.vet)
      .send({
        supplierId: ids.andina,
        docType: 'FACTURA',
        docNumber: 'F001-123',
        issuedAt: today,
      })
      .expect(409);
  });

  it('anula solo si no se usó nada; quien no la registró no puede', async () => {
    // La registró el veterinario: otro usuario que no es admin no puede; el admin sí
    const cama = await stockOf(ids.cama);
    const res = await http()
      .post(`/api/inventory/purchases/${ids.p3}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Se cargó dos veces' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Se cargó dos veces',
      canVoid: false,
    });
    expect(await stockOf(ids.cama)).toBe(cama - 1);
    const move = await prisma.stockMovement.findFirstOrThrow({
      where: { type: 'PURCHASE_VOID', productId: ids.cama },
    });
    expect(Number(move.quantity)).toBe(-1);
    await http()
      .post(`/api/inventory/purchases/${ids.p3}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Otra vez' })
      .expect(409);

    // Si ya salió algo de la compra, no se anula: se corrige con un ajuste
    await http()
      .post(`/api/inventory/products/${ids.amoxi}/outflows`)
      .set('Cookie', cookies.vet)
      .send({ type: 'WASTE', quantity: 3, reason: 'Blíster roto' })
      .expect(201);
    const used = await http()
      .post(`/api/inventory/purchases/${ids.p1}/void`)
      .set('Cookie', cookies.admin)
      .send({ reason: 'Error' })
      .expect(409);
    expect(used.body.message).toContain('ajuste');
    const detail = await http()
      .get(`/api/inventory/purchases/${ids.p1}`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(detail.body.canVoid).toBe(false);
  });

  it('descuenta de la compra los insumos que se usaron sin stock', async () => {
    const champu = await product({
      name: 'Champú clorhexidina',
      category: 'HYGIENE',
      baseUnit: 'ML',
      presentations: [{ name: 'Frasco x 500 ml', factor: 500, price: 55 }],
    });
    const bath = await http()
      .post('/api/care-services')
      .set('Cookie', cookies.admin)
      .send({
        name: 'Baño medicado',
        category: 'OTHER',
        price: 45,
        supplies: [{ productId: champu.id, quantity: 30 }],
      })
      .expect(201);
    const client = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        name: 'Rosa Quispe',
        phone: '987654321',
        consent: true,
        pet: { name: 'Toby', species: 'DOG', weightKg: 10 },
      })
      .expect(201);
    const queue = await http()
      .post('/api/queue')
      .set('Cookie', cookies.reception)
      .send({ petId: client.body.pets[0].id, reason: 'Baño' })
      .expect(201);
    const visit = await http()
      .post('/api/visits')
      .set('Cookie', cookies.vet)
      .send({ petId: client.body.pets[0].id, queueEntryId: queue.body.id })
      .expect(201);
    const charged = await http()
      .post('/api/charges')
      .set('Cookie', cookies.vet)
      .send({
        visitId: visit.body.id,
        items: [{ careServiceId: bath.body.id, quantity: 2 }],
      })
      .expect(201);
    expect(charged.body.shortages).toEqual([
      { product: 'Champú clorhexidina', baseUnit: 'ML', quantity: 60 },
    ]);

    const res = await purchase(
      cookies.vet,
      ficha({
        docNumber: 'F001-400',
        settleShortages: true,
        lines: [
          {
            productId: champu.id,
            presentationId: champu.presentations[0].id,
            quantity: 1,
            unitPrice: 30,
            lotNumber: 'CH-1',
            expiresAt: addDays(today, 300),
          },
        ],
      }),
    ).expect(201);
    expect(res.body.settledShortages).toBe(1);
    // Entraron 500 ml y se descontaron los 60 que ya se habían usado
    expect(await stockOf(champu.id)).toBe(440);
    const shortage = await prisma.stockShortage.findFirstOrThrow({
      where: { productId: champu.id },
    });
    expect(shortage.resolvedAt).not.toBeNull();
    expect(shortage.resolution).toContain('CO-');
    // Ya se usó parte de la compra: no se puede anular
    expect(res.body.canVoid).toBe(false);
  });

  it('historial: busca por número, proveedor o producto; totales solo para el administrador', async () => {
    const vet = await http()
      .get('/api/inventory/purchases')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(vet.body.summary).toBeUndefined();
    expect(vet.body.items.length).toBeGreaterThanOrEqual(4);

    const admin = await http()
      .get('/api/inventory/purchases?status=RECEIVED')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(admin.body.summary.count).toBe(admin.body.total);
    expect(
      admin.body.items.every(
        (p: { status: string }) => p.status === 'RECEIVED',
      ),
    ).toBe(true);

    const byDoc = await http()
      .get('/api/inventory/purchases?q=f001-123')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(
      byDoc.body.items.map((p: { docNumber: string }) => p.docNumber),
    ).toContain('F001-00123');
    const byProduct = await http()
      .get('/api/inventory/purchases?q=amoxicilina')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(byProduct.body.items.map((p: { id: number }) => p.id)).toContain(
      ids.p1,
    );
    const byCode = await http()
      .get('/api/inventory/purchases?q=CO-1')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(byCode.body.items.map((p: { id: number }) => p.id)).toEqual([
      ids.p1,
    ]);

    const supplier = await http()
      .get(`/api/inventory/suppliers/${ids.andina}`)
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(supplier.body.purchases).toBeGreaterThanOrEqual(3);
    expect(supplier.body.yearTotal).toBeGreaterThan(0);

    // Otra clínica no ve nada de esto
    await http()
      .get(`/api/inventory/purchases/${ids.p1}`)
      .set('Cookie', cookies.other)
      .expect(404);
    const others = await http()
      .get('/api/inventory/purchases')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(others.body.items).toEqual([]);
  });

  it('foto de la ficha: solo imagen o PDF reconocidos por su contenido', async () => {
    await http()
      .post(`/api/inventory/purchases/${ids.p1}/file`)
      .set('Cookie', cookies.vet)
      .attach('file', Buffer.from('hola'), 'ficha.txt')
      .expect(400);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await http()
      .post(`/api/inventory/purchases/${ids.p1}/file`)
      .set('Cookie', cookies.vet)
      .attach('file', png, 'ficha.png')
      .expect(200);
    const file = await http()
      .get(`/api/inventory/purchases/${ids.p1}/file`)
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    await http()
      .get(`/api/inventory/purchases/${ids.p1}/file`)
      .set('Cookie', cookies.reception)
      .expect(403);
    await http()
      .delete(`/api/inventory/purchases/${ids.p1}/file`)
      .set('Cookie', cookies.vet)
      .expect(204);
  });

  it('Excel del contador: solo el administrador, sin anuladas', async () => {
    await http()
      .get(
        `/api/inventory/purchases/excel?from=${addDays(today, -30)}&to=${today}`,
      )
      .set('Cookie', cookies.vet)
      .expect(403);
    const res = await http()
      .get(
        `/api/inventory/purchases/excel?from=${addDays(today, -30)}&to=${today}`,
      )
      .set('Cookie', cookies.admin)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const ExcelJS = (await import('exceljs')).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as never);
    const sheet = book.getWorksheet('Compras')!;
    const docs: string[] = [];
    sheet.eachRow((row, n) => {
      if (n > 4) docs.push(row.getCell(3).text);
    });
    expect(docs).toContain('F001-00123');
    // La anulada (F001-301) no va al registro de compras
    expect(docs).not.toContain('F001-301');
    expect(book.getWorksheet('Por proveedor')).toBeDefined();
    expect(book.getWorksheet('Detalle')!.rowCount).toBeGreaterThan(3);
  });

  it('unir proveedores repetidos: solo el administrador; las compras pasan al que queda', async () => {
    const dup = await http()
      .post('/api/inventory/suppliers')
      .set('Cookie', cookies.vet)
      .send({ name: 'Drog. Andina' })
      .expect(201);
    await purchase(
      cookies.vet,
      ficha({
        supplierId: dup.body.id,
        docNumber: 'B001-9',
        docType: 'BOLETA',
        lines: [ficha().lines[1]],
      }),
    ).expect(201);
    await http()
      .post(`/api/inventory/suppliers/${dup.body.id}/merge`)
      .set('Cookie', cookies.vet)
      .send({ intoId: ids.andina })
      .expect(403);
    const res = await http()
      .post(`/api/inventory/suppliers/${dup.body.id}/merge`)
      .set('Cookie', cookies.admin)
      .send({ intoId: ids.andina })
      .expect(200);
    expect(res.body.id).toBe(ids.andina);
    expect(await prisma.supplier.count({ where: { id: dup.body.id } })).toBe(0);
    expect(
      await prisma.purchase.count({ where: { supplierId: dup.body.id } }),
    ).toBe(0);
  });

  it('el libro de controlados muestra de qué proveedor y ficha vino cada entrada', async () => {
    const keta = await product({
      name: 'Ketamina 50 mg/ml',
      category: 'MEDICINE',
      baseUnit: 'ML',
      controlled: true,
      presentations: [{ name: 'Frasco x 10 ml', factor: 10, price: 90 }],
    });
    await purchase(
      cookies.vet,
      ficha({
        docNumber: 'F001-500',
        lines: [
          {
            productId: keta.id,
            presentationId: keta.presentations[0].id,
            quantity: 2,
            unitPrice: 60,
            lotNumber: 'K-77',
            expiresAt: addDays(today, 500),
          },
        ],
      }),
    ).expect(201);
    const book = await http()
      .get('/api/inventory/controlled')
      .set('Cookie', cookies.vet)
      .expect(200);
    expect(book.body[0]).toMatchObject({
      type: 'PURCHASE',
      batch: {
        lotNumber: 'K-77',
        supplier: 'Droguería Andina S.A.C.',
        documentNumber: 'F001-500',
      },
    });
  });
});
