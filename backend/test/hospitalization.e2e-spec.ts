import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type Role = 'ADMIN' | 'VET' | 'RECEPTION' | 'CASHIER';

// Requiere la base de datos levantada y las migraciones aplicadas.
describe('Plantillas clínicas y hospitalización (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clinicIds: number[] = [];
  const cookies: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const ids = {
    stay: 0,
    consult: 0,
    pet: 0,
    pet2: 0,
    hosp: 0,
    visit: 0,
    order: 0,
  };

  async function login(clinicId: number, role: Role, key: string) {
    const email = `${key}-hosp-${stamp}@uywa.pe`;
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

  async function newPet(name: string) {
    const res = await http()
      .post('/api/clients')
      .set('Cookie', cookies.reception)
      .send({
        name: `Dueño de ${name}`,
        phone: '987654321',
        consent: true,
        pet: { name, species: 'DOG' },
      })
      .expect(201);
    return res.body.pets[0].id as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const name of ['Clínica e2e hospital', 'Otra clínica hospital'])
      clinicIds.push((await prisma.clinic.create({ data: { name } })).id);
    const [mine, other] = clinicIds;
    await login(mine, 'ADMIN', 'admin');
    await login(mine, 'VET', 'vet');
    await login(mine, 'RECEPTION', 'reception');
    await login(other, 'ADMIN', 'other');
    const service = async (body: object) =>
      (
        await http()
          .post('/api/care-services')
          .set('Cookie', cookies.admin)
          .send(body)
          .expect(201)
      ).body.id as number;
    ids.stay = await service({
      name: 'Hospitalización (día)',
      category: 'HOSPITALIZATION',
      price: 120,
    });
    ids.consult = await service({
      name: 'Consulta',
      category: 'CONSULTATION',
      price: 50,
    });
    ids.pet = await newPet('Rocky');
    ids.pet2 = await newPet('Luna');
  });

  afterAll(async () => {
    if (prisma && clinicIds.length) {
      const where = { clinicId: { in: clinicIds } };
      await prisma.hospitalizationEntry.deleteMany({ where });
      await prisma.hospitalizationOrder.deleteMany({ where });
      await prisma.hospitalization.deleteMany({ where });
      await prisma.clinicalTemplate.deleteMany({ where });
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

  describe('plantillas', () => {
    it('el veterinario guarda una consulta y una receta frecuente; las más usadas salen primero', async () => {
      const a = await http()
        .post('/api/clinical-templates')
        .set('Cookie', cookies.vet)
        .send({
          kind: 'CONSULTATION',
          name: 'Gastroenteritis',
          consultation: {
            reason: 'Vómitos y diarrea',
            anamnesis: '',
            plan: 'Dieta blanda 3 días',
          },
        })
        .expect(201);
      // Los campos vacíos no se guardan
      expect(a.body.consultation).toEqual({
        reason: 'Vómitos y diarrea',
        plan: 'Dieta blanda 3 días',
      });
      const b = await http()
        .post('/api/clinical-templates')
        .set('Cookie', cookies.vet)
        .send({
          kind: 'CONSULTATION',
          name: 'Control de vacunas',
          consultation: { reason: 'Vacunación' },
        })
        .expect(201);
      await http()
        .post('/api/clinical-templates')
        .set('Cookie', cookies.vet)
        .send({
          kind: 'PRESCRIPTION',
          name: 'Otitis',
          prescription: {
            items: [
              {
                drug: 'Otomax',
                dose: '5 gotas',
                frequency: 'cada 12 h',
                duration: '7 días',
              },
            ],
          },
        })
        .expect(201);
      await http()
        .post(`/api/clinical-templates/${b.body.id}/used`)
        .set('Cookie', cookies.vet)
        .expect(204);

      const list = await http()
        .get('/api/clinical-templates?kind=CONSULTATION')
        .set('Cookie', cookies.reception)
        .expect(200);
      expect(list.body.map((t: { name: string }) => t.name)).toEqual([
        'Control de vacunas',
        'Gastroenteritis',
      ]);
    });

    it('valida, evita nombres repetidos y respeta roles y clínica', async () => {
      await http()
        .post('/api/clinical-templates')
        .set('Cookie', cookies.vet)
        .send({ kind: 'CONSULTATION', name: 'Vacía', consultation: {} })
        .expect(400);
      await http()
        .post('/api/clinical-templates')
        .set('Cookie', cookies.vet)
        .send({
          kind: 'PRESCRIPTION',
          name: 'Sin items',
          prescription: { items: [] },
        })
        .expect(400);
      const dup = await http()
        .post('/api/clinical-templates')
        .set('Cookie', cookies.admin)
        .send({
          kind: 'CONSULTATION',
          name: 'Gastroenteritis',
          consultation: { reason: 'x' },
        })
        .expect(409);
      expect(dup.body.message).toContain('Gastroenteritis');
      await http()
        .post('/api/clinical-templates')
        .set('Cookie', cookies.reception)
        .send({
          kind: 'CONSULTATION',
          name: 'Recepción',
          consultation: { reason: 'x' },
        })
        .expect(403);
      const mine = await http()
        .get('/api/clinical-templates')
        .set('Cookie', cookies.vet)
        .expect(200);
      expect(mine.body).toHaveLength(3);
      const theirs = await http()
        .get('/api/clinical-templates')
        .set('Cookie', cookies.other)
        .expect(200);
      expect(theirs.body).toHaveLength(0);
      await http()
        .delete(`/api/clinical-templates/${mine.body[0].id}`)
        .set('Cookie', cookies.other)
        .expect(404);
      await http()
        .patch(`/api/clinical-templates/${mine.body[0].id}`)
        .set('Cookie', cookies.vet)
        .send({ name: 'Renombrada' })
        .expect(200);
      await http()
        .delete(`/api/clinical-templates/${mine.body[0].id}`)
        .set('Cookie', cookies.vet)
        .expect(204);
    });
  });

  describe('hospitalización', () => {
    it('interna desde una consulta: la consulta se cierra y abre su propia atención', async () => {
      const consult = await http()
        .post('/api/visits')
        .set('Cookie', cookies.vet)
        .send({ petId: ids.pet })
        .expect(201);
      await http()
        .post('/api/hospitalizations')
        .set('Cookie', cookies.reception)
        .send({ petId: ids.pet, reason: 'Gastroenteritis' })
        .expect(403);
      const res = await http()
        .post('/api/hospitalizations')
        .set('Cookie', cookies.vet)
        .send({
          petId: ids.pet,
          fromVisitId: consult.body.id,
          cage: 'J-2',
          reason: 'Gastroenteritis hemorrágica',
          diagnosis: 'Deshidratación moderada',
        })
        .expect(201);
      ids.hosp = res.body.id;
      ids.visit = res.body.visitId;
      expect(res.body.code).toBe('HZ-00001');
      expect(res.body.vet.id).toBe(userIds.vet);
      expect(res.body.status).toBe('ACTIVE');
      const closed = await prisma.visit.findUniqueOrThrow({
        where: { id: consult.body.id },
      });
      expect(closed.status).toBe('CLOSED');
      const visit = await prisma.visit.findUniqueOrThrow({
        where: { id: ids.visit },
      });
      expect(visit.type).toBe('HOSPITALIZATION');

      // La atención del internamiento no se cierra ni se cancela a mano
      await http()
        .post(`/api/visits/${ids.visit}/close`)
        .set('Cookie', cookies.vet)
        .expect(409);
      // Otra clínica no lo ve
      await http()
        .get(`/api/hospitalizations/${ids.hosp}`)
        .set('Cookie', cookies.other)
        .expect(404);
    });

    it('la hoja de tratamiento marca lo dado, lo omitido y lo atrasado', async () => {
      // Internado hace 10 h; la indicación empezó hace 9 h, cada 4 h
      await prisma.hospitalization.update({
        where: { id: ids.hosp },
        data: { admittedAt: new Date(Date.now() - 10 * 3_600_000) },
      });
      const started = new Date(Date.now() - 9 * 3_600_000);
      const res = await http()
        .post(`/api/hospitalizations/${ids.hosp}/orders`)
        .set('Cookie', cookies.vet)
        .send({
          kind: 'MEDICATION',
          description: 'Metronidazol',
          dose: '15 mg/kg',
          route: 'IV',
          everyHours: 4,
          startsAt: started.toISOString(),
        })
        .expect(201);
      const order = res.body.orders[0];
      ids.order = order.id;
      expect(
        order.slots.slice(0, 3).map((s: { state: string }) => s.state),
      ).toEqual(['OVERDUE', 'OVERDUE', 'OVERDUE']);
      expect(res.body.overdue).toBe(3);

      const [first, second] = order.slots;
      await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.reception)
        .send({ kind: 'DOSE', orderId: ids.order, scheduledAt: first.at })
        .expect(201);
      // La misma dosis no se registra dos veces
      const twice = await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.vet)
        .send({ kind: 'DOSE', orderId: ids.order, scheduledAt: first.at })
        .expect(409);
      expect(twice.body.message).toContain('ya la registró');
      const after = await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.vet)
        .send({
          kind: 'DOSE',
          orderId: ids.order,
          scheduledAt: second.at,
          skipped: true,
          notes: 'Vomitó',
        })
        .expect(201);
      expect(
        after.body.orders[0].slots
          .slice(0, 3)
          .map((s: { state: string }) => s.state),
      ).toEqual(['GIVEN', 'SKIPPED', 'OVERDUE']);
      expect(after.body.overdue).toBe(1);
      expect(after.body.next.description).toBe('Metronidazol');

      // Signos vitales: validados y al menos uno
      await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.vet)
        .send({ kind: 'VITALS' })
        .expect(400);
      await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.vet)
        .send({ kind: 'VITALS', temperatureC: 55 })
        .expect(400);
      const vitals = await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.vet)
        .send({
          kind: 'VITALS',
          temperatureC: 39.4,
          heartRate: 120,
          mucosa: 'Rosadas',
        })
        .expect(201);
      expect(vitals.body.lastVitals.temperatureC).toBe(39.4);
      await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.vet)
        .send({ kind: 'NOTE', notes: 'Come poco, más activo' })
        .expect(201);

      const board = await http()
        .get('/api/hospitalizations')
        .set('Cookie', cookies.reception)
        .expect(200);
      expect(board.body).toHaveLength(1);
      expect(board.body[0]).toMatchObject({
        cage: 'J-2',
        overdue: 1,
        activeOrders: 1,
      });
      const dash = await http()
        .get('/api/dashboard')
        .set('Cookie', cookies.vet)
        .expect(200);
      expect(dash.body.hospitalization).toEqual({ active: 1, overdue: 1 });

      const stopped = await http()
        .post(`/api/hospitalizations/${ids.hosp}/orders/${ids.order}/stop`)
        .set('Cookie', cookies.vet)
        .expect(201);
      expect(stopped.body.orders[0].active).toBe(false);
    });

    it('el alta cobra los días, cierra la atención y queda por cobrar', async () => {
      await http()
        .post(`/api/hospitalizations/${ids.hosp}/discharge`)
        .set('Cookie', cookies.vet)
        .send({ outcome: 'DISCHARGED', careServiceId: ids.consult })
        .expect(400);
      const res = await http()
        .post(`/api/hospitalizations/${ids.hosp}/discharge`)
        .set('Cookie', cookies.vet)
        .send({
          outcome: 'DISCHARGED',
          careServiceId: ids.stay,
          days: 2,
          notes: 'Dieta blanda 5 días, control en 3 días',
        })
        .expect(201);
      expect(res.body.status).toBe('DISCHARGED');
      expect(res.body.daysCharged).toBe(2);
      expect(res.body.account).toEqual({ total: 240, pending: 240, lines: 1 });
      const visit = await prisma.visit.findUniqueOrThrow({
        where: { id: ids.visit },
      });
      expect(visit.status).toBe('CLOSED');
      await http()
        .post(`/api/hospitalizations/${ids.hosp}/discharge`)
        .set('Cookie', cookies.vet)
        .send({ outcome: 'DISCHARGED' })
        .expect(409);
      await http()
        .post(`/api/hospitalizations/${ids.hosp}/entries`)
        .set('Cookie', cookies.vet)
        .send({ kind: 'NOTE', notes: 'tarde' })
        .expect(409);
    });

    it('si fallece, la mascota queda registrada como fallecida', async () => {
      const res = await http()
        .post('/api/hospitalizations')
        .set('Cookie', cookies.admin)
        .send({
          petId: ids.pet2,
          vetId: userIds.vet,
          reason: 'Politraumatismo',
        })
        .expect(201);
      expect(res.body.code).toBe('HZ-00002');
      await http()
        .post(`/api/hospitalizations/${res.body.id}/discharge`)
        .set('Cookie', cookies.vet)
        .send({ outcome: 'DECEASED' })
        .expect(201);
      const pet = await prisma.pet.findUniqueOrThrow({
        where: { id: ids.pet2 },
      });
      expect(pet.deceasedAt).not.toBeNull();
      expect(pet.active).toBe(false);
    });

    it('cobra aparte lo dado en la hoja, guarda la hora real de la dosis y registra el alta voluntaria', async () => {
      const injection = (
        await http()
          .post('/api/care-services')
          .set('Cookie', cookies.admin)
          .send({ name: 'Inyección', category: 'CONSULTATION', price: 10 })
          .expect(201)
      ).body.id as number;
      const pet = await newPet('Max');
      const hosp = await http()
        .post('/api/hospitalizations')
        .set('Cookie', cookies.vet)
        .send({ petId: pet, reason: 'Recuperación post castración' })
        .expect(201);
      await prisma.hospitalization.update({
        where: { id: hosp.body.id },
        data: { admittedAt: new Date(Date.now() - 5 * 3_600_000) },
      });
      const base = `/api/hospitalizations/${hosp.body.id}`;
      // La estancia no se cobra por dosis
      await http()
        .post(`${base}/orders`)
        .set('Cookie', cookies.vet)
        .send({
          kind: 'MEDICATION',
          description: 'Estancia',
          careServiceId: ids.stay,
        })
        .expect(400);
      const withOrder = await http()
        .post(`${base}/orders`)
        .set('Cookie', cookies.vet)
        .send({
          kind: 'MEDICATION',
          description: 'Meloxicam',
          everyHours: null,
          startsAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          careServiceId: injection,
        })
        .expect(201);
      const order = withOrder.body.orders[0];
      expect(order.bill).toMatchObject({
        careServiceId: injection,
        description: 'Inyección',
        unitPrice: 10,
        alreadyCharged: 0,
      });
      // Hora real: no futura; se guarda la que dijo quien la registró
      await http()
        .post(`${base}/entries`)
        .set('Cookie', cookies.reception)
        .send({
          kind: 'DOSE',
          orderId: order.id,
          scheduledAt: order.slots[0].at,
          givenAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .expect(400);
      const givenAt = new Date(Date.now() - 2 * 3_600_000);
      const dosed = await http()
        .post(`${base}/entries`)
        .set('Cookie', cookies.reception)
        .send({
          kind: 'DOSE',
          orderId: order.id,
          scheduledAt: order.slots[0].at,
          givenAt: givenAt.toISOString(),
        })
        .expect(201);
      const dose = dosed.body.entries.find(
        (e: { kind: string }) => e.kind === 'DOSE',
      );
      expect(new Date(dose.at).getTime()).toBe(givenAt.getTime());
      expect(dosed.body.prescriptions).toBe(0);

      const res = await http()
        .post(`${base}/discharge`)
        .set('Cookie', cookies.vet)
        .send({
          outcome: 'VOLUNTARY',
          careServiceId: null,
          extras: [{ orderId: order.id, quantity: 1 }],
        })
        .expect(201);
      expect(res.body.status).toBe('DISCHARGED');
      expect(res.body.voluntary).toBe(true);
      expect(res.body.daysCharged).toBeNull();
      expect(res.body.account).toEqual({ total: 10, pending: 10, lines: 1 });
      expect(res.body.orders[0].bill.alreadyCharged).toBe(1);
      const stillActive = await prisma.pet.findUniqueOrThrow({
        where: { id: pet },
      });
      expect(stillActive.active).toBe(true);
    });
  });
});
